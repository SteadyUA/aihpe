import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { AppDataSource } from '../data-source';
import { Project } from '../entities/Project'; // Entity
import { LlmProvider } from '../types/chat';

@Service()
export class ProjectService {
    private get projectRepository() {
        return AppDataSource.getRepository(Project);
    }

    async createProject(rulesAndGoal: string, imageGenerationPref?: string, defaultProvider?: LlmProvider, name?: string, accountId?: number, modelRole?: string): Promise<Project> {
        const project = new Project();
        project.id = randomUUID();
        project.accountId = accountId;
        project.name = name || 'Untitled';
        project.rulesAndGoal = rulesAndGoal;
        project.imageGenerationPref = imageGenerationPref;
        project.defaultProvider = defaultProvider;
        project.modelRole = modelRole || 'You are an expert web developer';
        project.sessionIds = [];
        // createdAt/updatedAt handled by TypeOrm via decorators

        return await this.projectRepository.save(project);
    }

    async getProject(id: string, currentUserId?: number): Promise<Project | undefined> {
        const project = await this.projectRepository.findOneBy({ id });
        if (!project) return undefined;

        // Lazy migration: if project has no owner, assign to current user
        if (project.accountId === null && currentUserId !== undefined) {
            // accountId is potentially null in DB
            // We can check if it is null or undefined
            project.accountId = currentUserId;
            await this.projectRepository.save(project);
        }

        // Access control: if project has owner, and it's not current user, deny access
        if (project.accountId !== null && project.accountId !== undefined && currentUserId !== undefined && project.accountId !== currentUserId) {
            return undefined;
        }

        return project;
    }

    async getUserProjects(accountId: number): Promise<Project[]> {
        return await this.projectRepository.findBy({ accountId });
    }

    async updateProject(id: string, updates: Partial<Pick<Project, 'rulesAndGoal' | 'imageGenerationPref' | 'defaultProvider' | 'name' | 'activeSessionId' | 'modelRole'>>, currentUserId?: number): Promise<Project> {
        // Use getProject to handle access checks
        const project = await this.getProject(id, currentUserId);
        if (!project) {
            throw new Error(`Project ${id} not found`);
        }

        // Apply updates
        if (updates.rulesAndGoal !== undefined) project.rulesAndGoal = updates.rulesAndGoal;
        if (updates.imageGenerationPref !== undefined) project.imageGenerationPref = updates.imageGenerationPref;
        if (updates.defaultProvider !== undefined) project.defaultProvider = updates.defaultProvider;
        if (updates.name !== undefined) project.name = updates.name;
        if (updates.activeSessionId !== undefined) project.activeSessionId = updates.activeSessionId;
        if (updates.modelRole !== undefined) project.modelRole = updates.modelRole;

        project.updatedAt = new Date(); // Explicit update or let UpdateDateColumn handle it? 
        // UpdateDateColumn updates on save, but setting it explicitly is fine too.

        return await this.projectRepository.save(project);
    }

    async addSessionToProject(projectId: string, sessionId: string, afterSessionId?: string): Promise<void> {
        const project = await this.projectRepository.findOneBy({ id: projectId });
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        if (!project.sessionIds.includes(sessionId)) {
            if (afterSessionId) {
                const index = project.sessionIds.indexOf(afterSessionId);
                if (index !== -1) {
                    project.sessionIds.splice(index + 1, 0, sessionId);
                } else {
                    project.sessionIds.push(sessionId);
                }
            } else {
                project.sessionIds.push(sessionId);
            }
            // We need to re-assign sessionIds to trigger change detection for simple-array/json sometimes? 
            // TypeOrm simple-json usually detects deep changes if we save object. 
            // But safe bet is:
            project.sessionIds = [...project.sessionIds];
            await this.projectRepository.save(project);
        }
    }

    async removeSessionFromProject(projectId: string, sessionId: string): Promise<void> {
        const project = await this.projectRepository.findOneBy({ id: projectId });
        if (project) {
            project.sessionIds = project.sessionIds.filter(id => id !== sessionId);
            await this.projectRepository.save(project);
        }
    }

    async getProjectSessions(projectId: string): Promise<string[]> {
        const project = await this.projectRepository.findOneBy({ id: projectId });
        return project ? [...project.sessionIds] : [];
    }

    async getNextSessionGroup(projectId: string): Promise<number> {
        const project = await this.projectRepository.findOneBy({ id: projectId });
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        const lastGroup = project.lastAssignedSessionGroup;
        const nextGroup = lastGroup === undefined || lastGroup === null ? 0 : (lastGroup + 1) % 12;

        project.lastAssignedSessionGroup = nextGroup;
        await this.projectRepository.save(project);

        return nextGroup;
    }

    async deleteProject(id: string): Promise<void> {
        await this.projectRepository.delete(id);
    }
}
