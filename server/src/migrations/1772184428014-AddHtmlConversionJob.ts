import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHtmlConversionJob1772184428014 implements MigrationInterface {
    name = 'AddHtmlConversionJob1772184428014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "job" ("id" varchar PRIMARY KEY NOT NULL, "status" varchar NOT NULL DEFAULT ('pending'), "steps" text NOT NULL DEFAULT ('[]'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "job"`);
    }

}
