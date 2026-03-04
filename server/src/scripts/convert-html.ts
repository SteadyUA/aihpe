import 'reflect-metadata';
import '../config/env';
import { Container } from 'typedi';
import { LlmFactory } from '../services/llm/LlmFactory';
import { TaskManagerService } from '../services/TaskManagerService';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { getDataDir } from '../utils/pathUtils';
import util from 'util';
import archiver from 'archiver';
import * as fsCallbacks from 'fs';

const execAsync = util.promisify(exec);

async function main() {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error('Usage: npm run convert-html <input_zip_path> <output_zip_path>');
        process.exit(1);
    }

    const [inputZip, outputZip] = args;
    const resolvedInput = path.resolve(inputZip);
    const resolvedOutput = path.resolve(outputZip);

    if (!fsCallbacks.existsSync(resolvedInput)) {
        console.error(`Input file not found: ${resolvedInput}`);
        process.exit(1);
    }

    let tempDir: string | undefined;
    let task: any;
    let allDone = false;

    try {
        const llmFactory = Container.get(LlmFactory);

        console.log('Initializing database connection...');
        const { AppDataSource } = await import('../data-source');
        if (!AppDataSource.isInitialized) {
            await AppDataSource.initialize();
        }

        // Ensure the task table exists without running broken migrations
        const taskRepo = AppDataSource.getRepository('Task');
        await AppDataSource.query(`
            CREATE TABLE IF NOT EXISTS "task" (
                "id" varchar PRIMARY KEY NOT NULL, 
                "status" varchar NOT NULL DEFAULT ('pending'), 
                "steps" text NOT NULL DEFAULT ('[]'), 
                "errorMessage" text, 
                "createdAt" datetime NOT NULL DEFAULT (datetime('now')), 
                "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
            )
        `);

        // Load or create task
        task = await taskRepo.findOne({ where: { status: 'pending' } }) as any;
        if (!task) {
            task = taskRepo.create({
                id: crypto.randomUUID(),
                status: 'pending',
                steps: []
            });
            await taskRepo.save(task);
        } else {
            console.log(`Resuming existing task: ${task.id}`);
        }

        const taskManagerService = Container.get(TaskManagerService);
        await taskManagerService.updateStatus(task.id, 'executing');

        tempDir = path.join(getDataDir(), 'import', task.id);
        console.log(`Working in import directory: ${tempDir}`);
        await fs.mkdir(tempDir, { recursive: true });

        const dirContents = await fs.readdir(tempDir);
        if (dirContents.length === 0) {
            console.log('Extracting archive...');
            await execAsync(`unzip "${resolvedInput}" -d "${tempDir}"`);
        } else {
            console.log('Archive already extracted.');
        }

        let step = 0;
        const maxSteps = 20;

        // const provider = 'openai';
        const provider = 'google';

        console.log('Starting iterative optimization process...');

        while (!allDone && step < maxSteps) {
            step++;
            console.log(`\n--- Iteration ${step}/${maxSteps} ---\n`);

            if (!(await taskManagerService.hasJobs(task.id))) {
                console.log('No jobs defined. Initializing Planner Agent...');
                const abortController = new AbortController();
                const planClient = llmFactory.getHtmlPlanClient(tempDir!, task.id, provider);
                await planClient.generate({
                    instruction: 'Analyze the working directory and create a granular optimization plan using add_jobs.',
                    abortSignal: abortController.signal,
                    abortController,
                    onProgress: (msg: string, toolName?: string) => {
                        if (toolName) process.stdout.write(`[${toolName}] ${msg}`);
                        else process.stdout.write(msg);
                    }
                } as any);
            } else {
                console.log('--- Pending Job List ---');
                console.log(await taskManagerService.getPrintableList(task.id));
                console.log('-------------------------');

                const nextStep = await taskManagerService.getNextStep(task.id);
                if (!nextStep) {
                    console.log('\nAll jobs in the plan are checked. Conversion complete.');
                    allDone = true;
                    break;
                }

                console.log(`\nExecuting Step: ${nextStep.stepName}\n`);
                const pendingJobs = await taskManagerService.getUncompletedJobs(task.id, nextStep);

                await Promise.all(pendingJobs.map(async (nextJob: any, index: number) => {
                    console.log(`[Job ${index + 1}/${pendingJobs.length}] Executing: ${nextJob.shortDescription}`);
                    const abortController = new AbortController();
                    const execClient = llmFactory.getHtmlExecutionClient(tempDir!, task.id, nextJob.description, provider);

                    await execClient.generate({
                        instruction: 'Execute the job.',
                        abortSignal: abortController.signal,
                        abortController,
                        maxSteps: 100,
                        onProgress: (msg: string, toolName?: string) => {
                            const prefix = `[T${index + 1}]`;
                            if (toolName) process.stdout.write(`\n${prefix}[${toolName}] ${msg}`);
                            else process.stdout.write(`\n${prefix} ${msg}`);
                        }
                    } as any);
                }));
            }
        }

        if (!allDone) {
            console.warn('\nWarning: Max iterations reached without completion.');
        } else {
            const taskManagerService = Container.get(TaskManagerService);
            await taskManagerService.updateStatus(task.id, 'completed');
        }

        // Clean up

        console.log('\nOptimization complete. Creating output archive...');

        await new Promise<void>((resolve, reject) => {
            const output = fsCallbacks.createWriteStream(resolvedOutput);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            output.on('close', () => {
                console.log(`Archive created: ${resolvedOutput} (${archive.pointer()} bytes)`);
                resolve();
            });

            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(output);
            archive.directory(tempDir!, false);
            archive.finalize();
        });

    } catch (error: any) {
        console.error('An error occurred:', error);
        if (task) {
            const taskManagerService = Container.get(TaskManagerService);
            await taskManagerService.updateStatus(task.id, 'failed', error.message || String(error));
        }
    } finally {
        if (tempDir) {
            if (allDone) {
                console.log('Cleaning up import directory...');
                await fs.rm(tempDir, { recursive: true, force: true });
            } else {
                console.log(`Task not completed. Files preserved at: ${tempDir}`);
            }
        }
    }
}

main();
