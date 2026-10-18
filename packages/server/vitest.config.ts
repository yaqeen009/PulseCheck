/**
 * Vitest configuration for the server package.
 *
 * The test database is a second embedded PostgreSQL cluster (port 55433, data
 * directory `.pgdata-test`) so running the suite never touches the development
 * database on port 55432. `global-setup.ts` starts it and applies migrations.
 *
 * `test.env` is applied to every worker before any module is imported, which
 * matters because `src/env.ts` validates `process.env` at import time.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one PostgreSQL cluster; running files in parallel
    // would make failures depend on timing rather than on behaviour.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      PORT: '4101',
      WEB_ORIGIN: 'http://localhost:5273',
      DATABASE_URL: 'postgresql://postgres:password@127.0.0.1:55433/pulsecheck_test?schema=public',
      DIRECT_URL: '',
      // Test tokens are signed and verified locally (see test/helpers/jwt.ts), so
      // these only need to be well-formed; no request leaves the process.
      NEON_AUTH_BASE_URL: 'https://test-neon-auth.local',
      SCHEDULER_ENABLED: 'false',
      WORKER_ENABLED: 'false',
      // Tests monitor mock servers on 127.0.0.1; the SSRF policy is exercised
      // explicitly in ssrf/checker tests with `blockPrivateNetworks: true`.
      BLOCK_PRIVATE_NETWORKS: 'false',
      REQUIRE_HTTPS_TARGETS: 'false',
      RATE_LIMIT_AUTH_MAX: '10000',
      RATE_LIMIT_API_MAX: '100000',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: 'false',
    },
  },
});
