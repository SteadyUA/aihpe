import { MigrationInterface, QueryRunner } from "typeorm";

export class AddResourceToSessionTurn1777915046896 implements MigrationInterface {
    name = 'AddResourceToSessionTurn1777915046896'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_99c4d32c355c821e532350caf9"`);
        await queryRunner.query(`CREATE TABLE "temporary_session_turn" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "turn" integer NOT NULL, "beginTime" datetime NOT NULL, "endTime" datetime, "request" text NOT NULL, "response" text NOT NULL, "provider" varchar NOT NULL, "fastMode" boolean NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, "resource" text, CONSTRAINT "FK_4f6edc5c023b185dc954fe930a2" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_session_turn"("id", "sessionId", "turn", "beginTime", "endTime", "request", "response", "provider", "fastMode", "selection", "uploadId", "version") SELECT "id", "sessionId", "turn", "beginTime", "endTime", "request", "response", "provider", "fastMode", "selection", "uploadId", "version" FROM "session_turn"`);
        await queryRunner.query(`DROP TABLE "session_turn"`);
        await queryRunner.query(`ALTER TABLE "temporary_session_turn" RENAME TO "session_turn"`);
        await queryRunner.query(`CREATE INDEX "IDX_99c4d32c355c821e532350caf9" ON "session_turn" ("sessionId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_99c4d32c355c821e532350caf9"`);
        await queryRunner.query(`ALTER TABLE "session_turn" RENAME TO "temporary_session_turn"`);
        await queryRunner.query(`CREATE TABLE "session_turn" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "turn" integer NOT NULL, "beginTime" datetime NOT NULL, "endTime" datetime, "request" text NOT NULL, "response" text NOT NULL, "provider" varchar NOT NULL, "fastMode" boolean NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, CONSTRAINT "FK_4f6edc5c023b185dc954fe930a2" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "session_turn"("id", "sessionId", "turn", "beginTime", "endTime", "request", "response", "provider", "fastMode", "selection", "uploadId", "version") SELECT "id", "sessionId", "turn", "beginTime", "endTime", "request", "response", "provider", "fastMode", "selection", "uploadId", "version" FROM "temporary_session_turn"`);
        await queryRunner.query(`DROP TABLE "temporary_session_turn"`);
        await queryRunner.query(`CREATE INDEX "IDX_99c4d32c355c821e532350caf9" ON "session_turn" ("sessionId") `);
    }

}
