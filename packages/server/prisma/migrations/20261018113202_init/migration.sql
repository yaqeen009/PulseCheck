-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('PENDING', 'HEALTHY', 'DEGRADED', 'DOWN', 'PAUSED');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('DNS', 'CONNECT', 'TLS', 'TIMEOUT', 'TOO_MANY_REDIRECTS', 'RESPONSE_TOO_LARGE', 'BLOCKED_DESTINATION', 'INVALID_URL', 'PROTOCOL', 'UNKNOWN', 'UNEXPECTED_STATUS');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "expected_status_min" INTEGER NOT NULL DEFAULT 200,
    "expected_status_max" INTEGER NOT NULL DEFAULT 299,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "body" TEXT,
    "degraded_response_time_ms" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "current_status" "MonitorStatus" NOT NULL DEFAULT 'PENDING',
    "last_checked_at" TIMESTAMPTZ(6),
    "last_status_change_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "next_check_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" CHAR(36),
    "lease_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_results" (
    "id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "http_status_code" INTEGER,
    "response_time_ms" INTEGER NOT NULL,
    "error_category" "ErrorCategory",
    "error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "initial_status" "MonitorStatus" NOT NULL,
    "peak_status" "MonitorStatus" NOT NULL,
    "latest_error_summary" VARCHAR(500),
    "failed_check_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "monitors_enabled_next_check_at_idx" ON "monitors"("enabled", "next_check_at");

-- CreateIndex
CREATE INDEX "monitors_user_id_created_at_idx" ON "monitors"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "monitors_user_id_current_status_idx" ON "monitors"("user_id", "current_status");

-- CreateIndex
CREATE INDEX "check_results_monitor_id_checked_at_idx" ON "check_results"("monitor_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "check_results_checked_at_idx" ON "check_results"("checked_at");

-- CreateIndex
CREATE INDEX "incidents_monitor_id_resolved_at_idx" ON "incidents"("monitor_id", "resolved_at");

-- CreateIndex
CREATE INDEX "incidents_monitor_id_started_at_idx" ON "incidents"("monitor_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
