import { Get, Post, JsonController, Param, UseBefore, NotFoundError, HttpCode, BadRequestError } from 'routing-controllers';
import { Service } from 'typedi';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import { TaskManagerService } from '../services/TaskManagerService';
import { TaskStatus } from '../types/chat';
import { HtmlImportService } from '../services/HtmlImportService';
import { IsString, IsArray, IsBoolean, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class JobResponse {
    @IsString()
    description!: string;

    @IsString()
    shortDescription!: string;

    @IsBoolean()
    completed!: boolean;
}

class StepResponse {
    @IsString()
    stepName!: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => JobResponse)
    concurrentJobs!: JobResponse[];
}

class TaskResponse {
    @IsString()
    id!: string;

    @IsString()
    status!: string;

    @IsOptional()
    @IsString()
    errorMessage?: string | null;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StepResponse)
    steps!: StepResponse[];

    @IsString()
    createdAt!: string;

    @IsString()
    updatedAt!: string;
}

class TaskOkResponse {
    @IsString()
    message!: string;
}

@Service()
@JsonController()
export class TaskController {
    constructor(
        private readonly htmlImportService: HtmlImportService,
        private readonly taskManagerService: TaskManagerService,
    ) { }

    private mapTaskToResponse(task: any): TaskResponse {
        return {
            id: task.id,
            status: task.status,
            errorMessage: task.errorMessage,
            steps: task.steps || [],
            createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
            updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt,
        };
    }

    @Get('/api/tasks/:taskId')
    @UseBefore(AuthMiddleware)
    async getTask(@Param('taskId') taskId: string): Promise<TaskResponse> {
        const task = await this.taskManagerService.getTask(taskId);
        if (!task) {
            throw new NotFoundError('Task not found');
        }
        return this.mapTaskToResponse(task);
    }

    @Post('/api/tasks/:taskId/retry')
    @UseBefore(AuthMiddleware)
    @HttpCode(202)
    async retryTask(@Param('taskId') taskId: string): Promise<TaskOkResponse> {
        const task = await this.taskManagerService.getTask(taskId);
        if (!task) {
            throw new NotFoundError('Task not found');
        }
        if (task.status !== TaskStatus.FAILED) {
            throw new BadRequestError('Only failed tasks can be retried');
        }

        // Start resume in the background
        this.htmlImportService.resumeArchiveImport(taskId).catch((e: any) => {
            console.error('Failed to resume HTML import', e);
        });

        return { message: 'Task retry initiated' };
    }
}
