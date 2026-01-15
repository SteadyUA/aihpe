import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1768477218843 implements MigrationInterface {
    name = 'InitialMigration1768477218843'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "project" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "accountId" integer, "rulesAndGoal" text NOT NULL, "imageGenerationPref" varchar, "defaultProvider" text, "modelRole" varchar, "sessionIds" text NOT NULL DEFAULT ('[]'), "lastAssignedSessionGroup" integer, "activeSessionId" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE TABLE "account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, "accessToken" varchar, "refreshToken" varchar, CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "account"`);
        await queryRunner.query(`DROP TABLE "project"`);
    }

}
