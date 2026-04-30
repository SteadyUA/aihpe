import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameSessionImageToResource1777487189979 implements MigrationInterface {
    name = 'RenameSessionImageToResource1777487189979'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Create the new table and index
        await queryRunner.query(`CREATE TABLE "session_resource" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "version" integer NOT NULL, "filename" varchar NOT NULL, "mimetype" varchar NOT NULL, "metadata" text DEFAULT ('{}'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_143fcc1f9058f29f8bca418afb" ON "session_resource" ("sessionId", "version") `);

        // 2. Migrate existing data from session_image to session_resource
        const images = await queryRunner.query(`SELECT * FROM "session_image"`);
        for (const img of images) {
            const ext = img.filename.split('.').pop()?.toLowerCase();
            let mimetype = 'image/png';
            if (ext === 'jpg' || ext === 'jpeg') mimetype = 'image/jpeg';
            else if (ext === 'webp') mimetype = 'image/webp';
            else if (ext === 'heic') mimetype = 'image/heic';
            else if (ext === 'heif') mimetype = 'image/heif';

            const metadata = JSON.stringify({
                description: img.description,
                model: img.model,
                width: img.width,
                height: img.height,
                isUsed: img.isUsed === 1 || img.isUsed === true
            });

            await queryRunner.query(
                `INSERT INTO "session_resource" ("sessionId", "version", "filename", "mimetype", "metadata", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
                [img.sessionId, img.version, img.filename, mimetype, metadata, img.createdAt]
            );
        }

        // 3. Drop old table
        await queryRunner.query(`DROP TABLE "session_image"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 1. Recreate the old table and index
        await queryRunner.query(`CREATE TABLE "session_image" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "version" integer NOT NULL, "filename" varchar NOT NULL, "description" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "model" varchar NOT NULL, "width" integer, "height" integer, "isUsed" boolean NOT NULL)`);
        await queryRunner.query(`CREATE INDEX "IDX_36652c7102e3b2e3ccb862128b" ON "session_image" ("sessionId", "version") `);

        // 2. Migrate data back
        const resources = await queryRunner.query(`SELECT * FROM "session_resource" WHERE "mimetype" LIKE 'image/%'`);
        for (const res of resources) {
            let metadata: any = {};
            try {
                metadata = JSON.parse(res.metadata);
            } catch (e) {}

            await queryRunner.query(
                `INSERT INTO "session_image" ("sessionId", "version", "filename", "description", "createdAt", "model", "width", "height", "isUsed") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    res.sessionId,
                    res.version,
                    res.filename,
                    metadata.description || '',
                    res.createdAt,
                    metadata.model || 'unknown',
                    metadata.width || null,
                    metadata.height || null,
                    metadata.isUsed ? 1 : 0
                ]
            );
        }

        // 3. Drop new table
        await queryRunner.query(`DROP TABLE "session_resource"`);
    }

}
