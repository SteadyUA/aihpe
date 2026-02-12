
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import { AppDataSource } from '../data-source';
import { SessionImage } from '../entities/SessionImage';
import { getSessionsDir } from '../utils/pathUtils';

async function migrate() {
    console.log('Initializing DataSource...');
    await AppDataSource.initialize();
    console.log('DataSource initialized.');

    const repository = AppDataSource.getRepository(SessionImage);
    const sessionsDir = getSessionsDir();

    if (!fs.existsSync(sessionsDir)) {
        console.log('No sessions directory found.');
        return;
    }

    const sessionIds = fs.readdirSync(sessionsDir);
    console.log(`Found ${sessionIds.length} sessions.`);

    for (const sessionId of sessionIds) {
        const sessionPath = path.join(sessionsDir, sessionId);
        if (!fs.lstatSync(sessionPath).isDirectory()) continue;

        // Try to find projectId
        let projectId = 'unknown';
        const sessionJsonPath = path.join(sessionPath, 'session.json');
        if (fs.existsSync(sessionJsonPath)) {
            try {
                const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf-8'));
                if (sessionData.projectId) {
                    projectId = sessionData.projectId;
                }
            } catch (e) {
                console.error(`Failed to read session.json for ${sessionId}`, e);
            }
        }

        const versionsDir = path.join(sessionPath, 'versions');
        if (!fs.existsSync(versionsDir)) continue;

        const versions = fs.readdirSync(versionsDir);

        for (const versionStr of versions) {
            const version = parseInt(versionStr, 10);
            if (isNaN(version)) continue;

            const imagesJsonPath = path.join(versionsDir, versionStr, 'images.json');
            if (!fs.existsSync(imagesJsonPath)) continue;

            try {
                const imagesData = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf-8'));
                if (!Array.isArray(imagesData)) continue;

                for (const img of imagesData) {
                    // Check if already exists
                    const existing = await repository.findOne({ where: { sessionId, version, filename: img.filename } });
                    if (existing) {
                        console.log(`Skipping existing image ${img.filename} in ${sessionId} v${version}`);
                        continue;
                    }

                    const newImage = new SessionImage();
                    newImage.sessionId = sessionId;
                    newImage.version = version;
                    newImage.filename = img.filename;
                    newImage.description = img.description || '';
                    newImage.createdAt = new Date(img.createdAt || new Date());
                    newImage.model = img.model || 'gemini-2.5-flash-image';
                    newImage.width = img.width;
                    newImage.height = img.height;
                    newImage.isUsed = img.isUsed || false;

                    await repository.save(newImage);
                    console.log(`Migrated image ${img.filename} in ${sessionId} v${version}`);
                }
            } catch (e) {
                console.error(`Failed to migrate images for ${sessionId} v${version}`, e);
            }
        }
    }

    console.log('Migration completed.');
    process.exit(0);
}

migrate().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
