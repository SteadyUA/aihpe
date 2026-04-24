import { Service, Inject } from 'typedi';
import { ProjectService } from './ProjectService';
import { SessionService } from './session/SessionService';
import { TurnService } from './session/TurnService';
import { FilesService } from './session/FilesService';
import { ChatService } from './ChatService';
import { HtmlConversionAgent } from './llm/agents/HtmlConversionAgent';
import { TaskManagerService } from './TaskManagerService';
import { Turn , TaskStatus , ProjectStatus } from '../types/chat';
import * as fs from 'fs/promises';
import * as path from 'path';
import extract from 'extract-zip';
import { ImageService } from './image/ImageService';
import crypto from 'crypto';
import beautify from 'js-beautify';

@Service()
export class HtmlImportService {
    private readonly provider = 'google';

    constructor(
        @Inject() private projectService: ProjectService,
        @Inject() private sessionService: SessionService,
        @Inject() private turnService: TurnService,
        @Inject() private filesService: FilesService,
        @Inject() private chatService: ChatService,
        @Inject() private taskManagerService: TaskManagerService,
        @Inject() private htmlConversionAgent: HtmlConversionAgent,
        @Inject() private imageService: ImageService
    ) { }

    async importArchive(projectId: string, zipPath: string, providedTaskId: string): Promise<void> {
        const taskId = providedTaskId;
        console.log(`Starting HTML import for project ${projectId}, task ${taskId}`);
        const sessionId = crypto.randomUUID();

        try {
            // 1. Create a session for this project
            const project = await this.projectService.getProject(projectId);
            if (!project) throw new Error('Project not found');

            await this.chatService.createSession(sessionId, projectId);
            await this.projectService.addSessionToProject(projectId, sessionId);
            console.log(`Created session ${sessionId} for import`);

            // 2. Extract ZIP
            const tempDir = path.join(process.cwd(), 'data', 'import', taskId);
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

            // Execute the import process
            await this.executeImportLoop(projectId, sessionId, taskId, tempDir);

        } catch (error: any) {
            console.error('HTML Import failed:', error);
            await this.taskManagerService.updateStatus(taskId, TaskStatus.FAILED, error.message || String(error));
        } finally {
            // Remove uploaded zip from tmpdir
            try {
                await fs.unlink(zipPath);
            } catch (e) {
                // Ignore if already deleted
            }
        }
    }

    async resumeArchiveImport(taskId: string): Promise<void> {
        console.log(`Resuming HTML import for task ${taskId}`);
        try {
            const project = await this.projectService.getProjectByTaskId(taskId);
            if (!project) throw new Error('Project not found for this task');

            const sessionId = project.sessionIds[project.sessionIds.length - 1];
            if (!sessionId) throw new Error('No session initialized for this project yet');

            const tempDir = path.join(process.cwd(), 'data', 'import', taskId);

            // Check if tempDir exists
            try {
                await fs.access(tempDir);
            } catch (e) {
                throw new Error('Temporary import directory not found. Cannot resume.');
            }

            await this.executeImportLoop(project.id, sessionId, taskId, tempDir);

        } catch (error: any) {
            console.error('HTML Import Resume failed:', error);
            await this.taskManagerService.updateStatus(taskId, TaskStatus.FAILED, error.message || String(error));
        }
    }

    private async executeImportLoop(projectId: string, sessionId: string, taskId: string, tempDir: string): Promise<void> {
        // 3. Run Optimization Loop
        let allDone = false;
        let iterations = 0;
        const maxIterations = 20;

        await this.taskManagerService.updateStatus(taskId, TaskStatus.EXECUTING);

        while (!allDone && iterations < maxIterations) {
            iterations++;

            if (!(await this.taskManagerService.hasJobs(taskId))) {
                console.log(`[Task ${taskId}] No jobs defined. Initializing Planner Agent...`);
                const abortController = new AbortController();
                await this.htmlConversionAgent.plan(this.provider as any, {
                    workingDirectory: tempDir,
                    taskId: taskId,
                    instruction: 'Analyze the working directory and create a granular optimization plan using add_jobs.',
                    abortSignal: abortController.signal
                });
            } else {
                const nextStep = await this.taskManagerService.getNextStep(taskId);
                if (!nextStep) {
                    console.log(`[Task ${taskId}] All jobs completed.`);
                    allDone = true;
                    break;
                }

                console.log(`[Task ${taskId}] Executing Step: ${nextStep.stepName}`);
                const pendingJobs = await this.taskManagerService.getUncompletedJobs(taskId, nextStep);

                await Promise.all(pendingJobs.map(async (nextJob) => {
                    console.log(`[Task ${taskId}] Executing Job: ${nextJob.shortDescription}`);
                    const abortController = new AbortController();
                    await this.htmlConversionAgent.executeTask(this.provider as any, {
                        workingDirectory: tempDir,
                        taskId: taskId,
                        currentTask: nextJob.description,
                        instruction: 'Execute the job.',
                        abortSignal: abortController.signal
                    });
                }));
            }
        }

        if (allDone) {
            await this.taskManagerService.updateStatus(taskId, TaskStatus.COMPLETED);

            // 5. Move files to Session Version 0
            const files: Record<string, string> = {};
            const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.heic']);

            // Needs to capture 'this' for imageService
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

                        if (imageExtensions.has(ext)) {
                            // It's an image, save it using ImageService
                            try {
                                const buffer = await fs.readFile(res);
                                // Construct a fake Multer.File object for the service
                                const fileObj: any = {
                                    originalname: relPath,
                                    buffer: buffer,
                                };
                                await self.imageService.saveUploadedImage(sessionId, 0, fileObj, true);
                                console.log(`Saved image ${relPath} to session ${sessionId}`);
                            } catch (err) {
                                console.error(`Failed to save image ${relPath}:`, err);
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
            this.filesService.initFirstVersion(sessionId);
            await getFilesRec(tempDir, tempDir);
            this.filesService.writeVersionFile(sessionId, 0, 'index.html', files['index.html'] || '');
            this.filesService.writeVersionFile(sessionId, 0, 'styles.css', files['styles.css'] || '');
            this.filesService.writeVersionFile(sessionId, 0, 'script.js', files['script.js'] || '');
            await this.imageService.updateImagesUsage(sessionId, 0);

            // 6. Add First Turn
            const now = new Date();
            const welcomeTurn: Turn = {
                turn: 1,
                beginTime: now,
                endTime: now,
                request: '',
                response: 'files imported',
                provider: this.provider as any, // Cast to avoid LlmProvider type issues if any
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
        } else {
            await this.taskManagerService.updateStatus(taskId, TaskStatus.FAILED, 'Max iterations reached without completion');
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
                            // Type assertion for HTMLOptions needed if using generic options object
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
