import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { cleanupUser, createTestContext, signUp, uniqueEmail } from '../helpers/factories.js';
import { signTestToken, wrongSigningKey } from '../helpers/jwt.js';

const createdUserIds: string[] = [];

function remember(id: string): string {
  createdUserIds.push(id);
  return id;
}

afterEach(async () => {
  for (const userId of createdUserIds.splice(0)) await cleanupUser(userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A signed-in client, with the user tracked for cleanup. */
async function signedIn(): Promise<{
  client: ReturnType<typeof createTestContext>['client'];
  userId: string;
  email: string;
}> {
  const { client } = createTestContext();
  const user = await signUp(client);
  remember(user.id);
  return { client, userId: user.id, email: user.email };
}

describe('GET /api/v1/auth/me', () => {
  it('returns the local user for a valid bearer token', async () => {
    const { client, userId, email } = await signedIn();

    const response = await client.get('/api/v1/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: userId, email });
    expect(typeof response.body.user.createdAt).toBe('string');
  });

  it('answers 401 UNAUTHENTICATED with no Authorization header', async () => {
    const response = await createTestContext().client.get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a malformed token', async () => {
    const { client } = createTestContext();
    client.setToken('not-a-real-jwt');

    const response = await client.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for a token signed by a different key', async () => {
    const { client } = createTestContext();
    const token = await signTestToken(
      { sub: randomUUID(), email: uniqueEmail('wrong-key') },
      { key: wrongSigningKey },
    );
    client.setToken(token);

    const response = await client.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 for an expired token', async () => {
    const { client } = createTestContext();
    const token = await signTestToken(
      { sub: randomUUID(), email: uniqueEmail('expired') },
      { expiresIn: '-10s' },
    );
    client.setToken(token);

    const response = await client.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers 401 when the token has a sub but no email claim', async () => {
    const { client } = createTestContext();
    const token = await signTestToken({ sub: randomUUID(), name: 'No Email' });
    client.setToken(token);

    const response = await client.get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('local user provisioning', () => {
  it('creates the row exactly once for an unknown sub and leaves it alone after', async () => {
    const { client } = createTestContext();
    const sub = randomUUID();
    const email = uniqueEmail('provision');
    remember(sub);
    client.setToken(await signTestToken({ sub, email }));

    const first = await client.get('/api/v1/auth/me');
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ id: sub, email });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: sub } });

    const second = await client.get('/api/v1/auth/me');
    expect(second.status).toBe(200);
    expect(second.body.user).toMatchObject({ id: sub, email });

    // No duplicate row, and an unchanged user is never rewritten (updatedAt is
    // bumped only by an update).
    expect(await prisma.user.count({ where: { id: sub } })).toBe(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: sub } });
    expect(after.updatedAt.getTime()).toBe(stored.updatedAt.getTime());
    expect(after.email).toBe(email);
  });

  it('refreshes the stored email when the token claim changes', async () => {
    const { client } = createTestContext();
    const sub = randomUUID();
    remember(sub);
    const original = uniqueEmail('before');
    const updated = uniqueEmail('after');

    client.setToken(await signTestToken({ sub, email: original }));
    expect((await client.get('/api/v1/auth/me')).status).toBe(200);

    client.setToken(await signTestToken({ sub, email: updated }));
    const response = await client.get('/api/v1/auth/me');

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(updated);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: sub } });
    expect(stored.email).toBe(updated);
  });

  it('provisions once when several first requests arrive at the same time', async () => {
    const { client } = createTestContext();
    const sub = randomUUID();
    const email = uniqueEmail('race');
    remember(sub);
    client.setToken(await signTestToken({ sub, email }));

    // A freshly signed-in SPA fires its queries together; only one insert can
    // win, and the losers must not be told their token is invalid.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => client.get('/api/v1/auth/me')),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await prisma.user.count({ where: { id: sub } })).toBe(1);
  });
});

describe('bearer-token scope', () => {
  it('401s existing routes without a token', async () => {
    const anonymous = createTestContext().client;

    expect((await anonymous.get('/api/v1/monitors')).status).toBe(401);
    expect((await anonymous.post('/api/v1/monitors', {})).status).toBe(401);
    expect((await anonymous.get('/api/v1/dashboard/summary')).status).toBe(401);
    expect((await anonymous.get('/api/v1/incidents')).status).toBe(401);
  });

  it('ignores an Authorization header without the Bearer scheme', async () => {
    const { app } = createTestContext();
    const supertest = (await import('supertest')).default;

    const response = await supertest(app)
      .get('/api/v1/monitors')
      .set('authorization', 'not-a-bearer-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('removed credential routes', () => {
  it.each(['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/auth/logout'])(
    'answers 404 for %s',
    async (path) => {
      const { client } = createTestContext();
      const response = await client.post(path, { email: uniqueEmail(), password: 'whatever' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    },
  );
});

describe('error envelope', () => {
  it('answers an unknown route with 404, a stable code and a request id', async () => {
    const response = await createTestContext().client.get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(typeof response.body.error.message).toBe('string');
    expect(typeof response.body.error.requestId).toBe('string');
  });

  it('rejects malformed JSON with 400 rather than 500', async () => {
    const { app } = createTestContext();
    const supertest = (await import('supertest')).default;

    const response = await supertest(app)
      .post('/api/v1/monitors')
      .set('content-type', 'application/json')
      .send('{"name":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('honours a well-formed inbound request id and ignores junk', async () => {
    const { app } = createTestContext();
    const supertest = (await import('supertest')).default;

    const knownId = '11111111-2222-3333-4444-555555555555';
    const honoured = await supertest(app)
      .get('/api/v1/does-not-exist')
      .set('x-request-id', knownId);
    expect(honoured.body.error.requestId).toBe(knownId);
    expect(honoured.headers['x-request-id']).toBe(knownId);

    const junk = await supertest(app)
      .get('/api/v1/does-not-exist')
      .set('x-request-id', '"><script>');
    expect(junk.body.error.requestId).not.toBe('"><script>');
    expect(junk.body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
