import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * Prisma 7 no longer reads `.env` implicitly and no longer accepts `url` inside
 * the `datasource` block, so the CLI gets its connection string here. The
 * runtime client is configured separately with the `@prisma/adapter-pg` driver
 * adapter in `src/db.ts`.
 *
 * The config file is bundled and executed from a temporary directory, so it
 * cannot rely on `import.meta.dirname`. Instead it walks up from the working
 * directory looking for `.env` files and loads the outermost last, which makes
 * the repository root `.env` the base and any nearer file an override.
 */
function loadEnvironment(): void {
  const candidates: string[] = [];
  let directory = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(directory, '.env');
    if (existsSync(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  // Nearest file first, root file last (dotenv never overwrites an existing value).
  for (const candidate of candidates.reverse()) {
    loadDotenv({ path: candidate });
  }
}

loadEnvironment();

// `DIRECT_URL` wins when present: behind PgBouncer, migrations must bypass the
// transaction pooler. Empty strings count as "not set".
const url = (process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim() || '').trim();

if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env at the project root and set ' +
      'DATABASE_URL (or set DIRECT_URL when migrating through a connection pooler).',
  );
}

/** `DIRECT_URL` wins when present: behind PgBouncer, migrations must bypass the pooler. */
export default {
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url,
  },
};
