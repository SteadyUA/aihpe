import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectStatusAndJobId1772184428014 implements MigrationInterface {
    name = 'AddProjectStatusAndJobId1772184428014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" ADD "status" varchar NOT NULL DEFAULT 'ready'`);
        await queryRunner.query(`ALTER TABLE "project" ADD "jobId" varchar`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "jobId"`);
        await queryRunner.query(`ALTER TABLE "project" DROP COLUMN "status"`);
    }

}
