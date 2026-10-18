/*
  Warnings:

  - You are about to drop the column `password_hash` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `sessions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "password_hash";

-- DropTable
DROP TABLE "sessions";
