import 'reflect-metadata';
import '../config/env';
import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../data-source';
import { Session } from '../entities/Session';
import { SessionContext } from '../entities/SessionContext';
import { SessionTurn } from '../entities/SessionTurn';
import { Account } from '../entities/Account';
import { Project } from '../entities/Project';
import { getSessionsDir, getDataDir } from '../utils/pathUtils';
import { randomBytes } from 'crypto';

async function migrate() {
    console.log('Starting full data migration from files to database...');

    try {
        await AppDataSource.initialize();
        console.log('Database connection initialized.');

        const accountRepository = AppDataSource.getRepository(Account);
        const projectRepository = AppDataSource.getRepository(Project);
        const sessionRepository = AppDataSource.getRepository(Session);
        const contextRepository = AppDataSource.getRepository(SessionContext);
        const turnRepository = AppDataSource.getRepository(SessionTurn);

        const dataDir = getDataDir();
        const accountsJsonPath = path.join(dataDir, 'accounts.json');
        const projectsJsonPath = path.join(dataDir, 'projects.json');
        const sessionsDir = getSessionsDir();

        // 1. Migrate Accounts
        if (fs.existsSync(accountsJsonPath)) {
            console.log('Migrating accounts...');
            const accountsData = JSON.parse(fs.readFileSync(accountsJsonPath, 'utf8'));
            for (const key in accountsData) {
                const accountId = parseInt(key, 10);
                if (isNaN(accountId)) continue;

                const data = accountsData[key];
                const existing = await accountRepository.findOneBy({ id: accountId });
                if (!existing) {
                    const account = new Account();
                    account.id = accountId;
                    account.login = data.login;
                    account.passwordHash = data.passwordHash;
                    account.tokenSecret = randomBytes(32).toString('hex');
                    await accountRepository.save(account);
                    console.log(`Migrated account ${accountId} (${data.login})`);
                }
            }
        }

        // 2. Migrate Projects
        if (fs.existsSync(projectsJsonPath)) {
            console.log('Migrating projects...');
            const projectsData = JSON.parse(fs.readFileSync(projectsJsonPath, 'utf8'));
            for (const projectData of projectsData) {
                const existing = await projectRepository.findOneBy({ id: projectData.id });
                if (!existing) {
                    const project = new Project();
                    project.id = projectData.id;
                    project.name = projectData.name || 'Untitled Project';
                    project.accountId = projectData.accountId;
                    project.rulesAndGoal = projectData.rulesAndGoal || '';
                    project.imageGenerationPref = projectData.imageGenerationPref;
                    project.defaultProvider = projectData.defaultProvider;
                    project.modelRole = projectData.modelRole;
                    project.sessionIds = projectData.sessionIds || [];
                    project.lastAssignedSessionGroup = projectData.lastAssignedSessionGroup;
                    project.activeSessionId = projectData.activeSessionId;
                    project.createdAt = projectData.createdAt ? new Date(projectData.createdAt) : new Date();
                    project.updatedAt = projectData.updatedAt ? new Date(projectData.updatedAt) : new Date();
                    await projectRepository.save(project);
                    console.log(`Migrated project ${projectData.id}`);
                }
            }
        }

        // 3. Migrate Sessions
        if (!fs.existsSync(sessionsDir)) {
            console.warn(`Sessions directory not found: ${sessionsDir}`);
        } else {
            const sessionIds = fs.readdirSync(sessionsDir).filter(f => {
                return fs.statSync(path.join(sessionsDir, f)).isDirectory();
            });

            console.log(`Found ${sessionIds.length} sessions to migrate.`);

            for (const sessionId of sessionIds) {
                const sessionPath = path.join(sessionsDir, sessionId);
                const sessionJsonPath = path.join(sessionPath, 'session.json');
                const contextJsonPath = path.join(sessionPath, 'context.json');
                const turnsJsonPath = path.join(sessionPath, 'turns.json');

                if (!fs.existsSync(sessionJsonPath)) {
                    continue;
                }

                try {
                    // Always try to clean up before re-migrating to ensure correctness
                    await turnRepository.delete({ sessionId });
                    await contextRepository.delete({ sessionId });
                    await sessionRepository.delete({ sessionId });

                    const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));

                    // Ensure project exists (FK constraint)
                    let projectId = sessionData.projectId || '';
                    if (projectId) {
                        const projectExists = await projectRepository.findOneBy({ id: projectId });
                        if (!projectExists) {
                            console.warn(`Session ${sessionId} references missing project ${projectId}. Creating stub.`);
                            const stub = new Project();
                            stub.id = projectId;
                            stub.name = `Recovered Project (${projectId})`;
                            stub.rulesAndGoal = 'Automatically created during migration';
                            stub.sessionIds = [];
                            await projectRepository.save(stub);
                        }
                    } else {
                        projectId = 'no-project';
                        const noProject = await projectRepository.findOneBy({ id: projectId });
                        if (!noProject) {
                            const stub = new Project();
                            stub.id = projectId;
                            stub.name = 'No Project';
                            stub.rulesAndGoal = 'Default project for unassigned sessions';
                            stub.sessionIds = [];
                            await projectRepository.save(stub);
                        }
                    }

                    console.log(`Migrating session ${sessionId}...`);

                    const session = new Session();
                    session.sessionId = sessionId;
                    session.projectId = projectId;
                    session.updatedAt = new Date(sessionData.updatedAt || Date.now());
                    session.group = sessionData.group ?? 0;
                    session.currentVersion = sessionData.currentVersion ?? 0;
                    session.lastTurn = typeof sessionData.lastTurn === 'number' ? sessionData.lastTurn : null;
                    session.provider = sessionData.provider || 'openai';
                    session.fastMode = !!sessionData.fastMode;
                    session.status = sessionData.status || 'idle';
                    session.errorMessage = sessionData.errorMessage;
                    session.subject = sessionData.subject;
                    session.summary = sessionData.summary;
                    session.summaryTurn = typeof sessionData.summaryTurn === 'number' ? sessionData.summaryTurn : null;

                    await sessionRepository.save(session);

                    // Read context.json
                    if (fs.existsSync(contextJsonPath)) {
                        const contextsData = JSON.parse(fs.readFileSync(contextJsonPath, 'utf8'));
                        if (Array.isArray(contextsData) && contextsData.length > 0) {
                            const contexts = contextsData.map((c) => {
                                const ctx = new SessionContext();
                                ctx.sessionId = sessionId;
                                ctx.role = c.role;
                                ctx.content = c.content;
                                // Fix: use .selector instead of stringifying the whole object
                                ctx.selection = c.selection?.selector || (typeof c.selection === 'string' ? c.selection : null);
                                ctx.version = c.version ?? 0;
                                ctx.turn = c.turn ?? 0;
                                ctx.createdAt = c.createdAt ? new Date(c.createdAt) : new Date();
                                return ctx;
                            });
                            await contextRepository.save(contexts);
                        }
                    }

                    // Read turns.json
                    if (fs.existsSync(turnsJsonPath)) {
                        const turnsData = JSON.parse(fs.readFileSync(turnsJsonPath, 'utf8'));
                        if (Array.isArray(turnsData) && turnsData.length > 0) {
                            const turns = turnsData.map(t => {
                                const turn = new SessionTurn();
                                turn.sessionId = sessionId;
                                turn.turn = t.turn;
                                turn.request = typeof t.request === 'string' ? t.request : JSON.stringify(t.request);
                                turn.response = typeof t.response === 'string' ? t.response : JSON.stringify(t.response);
                                turn.version = t.version ?? 0;
                                turn.provider = t.provider || 'openai';
                                turn.fastMode = !!t.fastMode;
                                // Fix: use .selector instead of stringifying the whole object
                                turn.selection = t.selection?.selector || (typeof t.selection === 'string' ? t.selection : null);
                                turn.beginTime = t.createdAt ? new Date(t.createdAt) : new Date();
                                return turn;
                            });
                            await turnRepository.save(turns);
                        }
                    }

                    console.log(`Successfully migrated session ${sessionId}.`);
                } catch (err) {
                    console.error(`Failed to migrate session ${sessionId}:`, err);
                }
            }
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
