import { afterAll, describe, expect, it } from 'vitest';
import type { HealthDto } from '@pulsecheck/shared';
import { prisma } from '../../src/db.js';
import { createTestContext } from '../helpers/factories.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /health/live', () => {
  it('answers 200 without touching the database', async () => {
    const response = await createTestContext().client.get('/health/live');

    expect(response.status).toBe(200);
    const body = response.body as HealthDto;
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.version).toBe('string');
    expect(body.checks).toEqual({});
  });
});

describe('GET /health/ready', () => {
  it('answers 200 and reports the database as reachable', async () => {
    const response = await createTestContext().client.get('/health/ready');

    expect(response.status).toBe(200);
    const body = response.body as HealthDto;
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
  });
});

describe('GET /', () => {
  it('advertises the API namespace and health endpoints', async () => {
    const response = await createTestContext().client.get('/');

    expect(response.status).toBe(200);
    expect(response.body.api).toBe('/api/v1');
    expect(response.body.health).toEqual({ live: '/health/live', ready: '/health/ready' });
  });
});

describe('security headers', () => {
  it('sets a strict content security policy and hides the technology', async () => {
    const response = await createTestContext().client.get('/health/live');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});
