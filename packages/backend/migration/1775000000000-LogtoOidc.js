/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class LogtoOidc1775000000000 {
    name = 'LogtoOidc1775000000000'

    async up(queryRunner) {
        // Add Logto configuration columns to meta table
        await queryRunner.query(`ALTER TABLE "meta" ADD "enableLogto" boolean DEFAULT false NOT NULL`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "logtoIssuerUrl" character varying(2048) NULL`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "logtoClientId" character varying(256) NULL`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "logtoClientSecret" character varying(256) NULL`);

        // Add disablePasswordSignup to meta table
        await queryRunner.query(`ALTER TABLE "meta" ADD "disablePasswordSignup" boolean DEFAULT false NOT NULL`);

        // Add logtoSub and pinCodeHash columns to user_profile table
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "logtoSub" character varying(256) NULL`);
        await queryRunner.query(`ALTER TABLE "user_profile" ADD "pinCodeHash" character varying(256) NULL`);

        // Create unique index for logtoSub
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_profile_logtoSub" ON "user_profile" ("logtoSub") WHERE "logtoSub" IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_user_profile_logtoSub"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "pinCodeHash"`);
        await queryRunner.query(`ALTER TABLE "user_profile" DROP COLUMN "logtoSub"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "disablePasswordSignup"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "logtoClientSecret"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "logtoClientId"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "logtoIssuerUrl"`);
        await queryRunner.query(`ALTER TABLE "meta" DROP COLUMN "enableLogto"`);
    }
}
