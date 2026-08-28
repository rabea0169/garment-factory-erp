-- SEC-F04: Refresh token model + jwtVersion field on users
-- Adds:
--   1. users.jwt_version INT NOT NULL DEFAULT 0
--   2. refresh_tokens table (id, user_id, token_hash, expires_at, revoked_at, replaced_by_id, user_agent, ip_address, created_at)
--   3. FK from refresh_tokens.user_id -> users.id (ON DELETE CASCADE)
--   4. FK from refresh_tokens.replaced_by_id -> refresh_tokens.id (ON DELETE SET NULL — self-relation)
--   5. Unique on refresh_tokens.token_hash
--   6. Indexes on user_id and expires_at

-- Step 1: add jwt_version to users (idempotent)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "jwt_version" INTEGER NOT NULL DEFAULT 0;

-- Step 2: create refresh_tokens table
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Step 3: indexes (idempotent)
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- Step 4: FKs (defer if exists — use DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'refresh_tokens_user_id_fkey' AND table_name = 'refresh_tokens'
  ) THEN
    ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "refresh_tokens_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'refresh_tokens_replaced_by_id_fkey' AND table_name = 'refresh_tokens'
  ) THEN
    ALTER TABLE "refresh_tokens"
      ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey"
      FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
