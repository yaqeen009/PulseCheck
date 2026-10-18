import EmbeddedPostgres from 'embedded-postgres';

export interface EmbeddedPostgresHandle {
  instance: EmbeddedPostgres;
  dataDir: string;
  port: number;
  database: string;
  connectionString: string;
  /** True when this process started the cluster (and therefore owns stopping it). */
  started: boolean;
  stop: () => Promise<void>;
}

export interface StartEmbeddedPostgresOptions {
  dataDir: string;
  port: number;
  database: string;
  user?: string;
  password?: string;
  /** Log cluster output. Defaults to silence, to keep dev output readable. */
  verbose?: boolean;
}

/**
 * Start (or reuse) a local PostgreSQL cluster using the `embedded-postgres`
 * binaries.
 *
 * This exists because the project must run without Docker or a system-wide
 * PostgreSQL install during development and CI. It is never used in production:
 * production points `DATABASE_URL` at a real PostgreSQL server.
 */
export async function startEmbeddedPostgres(
  options: StartEmbeddedPostgresOptions,
): Promise<EmbeddedPostgresHandle> {
  const user = options.user ?? 'postgres';
  const password = options.password ?? 'password';
  const { dataDir, port, database } = options;

  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user,
    password,
    persistent: true,
    onLog: options.verbose ? (message) => console.log(`[pg] ${message}`) : () => {},
    onError: (error) => {
      const text = error instanceof Error ? error.message : String(error);
      if (/already running|shutting down/i.test(text)) return;
      if (stopping && /terminating connection|connection terminated/i.test(text)) return;
      console.error(`[pg] ${text}`);
    },
  });

  const connectionString = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;

  // PostgreSQL reports in-flight connections being cut as "errors" while the
  // cluster is shutting down. That is expected; it is only noise.
  let stopping = false;

  // `initialise()` is idempotent only in the sense that it errors on a
  // populated data directory, so guard on the marker file initdb writes.
  const alreadyInitialised = await markerExists(dataDir);
  if (!alreadyInitialised) {
    await instance.initialise();
  }

  await instance.start();

  try {
    await instance.createDatabase(database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  }

  return {
    instance,
    dataDir,
    port,
    database,
    connectionString,
    started: true,
    stop: async () => {
      stopping = true;
      try {
        await instance.stop();
      } finally {
        stopping = false;
      }
    },
  };
}

async function markerExists(dataDir: string): Promise<boolean> {
  const { existsSync } = await import('node:fs');
  const path = await import('node:path');
  return existsSync(path.join(dataDir, 'PG_VERSION'));
}
