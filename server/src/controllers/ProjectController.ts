import {
    Body,
    CurrentUser,
    Delete,
    Get,
    JsonController,
    Param,
    Patch,
    Post,
    UseBefore,
    NotFoundError,
    ForbiddenError,
    UploadedFile,
    HttpCode
} from 'routing-controllers';
import { AuthMiddleware } from '../middlewares/AuthMiddleware';
import os from 'os';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { Service } from 'typedi';
import { ProjectService } from '../services/ProjectService';
import { HtmlImportService } from '../services/HtmlImportService';
import { TaskManagerService } from '../services/TaskManagerService';
import { LlmProvider, ProjectStatus } from '../types/chat';
import { Project } from '../entities/Project';

class ProjectResponse {
    id!: string;
    name!: string;
    defaultProvider?: LlmProvider | null;
    activeSessionId?: string | null;
    status!: string;
    taskId?: string | null;
    sessionIds!: string[];
}

class OkResponse {
    @IsString()
    message!: string;
}

class CreateProjectRequest {
    @IsOptional()
    @IsString()
    defaultProvider?: LlmProvider;

    @IsOptional()
    @IsString()
    name?: string;
}

class UpdateProjectRequest {
    @IsOptional()
    @IsString()
    defaultProvider?: LlmProvider;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    activeSessionId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    sessionIds?: string[];
}

@Service()
@JsonController('/api/projects')
@UseBefore(AuthMiddleware)
export class ProjectController {
    constructor(
        private readonly projectService: ProjectService,
        private readonly htmlImportService: HtmlImportService,
        private readonly taskManagerService: TaskManagerService,
    ) {
        console.log('ProjectController initialized');
    }

    private mapProjectToResponse(project: Project): ProjectResponse {
        return {
            id: project.id,
            name: project.name,
            defaultProvider: project.defaultProvider,
            activeSessionId: project.activeSessionId,
            status: project.status,
            taskId: project.taskId,
            sessionIds: project.sessionIds || [], // Ensure safe fallbacks if needed
        };
    }

    @Post()
    @HttpCode(201)
    async createProject(
        @CurrentUser() user: any,
        @Body() body: CreateProjectRequest,
        @UploadedFile('file', { options: { dest: os.tmpdir() } }) file?: Express.Multer.File
    ): Promise<ProjectResponse> {
        const accountId = user?.accountId;
        const status = file ? ProjectStatus.INITIALIZATION : ProjectStatus.READY;
        const taskId = file ? this.taskManagerService.getNextId() : undefined;

        const project = await this.projectService.createProject(
            body.defaultProvider,
            body.name,
            accountId,
            status,
            taskId
        );

        if (file && taskId) {
            // Create pending task entity before sending response to avoid 404 on immediate poll
            await this.taskManagerService.createTask(taskId);

            // Start background import
            this.htmlImportService.importArchive(project.id, file.path, taskId).catch((e: any) => {
                console.error('Failed to start HTML import', e);
            });
        }

        return this.mapProjectToResponse(project);
    }

    @Get()
    async getUserProjects(@CurrentUser() user: any): Promise<ProjectResponse[]> {
        const accountId = user?.accountId;
        if (!accountId) {
            return [];
        }
        const projects = await this.projectService.getUserProjects(accountId);

        return projects.map(p => this.mapProjectToResponse(p));
    }

    @Get('/:projectId')
    async getProject(@Param('projectId') projectId: string, @CurrentUser() user: any): Promise<ProjectResponse> {
        const accountId = user?.accountId;
        const project = await this.projectService.getProject(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }
        if (project.accountId !== null && project.accountId !== undefined && project.accountId !== accountId) {
            throw new ForbiddenError('Access denied');
        }

        return this.mapProjectToResponse(project);
    }

    @Patch('/:projectId')
    async updateProject(
        @Param('projectId') projectId: string,
        @Body() body: UpdateProjectRequest,
        @CurrentUser() user: any
    ): Promise<ProjectResponse> {
        const updateData: any = {};
        if (body.defaultProvider !== undefined) updateData.defaultProvider = body.defaultProvider;
        if (body.name !== undefined) updateData.name = body.name;
        if (body.activeSessionId !== undefined) updateData.activeSessionId = body.activeSessionId;
        if (body.sessionIds !== undefined) updateData.sessionIds = body.sessionIds;

        const accountId = user?.accountId;
        const project = await this.projectService.getProject(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }
        if (project.accountId !== null && project.accountId !== undefined && project.accountId !== accountId) {
            throw new ForbiddenError('Access denied');
        }
        const updatedProject = await this.projectService.updateProject(projectId, updateData);

        return this.mapProjectToResponse(updatedProject);
    }

    @Delete('/:projectId')
    async deleteProject(
        @Param('projectId') projectId: string,
        @CurrentUser() user: any
    ): Promise<OkResponse> {
        const accountId = user?.accountId;
        // Check ownership
        const project = await this.projectService.getProject(projectId);
        if (!project) {
            throw new NotFoundError('Project not found');
        }
        if (project.accountId !== null && project.accountId !== undefined && project.accountId !== accountId) {
            throw new ForbiddenError('Access denied');
        }

        // Delete the project itself
        await this.projectService.deleteProject(projectId);

        return { message: 'Project deleted' };
    }
}
