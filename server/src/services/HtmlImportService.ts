import { Service, Inject } from 'typedi';
import { ProjectService } from './ProjectService';
import { SessionService } from './session/SessionService';
import { TurnService } from './session/TurnService';
import { FilesService } from './session/FilesService';
import { ChatService } from './ChatService';
import { LlmFactory } from './llm/LlmFactory';
import { TaskManagerService } from './TaskManagerService';
import { AppDataSource } from '../data-source';
import { Task } from '../entities/Task';
import { Turn } from '../types/chat';
import * as fs from 'fs/promises';
import * as path from 'path';
import extract from 'extract-zip';
import { ImageService } from './image/ImageService';
import crypto from 'crypto';

@Service()
export class HtmlImportService {
    constructor(
        @Inject() private projectService: ProjectService,
        @Inject() private sessionService: SessionService,
        @Inject() private turnService: TurnService,
        @Inject() private filesService: FilesService,
        @Inject() private chatService: ChatService,
        @Inject() private taskManagerService: TaskManagerService,
        @Inject() private llmFactory: LlmFactory,
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
            const provider = project.defaultProvider;

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

            // 3. Run Optimization Loop
            let allDone = false;
            let iterations = 0;
            const maxIterations = 20;

            await this.taskManagerService.updateStatus(taskId, 'executing');

            while (!allDone && iterations < maxIterations) {
                iterations++;

                if (!(await this.taskManagerService.hasJobs(taskId))) {
                    console.log(`[Task ${taskId}] No jobs defined. Initializing Planner Agent...`);
                    const abortController = new AbortController();
                    const planClient = this.llmFactory.getHtmlPlanClient(tempDir, taskId, provider || 'openai');
                    await planClient.generate({
                        instruction: 'Analyze the working directory and create a granular optimization plan using add_jobs.',
                        abortSignal: abortController.signal,
                        abortController,
                        onProgress: () => { }
                    } as any);
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
                        const execClient = this.llmFactory.getHtmlExecutionClient(tempDir, taskId, nextJob.description, provider || 'openai');
                        await execClient.generate({
                            instruction: 'Execute the job.',
                            abortSignal: abortController.signal,
                            abortController,
                            maxSteps: 100,
                            onProgress: () => { }
                        } as any);
                    }));
                }
            }

            if (allDone) {
                await this.taskManagerService.updateStatus(taskId, 'completed');

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
                await getFilesRec(tempDir, tempDir);
                await this.filesService.persistVersionFiles(sessionId, 0, files);

                // 6. Add First Turn
                const now = new Date();
                const welcomeTurn: Turn = {
                    turn: 1,
                    beginTime: now,
                    endTime: now,
                    request: '',
                    response: 'files imported',
                    provider: provider || 'openai',
                    fastMode: false,
                    version: 0,
                };
                await this.turnService.appendTurn(sessionId, welcomeTurn);
                await this.sessionService.updateMetadata(sessionId, {
                    lastTurn: 1,
                    updatedAt: now,
                });

                // 7. Update Project Status
                await this.projectService.updateProjectStatus(projectId, 'ready');

                // Clean up temp dir
                await fs.rm(tempDir, { recursive: true, force: true });
            } else {
                await this.taskManagerService.updateStatus(taskId, 'failed', 'Max iterations reached without completion');
            }

        } catch (error: any) {
            console.error('HTML Import failed:', error);
            await this.taskManagerService.updateStatus(taskId, 'failed', error.message || String(error));
        } finally {
            // Remove uploaded zip from tmpdir
            try {
                await fs.unlink(zipPath);
            } catch (e) {
                // Ignore if already deleted
            }
        }
    }
}
