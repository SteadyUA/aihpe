import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveProjectPreferencesColumns1777022874573 implements MigrationInterface {
    name = 'RemoveProjectPreferencesColumns1777022874573'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_project" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "accountId" integer, "defaultProvider" text, "sessionIds" text NOT NULL DEFAULT ('[]'), "lastAssignedSessionGroup" integer, "activeSessionId" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "status" varchar NOT NULL DEFAULT ('ready'), "taskId" varchar)`);
        await queryRunner.query(`INSERT INTO "temporary_project"("id", "name", "accountId", "defaultProvider", "sessionIds", "lastAssignedSessionGroup", "activeSessionId", "createdAt", "updatedAt", "status", "taskId") SELECT "id", "name", "accountId", "defaultProvider", "sessionIds", "lastAssignedSessionGroup", "activeSessionId", "createdAt", "updatedAt", "status", "taskId" FROM "project"`);
        await queryRunner.query(`DROP TABLE "project"`);
        await queryRunner.query(`ALTER TABLE "temporary_project" RENAME TO "project"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" RENAME TO "temporary_project"`);
        await queryRunner.query(`CREATE TABLE "project" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "accountId" integer, "rulesAndGoal" text NOT NULL, "imageGenerationPref" varchar, "defaultProvider" text, "modelRole" varchar, "sessionIds" text NOT NULL DEFAULT ('[]'), "lastAssignedSessionGroup" integer, "activeSessionId" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "status" varchar NOT NULL DEFAULT ('ready'), "taskId" varchar)`);
        await queryRunner.query(`INSERT INTO "project"("id", "name", "accountId", "defaultProvider", "sessionIds", "lastAssignedSessionGroup", "activeSessionId", "createdAt", "updatedAt", "status", "taskId") SELECT "id", "name", "accountId", "defaultProvider", "sessionIds", "lastAssignedSessionGroup", "activeSessionId", "createdAt", "updatedAt", "status", "taskId" FROM "temporary_project"`);
        await queryRunner.query(`DROP TABLE "temporary_project"`);
    }

}
