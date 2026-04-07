import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProviderDataToContext1772797664928 implements MigrationInterface {
    name = 'AddProviderDataToContext1772797664928'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_fb44d1f6b20bef83d789e54cb3"`);
        await queryRunner.query(`CREATE TABLE "temporary_session_context" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "role" varchar NOT NULL, "content" text NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, "turn" integer NOT NULL, "createdAt" datetime NOT NULL, "providerData" text, CONSTRAINT "FK_d2ed909b0d1f3355b767caf0e5e" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_session_context"("id", "sessionId", "role", "content", "selection", "uploadId", "version", "turn", "createdAt") SELECT "id", "sessionId", "role", "content", "selection", "uploadId", "version", "turn", "createdAt" FROM "session_context"`);
        await queryRunner.query(`DROP TABLE "session_context"`);
        await queryRunner.query(`ALTER TABLE "temporary_session_context" RENAME TO "session_context"`);
        await queryRunner.query(`CREATE INDEX "IDX_fb44d1f6b20bef83d789e54cb3" ON "session_context" ("sessionId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_fb44d1f6b20bef83d789e54cb3"`);
        await queryRunner.query(`ALTER TABLE "session_context" RENAME TO "temporary_session_context"`);
        await queryRunner.query(`CREATE TABLE "session_context" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "sessionId" varchar NOT NULL, "role" varchar NOT NULL, "content" text NOT NULL, "selection" text, "uploadId" integer, "version" integer NOT NULL, "turn" integer NOT NULL, "createdAt" datetime NOT NULL, CONSTRAINT "FK_d2ed909b0d1f3355b767caf0e5e" FOREIGN KEY ("uploadId") REFERENCES "session_upload" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "session_context"("id", "sessionId", "role", "content", "selection", "uploadId", "version", "turn", "createdAt") SELECT "id", "sessionId", "role", "content", "selection", "uploadId", "version", "turn", "createdAt" FROM "temporary_session_context"`);
        await queryRunner.query(`DROP TABLE "temporary_session_context"`);
        await queryRunner.query(`CREATE INDEX "IDX_fb44d1f6b20bef83d789e54cb3" ON "session_context" ("sessionId") `);
    }

}
