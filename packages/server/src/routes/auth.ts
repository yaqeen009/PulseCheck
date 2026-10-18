import { Router } from 'express';
import type { MeResponseDto } from '@pulsecheck/shared';
import { asyncHandler } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { toPublicUser } from '../services/auth-service.js';

/**
 * Authentication routes.
 *
 * Credentials, registration, login, logout and sessions are owned by Neon Auth
 * (Managed Better Auth); this API only ever sees a bearer token. The local
 * `users` row is provisioned on first authenticated request by the auth
 * middleware. `/me` is therefore the only auth route.
 */
export const authRouter: Router = Router();

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (request, response) => {
    const body: MeResponseDto = { user: toPublicUser(request.auth!.user) };
    response.status(200).json(body);
  }),
);
