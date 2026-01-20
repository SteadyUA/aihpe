import { MigrationInterface, QueryRunner } from "typeorm";

export class RefactorAccountAuth1768898162949 implements MigrationInterface {
    name = 'RefactorAccountAuth1768898162949'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);
        await queryRunner.query(`INSERT INTO "temporary_account"("id", "login", "passwordHash") SELECT "id", "login", "passwordHash" FROM "account"`);
        await queryRunner.query(`DROP TABLE "account"`);
        await queryRunner.query(`ALTER TABLE "temporary_account" RENAME TO "account"`);
        await queryRunner.query(`CREATE TABLE "temporary_account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, "tokenSecret" varchar NOT NULL DEFAULT (hex(randomblob(32))), CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);
        await queryRunner.query(`INSERT INTO "temporary_account"("id", "login", "passwordHash") SELECT "id", "login", "passwordHash" FROM "account"`);
        await queryRunner.query(`DROP TABLE "account"`);
        await queryRunner.query(`ALTER TABLE "temporary_account" RENAME TO "account"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "account" RENAME TO "temporary_account"`);
        await queryRunner.query(`CREATE TABLE "account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);
        await queryRunner.query(`INSERT INTO "account"("id", "login", "passwordHash") SELECT "id", "login", "passwordHash" FROM "temporary_account"`);
        await queryRunner.query(`DROP TABLE "temporary_account"`);
        await queryRunner.query(`ALTER TABLE "account" RENAME TO "temporary_account"`);
        await queryRunner.query(`CREATE TABLE "account" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "login" varchar NOT NULL, "passwordHash" varchar NOT NULL, "accessToken" varchar, "refreshToken" varchar, CONSTRAINT "UQ_02ec5e354b7a10ffa2e1c0b70e3" UNIQUE ("login"))`);
        await queryRunner.query(`INSERT INTO "account"("id", "login", "passwordHash") SELECT "id", "login", "passwordHash" FROM "temporary_account"`);
        await queryRunner.query(`DROP TABLE "temporary_account"`);
    }

}
