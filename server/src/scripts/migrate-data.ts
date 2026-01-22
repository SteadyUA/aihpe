
import 'reflect-metadata';
import crypto from 'node:crypto';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../data-source';
import { Account } from '../entities/Account';
import { Project } from '../entities/Project';

import { getDataDir } from '../utils/pathUtils';

const DATA_DIR = getDataDir();
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

async function migrateData() {
    console.log('Starting migration...');

    await AppDataSource.initialize();
    console.log('Database initialized.');

    // Migrate Accounts
    if (fs.existsSync(ACCOUNTS_FILE)) {
        try {
            console.log(`Reading accounts from ${ACCOUNTS_FILE}...`);
            const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
            const data = JSON.parse(raw);
            const accounts = data.accounts ? Object.values(data.accounts) : [];

            if (accounts.length > 0) {
                const accountRepo = AppDataSource.getRepository(Account);
                console.log(`Found ${accounts.length} accounts. Migrating...`);

                for (const acc of accounts as any[]) {
                    // Check if exists
                    const existing = await accountRepo.findOneBy({ login: acc.login });
                    if (existing) {
                        console.log(`Account ${acc.login} already exists. Skipping.`);
                        continue;
                    }

                    const newAccount = new Account();
                    // We try to preserve ID if possible
                    newAccount.id = acc.id;
                    newAccount.login = acc.login;
                    newAccount.passwordHash = acc.passwordHash;
                    if (acc.tokens) {
                        // Old tokens are no longer compatible.
                        // We generate a new secret for the account.
                        newAccount.tokenSecret = crypto.randomBytes(32).toString('hex');
                    } else {
                        newAccount.tokenSecret = crypto.randomBytes(32).toString('hex');
                    }

                    await accountRepo.save(newAccount);
                    console.log(`Migrated account: ${acc.login} (ID: ${acc.id})`);
                }
            }
        } catch (e) {
            console.error('Failed to migrate accounts', e);
        }
    } else {
        console.log('No accounts.json found.');
    }

    // Migrate Projects
    if (fs.existsSync(PROJECTS_FILE)) {
        try {
            console.log(`Reading projects from ${PROJECTS_FILE}...`);
            const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
            const data = JSON.parse(raw); // Array of projects

            if (Array.isArray(data) && data.length > 0) {
                const projectRepo = AppDataSource.getRepository(Project);
                console.log(`Found ${data.length} projects. Migrating...`);

                for (const p of data as any[]) {
                    const existing = await projectRepo.findOneBy({ id: p.id });
                    if (existing) {
                        console.log(`Project ${p.id} already exists. Skipping.`);
                        continue;
                    }

                    const newProject = new Project();
                    newProject.id = p.id;
                    newProject.name = p.name || 'Untitled';
                    newProject.accountId = p.accountId ?? null;
                    newProject.rulesAndGoal = p.rulesAndGoal || (p as any).goal || '';
                    newProject.imageGenerationPref = p.imageGenerationPref;
                    newProject.defaultProvider = p.defaultProvider;
                    newProject.modelRole = p.modelRole;
                    newProject.sessionIds = Array.isArray(p.sessionIds) ? p.sessionIds : [];
                    newProject.lastAssignedSessionGroup = p.lastAssignedSessionGroup;
                    newProject.activeSessionId = p.activeSessionId;
                    newProject.createdAt = p.createdAt ? new Date(p.createdAt) : new Date();
                    newProject.updatedAt = p.updatedAt ? new Date(p.updatedAt) : new Date();

                    await projectRepo.save(newProject);
                    console.log(`Migrated project: ${newProject.name} (ID: ${p.id})`);
                }
            }
        } catch (e) {
            console.error('Failed to migrate projects', e);
        }
    } else {
        console.log('No projects.json found.');
    }

    console.log('Migration complete.');
    process.exit(0);
}

migrateData().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});
