import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveProjectForeignKey1776864334084 implements MigrationInterface {
    name = 'RemoveProjectForeignKey1776864334084'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_session" ("sessionId" varchar PRIMARY KEY NOT NULL, "projectId" varchar NOT NULL, "group" integer NOT NULL, "currentVersion" integer NOT NULL, "lastTurn" integer, "provider" varchar NOT NULL, "status" varchar NOT NULL, "fastMode" boolean NOT NULL, "subject" text, "summary" text, "summaryTurn" integer, "errorMessage" text, "updatedAt" datetime NOT NULL)`);
        await queryRunner.query(`INSERT INTO "temporary_session"("sessionId", "projectId", "group", "currentVersion", "lastTurn", "provider", "status", "fastMode", "subject", "summary", "summaryTurn", "errorMessage", "updatedAt") SELECT "sessionId", "projectId", "group", "currentVersion", "lastTurn", "provider", "status", "fastMode", "subject", "summary", "summaryTurn", "errorMessage", "updatedAt" FROM "session"`);
        await queryRunner.query(`DROP TABLE "session"`);
        await queryRunner.query(`ALTER TABLE "temporary_session" RENAME TO "session"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "session" RENAME TO "temporary_session"`);
        await queryRunner.query(`CREATE TABLE "session" ("sessionId" varchar PRIMARY KEY NOT NULL, "projectId" varchar NOT NULL, "group" integer NOT NULL, "currentVersion" integer NOT NULL, "lastTurn" integer, "provider" varchar NOT NULL, "status" varchar NOT NULL, "fastMode" boolean NOT NULL, "subject" text, "summary" text, "summaryTurn" integer, "errorMessage" text, "updatedAt" datetime NOT NULL, CONSTRAINT "FK_5d6cdc979e4cf4e067943fedd8f" FOREIGN KEY ("projectId") REFERENCES "project" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "session"("sessionId", "projectId", "group", "currentVersion", "lastTurn", "provider", "status", "fastMode", "subject", "summary", "summaryTurn", "errorMessage", "updatedAt") SELECT "sessionId", "projectId", "group", "currentVersion", "lastTurn", "provider", "status", "fastMode", "subject", "summary", "summaryTurn", "errorMessage", "updatedAt" FROM "temporary_session"`);
        await queryRunner.query(`DROP TABLE "temporary_session"`);
    }

}
