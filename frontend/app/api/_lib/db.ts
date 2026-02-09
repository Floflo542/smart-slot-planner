import { neon } from "@neondatabase/serverless";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

export const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

function requireSql() {
  if (!sql) {
    throw new Error("DATABASE_URL manquant");
  }
  return sql;
}

export async function ensureUsersTable() {
  const db = requireSql();
  await db`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      ics_url TEXT NOT NULL,
      home_address TEXT NOT NULL,
      day_start TEXT NOT NULL,
      day_end TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      approved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;`;
  await db`UPDATE users SET approved = FALSE WHERE approved IS NULL;`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS home_address TEXT;`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS day_start TEXT;`;
  await db`ALTER TABLE users ADD COLUMN IF NOT EXISTS day_end TEXT;`;
  await db`UPDATE users SET home_address = COALESCE(home_address, '') WHERE home_address IS NULL;`;
  await db`UPDATE users SET day_start = COALESCE(day_start, '07:30') WHERE day_start IS NULL;`;
  await db`UPDATE users SET day_end = COALESCE(day_end, '16:30') WHERE day_end IS NULL;`;
}

export async function ensureResellersTable() {
  const db = requireSql();
  await db`
    CREATE TABLE IF NOT EXISTS resellers (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await db`ALTER TABLE resellers ADD COLUMN IF NOT EXISTS user_id TEXT;`;
  const columns = (await db`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'resellers'
  `) as Array<{ column_name: string; is_nullable: string }>;
  const commercialColumn = columns.find(
    (col) => col.column_name === "commercial"
  );
  if (commercialColumn && commercialColumn.is_nullable === "NO") {
    await db`ALTER TABLE resellers ALTER COLUMN commercial DROP NOT NULL;`;
  }
}

export async function ensureResetTable() {
  const db = requireSql();
  await db`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
  `;
  await db`
    CREATE INDEX IF NOT EXISTS password_resets_user_idx
    ON password_resets(user_id);
  `;
}
