import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { Task, Job, Step } from '../entities/Task';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDataDir } from '../utils/pathUtils';

@Service()
export class TaskManagerService {

    private async getTask(taskId: string): Promise<Task | null> {
        if (!AppDataSource.isInitialized) {
            await AppDataSource.initialize();
        }
        const repo = AppDataSource.getRepository(Task);
        return await repo.findOne({ where: { id: taskId } });
    }

    private async saveTask(task: Task) {
        const repo = AppDataSource.getRepository(Task);
        await repo.save(task);
    }

    async updateStatus(taskId: string, status: 'pending' | 'planning' | 'executing' | 'completed' | 'failed', errorMessage?: string): Promise<void> {
        const task = await this.getTask(taskId);
        if (task) {
            task.status = status;
            if (errorMessage !== undefined) {
                task.errorMessage = errorMessage;
            }
            await this.saveTask(task);
        }
    }

    async deleteTask(taskId: string): Promise<boolean> {
        const task = await this.getTask(taskId);
        if (!task) return false;

        // Try to delete directory
        try {
            const importDir = path.join(getDataDir(), 'import', taskId);
            await fs.rm(importDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Failed to delete task directory for ${taskId}:`, error);
        }

        // Delete from database
        const repo = AppDataSource.getRepository(Task);
        await repo.delete(taskId);
        return true;
    }

    async addJobs(taskId: string, stepsData: { stepName: string, concurrentJobs: { description: string, shortDescription: string }[] }[]) {
        const task = await this.getTask(taskId);
        if (!task) return;

        const steps = task.steps || [];

        for (const step of stepsData) {
            const cleanJobs = step.concurrentJobs.map(jobObj => {
                return {
                    description: jobObj.description.replace(/^-\s*\[.*?\]\s*/, '').trim(),
                    shortDescription: jobObj.shortDescription.trim() || 'No title provided',
                    completed: false
                };
            }).filter(t => t.description);

            if (cleanJobs.length > 0) {
                steps.push({
                    stepName: step.stepName,
                    concurrentJobs: cleanJobs
                });
            }
        }

        task.steps = steps;
        await this.saveTask(task);
    }

    async completeJob(taskId: string, description: string): Promise<boolean> {
        const task = await this.getTask(taskId);
        if (!task) return false;

        const steps = task.steps || [];

        // Find inside steps
        for (const step of steps) {
            const job = step.concurrentJobs.find((t: Job) => t.description === description.trim());
            if (job) {
                job.completed = true;
                task.steps = steps;
                await this.saveTask(task);
                return true;
            }
            const looseJob = step.concurrentJobs.find((t: Job) =>
                t.description.includes(description.trim()) ||
                description.trim().includes(t.description)
            );
            if (looseJob) {
                looseJob.completed = true;
                task.steps = steps;
                await this.saveTask(task);
                return true;
            }
        }
        return false;
    }

    async getNextStep(taskId: string): Promise<Step | undefined> {
        const task = await this.getTask(taskId);
        if (!task) return undefined;
        return (task.steps || []).find((s: Step) => s.concurrentJobs.some((t: Job) => !t.completed));
    }

    async getUncompletedJobs(taskId: string, step: Step): Promise<Job[]> {
        const task = await this.getTask(taskId);
        if (!task) return [];
        // The step passed might be a stale reference, so we just filter from it directly since it contains the task data we need
        return step.concurrentJobs.filter(t => !t.completed);
    }

    async getPrintableList(taskId: string): Promise<string> {
        const task = await this.getTask(taskId);
        if (!task || !task.steps || task.steps.length === 0) return 'No jobs defined yet.';

        let output = '';
        for (const step of task.steps) {
            output += `## Step: ${step.stepName}\n`;
            for (const t of step.concurrentJobs) {
                output += `- [${t.completed ? 'x' : ' '}] ${t.shortDescription}\n`;
            }
        }
        return output.trim();
    }

    async isAllCompleted(taskId: string): Promise<boolean> {
        const task = await this.getTask(taskId);
        if (!task) return false;
        const steps = task.steps || [];
        return steps.length > 0 && steps.every((s: Step) => s.concurrentJobs.every((t: Job) => t.completed));
    }

    async hasJobs(taskId: string): Promise<boolean> {
        const task = await this.getTask(taskId);
        if (!task) return false;
        return (task.steps || []).length > 0;
    }
}
