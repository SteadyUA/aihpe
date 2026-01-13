import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Service } from 'typedi';
import { Project, LlmProvider } from '../types/chat';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

@Service()
export class ProjectService {
    private projects = new Map<string, Project>();

    constructor() {
        this.loadProjects();
    }

    private loadProjects() {
        if (!fs.existsSync(PROJECTS_FILE)) {
            return;
        }
        try {
            const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) {
                for (const p of data) {
                    // Migration: goal -> rulesAndGoal
                    if ((p as any).goal && !p.rulesAndGoal) {
                        p.rulesAndGoal = (p as any).goal;
                        delete (p as any).goal;
                    }

                    if (!(p as any).name) {
                        (p as any).name = 'Untitled';
                    }

                    if (!p.modelRole) {
                        p.modelRole = 'You are an expert web developer';
                    }

                    this.projects.set(p.id, {
                        ...p,
                        name: (p as any).name,
                        createdAt: new Date(p.createdAt),
                        updatedAt: new Date(p.updatedAt),
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
        }
    }

    private saveProjects() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const data = Array.from(this.projects.values());
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }

    createProject(rulesAndGoal: string, imageGenerationPref?: string, defaultProvider?: LlmProvider, name?: string, accountId?: number, modelRole?: string): Project {
        const id = randomUUID();
        const project: Project = {
            id,
            accountId,
            name: name || 'Untitled',
            rulesAndGoal,
            imageGenerationPref,
            defaultProvider,
            modelRole: modelRole || 'You are an expert web developer',
            sessionIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.projects.set(id, project);
        this.saveProjects();
        return project;
    }

    getProject(id: string, currentUserId?: number): Project | undefined {
        const project = this.projects.get(id);
        if (!project) return undefined;

        // Lazy migration: if project has no owner, assign to current user
        if (project.accountId === undefined && currentUserId !== undefined) {
            project.accountId = currentUserId;
            this.saveProjects();
        }

        // Access control: if project has owner, and it's not current user, deny access
        // We throw generic 'not found' to avoid leaking existence, or explicit error?
        // Let's return undefined to look like it doesn't exist for this user.
        if (project.accountId !== undefined && currentUserId !== undefined && project.accountId !== currentUserId) {
            return undefined;
        }

        return project;
    }

    getUserProjects(accountId: number): Project[] {
        return Array.from(this.projects.values()).filter(p => p.accountId === accountId);
    }

    updateProject(id: string, updates: Partial<Pick<Project, 'rulesAndGoal' | 'imageGenerationPref' | 'defaultProvider' | 'name' | 'activeSessionId' | 'modelRole'>>, currentUserId?: number): Project {
        // Use getProject to handle access checks
        const project = this.getProject(id, currentUserId);
        if (!project) {
            throw new Error(`Project ${id} not found`);
        }

        const updated: Project = {
            ...project,
            ...updates,
            updatedAt: new Date(),
        };
        this.projects.set(id, updated);
        this.saveProjects();
        return updated;
    }

    addSessionToProject(projectId: string, sessionId: string): void {
        const project = this.projects.get(projectId);

        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        if (!project.sessionIds.includes(sessionId)) {
            project.sessionIds.push(sessionId);
            project.updatedAt = new Date();
            this.saveProjects();
        }
    }

    removeSessionFromProject(projectId: string, sessionId: string): void {
        const project = this.projects.get(projectId);
        if (project) {
            project.sessionIds = project.sessionIds.filter(id => id !== sessionId);
            project.updatedAt = new Date();
            this.saveProjects();
        }
    }



    getProjectSessions(projectId: string): string[] {
        const project = this.projects.get(projectId);
        return project ? [...project.sessionIds] : [];
    }

    getNextSessionGroup(projectId: string): number {
        const project = this.projects.get(projectId);
        if (!project) {
            throw new Error(`Project ${projectId} not found`);
        }

        const lastGroup = project.lastAssignedSessionGroup;
        // Start from 0 if undefined, otherwise increment and wrap around 12
        const nextGroup = lastGroup === undefined ? 0 : (lastGroup + 1) % 12;

        project.lastAssignedSessionGroup = nextGroup;
        project.updatedAt = new Date();
        this.saveProjects();

        return nextGroup;
    }

    deleteProject(id: string): void {
        if (this.projects.has(id)) {
            this.projects.delete(id);
            this.saveProjects();
        }
    }
}
