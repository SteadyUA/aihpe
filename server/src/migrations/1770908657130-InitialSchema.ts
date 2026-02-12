import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1770908657130 implements MigrationInterface {
    name = 'InitialSchema1770908657130'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Independent Tables
        await queryRunner.query(`CREATE TABLE "token_usage" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "projectId" varchar NOT NULL, "sessionId" varchar NOT NULL, "agent" varchar NOT NULL DEFAULT ('chat'), "turn" integer NOT NULL, "model" varchar NOT NULL, "total" integer NOT NULL, "prompt" integer NOT NULL, "completion" integer NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_d5fb9ed022f36dd6fd406ff3f1" ON "token_usage" ("projectId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3b0c4a7cbf52a03e68b8db31d9" ON "token_usage" ("sessionId", "agent") `);

        await queryRunner.query(`CREATE TABLE "session_upload" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "filename" varchar NOT NULL, "originalName" varchar NOT NULL, "mimeType" varchar NOT NULL, "size" integer NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_35e857e65be1ed2d9a3224e522" ON "session_upload" ("sessionId") `);

        await queryRunner.query(`CREATE TABLE "session_image" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "version" integer NOT NULL, "filename" varchar NOT NULL, "description" text NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "model" varchar NOT NULL, "width" integer, "height" integer, "isUsed" boolean NOT NULL)`);
        await queryRunner.query(`CREATE INDEX "IDX_952ccccd9657495ed34785a123" ON "session_image" ("sessionId", "version") `);

        await queryRunner.query(`CREATE TABLE "account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, "tokenSecret" varchar NOT NULL, CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);

        await queryRunner.query(`CREATE TABLE "project" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "accountId" integer, "rulesAndGoal" text NOT NULL, "imageGenerationPref" varchar, "defaultProvider" text, "modelRole" varchar, "sessionIds" text NOT NULL DEFAULT ('[]'), "lastAssignedSessionGroup" integer, "activeSessionId" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`);

        // 2. Dependent Tables

        // Session depends on Project
        await queryRunner.query(`CREATE TABLE "session" ("sessionId" varchar PRIMARY KEY NOT NULL, "projectId" varchar NOT NULL, "group" integer NOT NULL, "currentVersion" integer NOT NULL, "lastTurn" integer, "provider" varchar NOT NULL, "status" varchar NOT NULL, "fastMode" boolean NOT NULL, "subject" text, "summary" text, "summaryTurn" integer, "errorMessage" text, "updatedAt" datetime NOT NULL, CONSTRAINT "FK_5d6cdc979e4cf4e067943fedd8f" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);

        // Tables dependent on SessionUpload
        await queryRunner.query(`CREATE TABLE "session_unsent" ("sessionId" varchar PRIMARY KEY NOT NULL, "input" text, "provider" varchar, "fastMode" boolean, "selection" text, "uploadId" integer, CONSTRAINT "REL_70a6f30d6699d9620ce2e0539f" UNIQUE ("uploadId"), CONSTRAINT "FK_70a6f30d6699d9620ce2e0539f0" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);

        await queryRunner.query(`CREATE TABLE "session_turn" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "turn" integer NOT NULL, "beginTime" datetime NOT NULL, "endTime" datetime, "request" text NOT NULL, "response" text NOT NULL, "provider" varchar NOT NULL, "fastMode" boolean NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, CONSTRAINT "FK_4f6edc5c023b185dc954fe930a2" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`CREATE INDEX "IDX_99c4d32c355c821e532350caf9" ON "session_turn" ("sessionId") `);

        await queryRunner.query(`CREATE TABLE "session_context" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "role" varchar NOT NULL, "content" text NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, "turn" integer NOT NULL, "createdAt" datetime NOT NULL, CONSTRAINT "FK_d2ed909b0d1f3355b767caf0e5e" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`CREATE INDEX "IDX_fb44d1f6b20bef83d789e54cb3" ON "session_context" ("sessionId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_fb44d1f6b20bef83d789e54cb3"`);
        await queryRunner.query(`DROP TABLE "session_context"`);

        await queryRunner.query(`DROP INDEX "IDX_99c4d32c355c821e532350caf9"`);
        await queryRunner.query(`DROP TABLE "session_turn"`);

        await queryRunner.query(`DROP TABLE "session_unsent"`);

        await queryRunner.query(`DROP TABLE "session"`);

        await queryRunner.query(`DROP TABLE "project"`);

        await queryRunner.query(`DROP TABLE "account"`);

        await queryRunner.query(`DROP INDEX "IDX_952ccccd9657495ed34785a123"`);
        await queryRunner.query(`DROP TABLE "session_image"`);

        await queryRunner.query(`DROP INDEX "IDX_35e857e65be1ed2d9a3224e522"`);
        await queryRunner.query(`DROP TABLE "session_upload"`);

        await queryRunner.query(`DROP INDEX "IDX_3b0c4a7cbf52a03e68b8db31d9"`);
        await queryRunner.query(`DROP INDEX "IDX_d5fb9ed022f36dd6fd406ff3f1"`);
        await queryRunner.query(`DROP TABLE "token_usage"`);
    }

}

