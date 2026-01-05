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

                    this.projects.set(p.id, {
                        ...p,
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

    createProject(rulesAndGoal: string, imageGenerationPref?: string, defaultProvider?: LlmProvider): Project {
        const id = randomUUID();
        const project: Project = {
            id,
            rulesAndGoal,
            imageGenerationPref,
            defaultProvider,
            sessionIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.projects.set(id, project);
        this.saveProjects();
        return project;
    }

    getProject(id: string): Project | undefined {
        return this.projects.get(id);
    }

    updateProject(id: string, updates: Partial<Pick<Project, 'rulesAndGoal' | 'imageGenerationPref' | 'defaultProvider'>>): Project {
        const project = this.projects.get(id);
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
            // If project doesn't exist, we might want to error, or create a default one?
            // For now, let's error as strict mode.
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
}
