import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClipboardRecord1777280641227 implements MigrationInterface {
    name = 'AddClipboardRecord1777280641227'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "clipboard_record" ("id" varchar PRIMARY KEY NOT NULL, "accountId" integer NOT NULL, "projectId" varchar, "sessionId" varchar, "version" integer, "description" text NOT NULL, "isActive" boolean NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "clipboard_record"`);
    }

}
