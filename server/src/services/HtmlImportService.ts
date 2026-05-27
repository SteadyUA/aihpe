import { Service, Inject } from 'typedi';
import { ProjectService } from './ProjectService';
import { SessionService } from './session/SessionService';
import { TurnService } from './session/TurnService';
import { FilesService } from './session/FilesService';
import { ChatService } from './ChatService';
import { HtmlConversionAgent } from './llm/agents/HtmlConversionAgent';
import { SseService } from './SseService';
import { Turn, ProjectStatus } from '../types/chat';
import * as fs from 'fs/promises';
import * as path from 'path';
import extract from 'extract-zip';
import { SessionResourceService } from './session/SessionResourceService';
import crypto from 'crypto';
import beautify from 'js-beautify';

@Service()
export class HtmlImportService {
    constructor(
        @Inject() private projectService: ProjectService,
        @Inject() private sessionService: SessionService,
        @Inject() private turnService: TurnService,
        @Inject() private filesService: FilesService,
        @Inject() private chatService: ChatService,
        @Inject() private htmlConversionAgent: HtmlConversionAgent,
        @Inject() private resourceService: SessionResourceService,
        @Inject() private sseService: SseService
    ) { }

    async getPlanContent(projectId: string): Promise<string> {
        const tempDir = path.join(process.cwd(), 'data', 'import', projectId);
        const planPath = path.join(tempDir, '.memory', 'plan.md');
        try {
            return await fs.readFile(planPath, 'utf-8');
        } catch (e) {
            return 'Plan not generated yet or task is completed.';
        }
    }

    async importArchive(projectId: string, zipPath: string, archiveName: string): Promise<void> {
        const beginTime = new Date();
        console.log(`Starting HTML import for project ${projectId}`);
        const sessionId = crypto.randomUUID();

        try {
            // 1. Create a session for this project
            const project = await this.projectService.getProject(projectId);
            if (!project) throw new Error('Project not found');

            await this.chatService.createSession(sessionId, projectId, undefined, project.defaultProvider as any);
            await this.projectService.addSessionToProject(projectId, sessionId);
            console.log(`Created session ${sessionId} for import`);

            // 2. Extract ZIP
            const tempDir = path.join(process.cwd(), 'data', 'import', projectId);

            let isResume = false;
            try {
                await fs.access(path.join(tempDir, '.memory', 'plan.md'));
                isResume = true;
                console.log(`Found existing plan.md in ${tempDir}, resuming import.`);
            } catch (e) {
                // Not a resume
            }

            if (!isResume) {
                await fs.mkdir(tempDir, { recursive: true });
                await extract(zipPath, { dir: tempDir });

                // Clean up potentially problematic __MACOSX directories from zip
                try {
                    await fs.rm(path.join(tempDir, '__MACOSX'), { recursive: true, force: true });
                } catch (e) {
                    // Ignore if it doesn't exist
                }

                // Format all extracted files before LLM processing
                await this.formatExtractedFiles(tempDir);
            }

            // Execute the import process
            await this.executeImportLoop(projectId, sessionId, tempDir, beginTime, archiveName);

        } catch (error: any) {
            console.error('HTML Import failed:', error);
            await this.projectService.updateProjectStatus(projectId, ProjectStatus.ERROR);
            const project = await this.projectService.getProject(projectId);
            if (project?.accountId) {
                this.sseService.broadcastToAccount(project.accountId, 'import-failed', { projectId, error: error.message || String(error) });
            }
        } finally {
            // Remove uploaded zip from tmpdir
            try {
                await fs.unlink(zipPath);
            } catch (e) {
                // Ignore if already deleted
            }
        }
    }

    async resumeArchiveImport(projectId: string): Promise<void> {
        const beginTime = new Date();
        console.log(`Resuming HTML import for project ${projectId}`);
        try {
            const project = await this.projectService.getProject(projectId);
            if (!project) throw new Error('Project not found');

            const sessionId = project.sessionIds[project.sessionIds.length - 1];
            if (!sessionId) throw new Error('No session initialized for this project yet');

            const tempDir = path.join(process.cwd(), 'data', 'import', projectId);

            // Check if tempDir exists
            try {
                await fs.access(tempDir);
            } catch (e) {
                throw new Error('Temporary import directory not found. Cannot resume.');
            }

            await this.executeImportLoop(projectId, sessionId, tempDir, beginTime, project.name ? project.name + '.zip' : 'archived files');

        } catch (error: any) {
            console.error('HTML Import Resume failed:', error);
            await this.projectService.updateProjectStatus(projectId, ProjectStatus.ERROR);
            const project = await this.projectService.getProject(projectId);
            if (project?.accountId) {
                this.sseService.broadcastToAccount(project.accountId, 'import-failed', { projectId, error: error.message || String(error) });
            }
        }
    }

    private async executeImportLoop(projectId: string, sessionId: string, tempDir: string, beginTime: Date, archiveName: string): Promise<void> {
        await this.projectService.updateProjectStatus(projectId, ProjectStatus.INITIALIZATION);

        const project = await this.projectService.getProject(projectId);
        console.log(`[Project ${projectId}] Project:`, project);
        if (!project) throw new Error('Project not found');

        const bakDir = path.join(tempDir, '.bak');
        try {
            await fs.access(bakDir);
            console.log(`[Project ${projectId}] Found .bak directory, recovering files...`);
            const currentEntries = await fs.readdir(tempDir, { withFileTypes: true });
            for (const entry of currentEntries) {
                if (entry.name.startsWith('.')) continue;
                await fs.rm(path.join(tempDir, entry.name), { recursive: true, force: true });
            }
            const bakEntries = await fs.readdir(bakDir, { withFileTypes: true });
            for (const entry of bakEntries) {
                const src = path.join(bakDir, entry.name);
                const dest = path.join(tempDir, entry.name);
                await fs.cp(src, dest, { recursive: true });
            }
            await fs.rm(bakDir, { recursive: true, force: true });
            console.log(`[Project ${projectId}] Recovery complete.`);
        } catch (e) {
            // No backup found, proceed normally
        }

        let isFinished = false;
        let loops = 0;
        const maxLoops = 5;

        while (!isFinished && loops < maxLoops) {
            loops++;
            console.log(`[Project ${projectId}] Starting/Resuming Orchestrator loop (iteration ${loops})...`);

            const providerToUse = project.defaultProvider || 'openai';
            isFinished = await this.htmlConversionAgent.runOrchestratorLoop(providerToUse as any, {
                workingDirectory: tempDir,
                projectId: projectId,
                onPlanUpdated: () => {
                    if (project.accountId) {
                        this.sseService.broadcastToAccount(project.accountId, 'plan-updated', { projectId });
                    }
                },
                onToolCall: (agentName, toolName, summary) => {
                    if (project.accountId) {
                        this.sseService.broadcastToAccount(project.accountId, 'tool-called', { projectId, agentName, toolName, summary });
                    }
                }
            });

            if (!isFinished) {
                console.log(`[Project ${projectId}] Orchestrator loop paused or max steps reached. Checking if we should continue...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (isFinished) {
            console.log(`[Project ${projectId}] Import finished. Saving files to session...`);

            // 5. Move files to Session Version 0
            const files: Record<string, string> = {};
            const resourceExtensions = new Set([
                // Images
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.heic', '.avif',
                // Fonts
                '.woff', '.woff2', '.ttf', '.otf', '.eot',
                // Videos
                '.mp4', '.webm', '.ogg', '.mov'
            ]);

            const self = this;

            async function getFilesRec(dir: string, baseDir: string) {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const res = path.resolve(dir, entry.name);
                    if (entry.isDirectory()) {
                        await getFilesRec(res, baseDir);
                    } else {
                        const relPath = path.relative(baseDir, res);
                        const ext = path.extname(res).toLowerCase();

                        // Skip internal state files
                        if (relPath.startsWith('.memory') || relPath === '_state.json') continue;

                        if (resourceExtensions.has(ext)) {
                            // It's a binary resource, save it using ResourceService
                            try {
                                const buffer = await fs.readFile(res);
                                // Construct a fake Multer.File object for the service
                                const fileObj: any = {
                                    originalname: relPath,
                                    buffer: buffer,
                                };
                                await self.resourceService.saveUploadedFile(sessionId, 0, fileObj, true);
                                console.log(`Saved resource ${relPath} to session ${sessionId}`);
                            } catch (err) {
                                console.error(`Failed to save resource ${relPath}:`, err);
                            }
                        } else {
                            // It's a text file
                            const content = await fs.readFile(res, 'utf8').catch(() => null);
                            if (content !== null) {
                                files[relPath] = content;
                            }
                        }
                    }
                }
            }
            this.chatService.initFirstVersion(sessionId);
            await getFilesRec(tempDir, tempDir);
            this.filesService.writeVersionFile(sessionId, 0, 'index.html', files['index.html'] || '');
            this.filesService.writeVersionFile(sessionId, 0, 'styles.css', files['styles.css'] || '');
            this.filesService.writeVersionFile(sessionId, 0, 'script.js', files['script.js'] || '');
            await this.resourceService.updateResourcesUsage(sessionId, 0);

            // 6. Add First Turn
            const now = new Date();
            const welcomeTurn: Turn = {
                turn: 1,
                beginTime: beginTime,
                endTime: now,
                request: 'Uploaded ' + archiveName,
                response: 'Files imported',
                provider: (project.defaultProvider || 'openai') as any, // Cast to avoid LlmProvider type issues if any
                fastMode: false,
                version: 0,
            };
            await this.turnService.appendTurn(sessionId, welcomeTurn);
            await this.sessionService.updateMetadata(sessionId, {
                lastTurn: 1,
                updatedAt: now,
            });

            // 7. Update Project Status
            await this.projectService.updateProjectStatus(projectId, ProjectStatus.READY);

            // Clean up temp dir
            await fs.rm(tempDir, { recursive: true, force: true });
            
            if (project.accountId) {
                this.sseService.broadcastToAccount(project.accountId, 'import-completed', { projectId });
            }
        } else {
            const errorMsg = 'Max orchestrator loops reached without calling finish_import.';
            await this.projectService.updateProjectStatus(projectId, ProjectStatus.ERROR);
            if (project.accountId) {
                this.sseService.broadcastToAccount(project.accountId, 'import-failed', { projectId, error: errorMsg });
            }
        }
    }

    private async formatExtractedFiles(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.resolve(dir, entry.name);
            if (entry.isDirectory()) {
                await this.formatExtractedFiles(fullPath);
            } else {
                const ext = path.extname(fullPath).toLowerCase();
                if (['.html', '.css', '.js'].includes(ext)) {
                    try {
                        let content = await fs.readFile(fullPath, 'utf8');
                        const formatOptions: beautify.HTMLBeautifyOptions | beautify.CSSBeautifyOptions | beautify.JSBeautifyOptions = {
                            indent_size: 4,
                            indent_char: ' ',
                            max_preserve_newlines: 2,
                            preserve_newlines: true,
                            wrap_line_length: 120,
                        };

                        if (ext === '.html') {
                            content = beautify.html(content, formatOptions as beautify.HTMLBeautifyOptions);
                        } else if (ext === '.css') {
                            content = beautify.css(content, formatOptions as beautify.CSSBeautifyOptions);
                        } else if (ext === '.js') {
                            content = beautify.js(content, formatOptions as beautify.JSBeautifyOptions);
                        }

                        await fs.writeFile(fullPath, content, 'utf8');
                        console.log(`Formatted file: ${fullPath}`);
                    } catch (e) {
                        console.error(`Failed to format ${fullPath}:`, e);
                    }
                }
            }
        }
    }
}
