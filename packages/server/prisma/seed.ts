#!/usr/bin/env tsx
/**
 * Development seed.
 *
 * Neon Auth (Managed Better Auth) owns accounts: users sign up through it and
 * receive a JWT whose `sub` is the user id. This API stores no password, so it
 * cannot create an account on its own. The local `users` row is normally
 * provisioned automatically on the first authenticated request.
 *
 * To pre-create that projection row (for example, to attach monitors to an
 * account before its first request), set `SEED_USER_ID` to the Neon Auth user id
 * and `SEED_EMAIL` to its email:
 *
 *   SEED_USER_ID=<neon-auth-user-id> SEED_EMAIL=you@example.com npm run db:seed
 *
 * Without those variables the script is a no-op. Running against production is
 * blocked unless ALLOW_PRODUCTION_SEED=true is set explicitly.
 */
import { disconnectDatabase, prisma } from '../src/db.js';
import { env, isProduction } from '../src/env.js';

async function main(): Promise<void> {
  if (isProduction && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    console.error(
      'Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=true to override.',
    );
    process.exitCode = 1;
    return;
  }

  const userId = process.env.SEED_USER_ID?.trim();
  const email = process.env.SEED_EMAIL?.trim().toLowerCase();

  if (!userId || !email) {
    console.log('Nothing to seed: set SEED_USER_ID and SEED_EMAIL to create a local user row.');
    console.log('Accounts themselves are created by Neon Auth; this API stores no password.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) {
    console.log(`User ${existing.email} already exists (id ${existing.id}). Nothing to do.`);
    return;
  }

  const user = await prisma.user.create({ data: { id: userId, email } });

  console.log(`Created local user projection ${user.email} (id ${user.id}).`);
  console.log(`Environment: ${env.NODE_ENV}`);
  console.log(
    'No monitors or check results were created: create a monitor in the UI to start real checks.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
