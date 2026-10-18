import type { MeResponseDto, UserDto } from '@pulsecheck/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, awaitAuthToken } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';
import { queryKeys } from './query-keys';

/**
 * Current session.
 *
 * `retry: false` and a 401-tolerant query function: an unauthenticated visitor is
 * a normal state (the login screen), not an error to retry. The 401 handler of
 * the API client is bypassed here because this query *is* the session check.
 */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<UserDto | null> => {
      try {
        const response = await api.get<MeResponseDto>('/auth/me', {
          skipUnauthorizedHandler: true,
        });
        return response.user;
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthenticated) return null;
        throw error;
      }
    },
  });
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Neon Auth errors are plain objects (or strings), not `ApiError`. Turn one into
 * a message the forms can display without leaking a stack trace.
 */
function authErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'Authentication failed. Please try again.';
}

/**
 * Neon Auth answers "Invalid email or password" for a bad sign-in. The login
 * screen has always shown "Email or password is incorrect", so keep that text.
 */
function loginErrorMessage(error: unknown): string {
  const message = authErrorMessage(error);
  if (message.toLowerCase().includes('invalid email or password')) {
    return 'Email or password is incorrect';
  }
  return message;
}

/** The registration form has no name field; derive one from the email local part. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.length > 0 ? local : email;
}

/** Project a Neon Auth user onto the API's `UserDto` shape. */
function toUserDto(user: { id: string; email: string; createdAt?: unknown }): UserDto {
  const createdAt =
    user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt ?? '');
  return { id: user.id, email: user.email, createdAt };
}

/** Seed the cache with the user we just authenticated as, then refresh the rest. */
async function seedSession(queryClient: QueryClient, user: UserDto): Promise<void> {
  // Neon Auth exposes the session a tick after sign-in/sign-up. Waiting for a
  // token keeps the first authenticated queries from racing the session and
  // bouncing the user back to the login screen.
  await awaitAuthToken();
  queryClient.setQueryData(queryKeys.me, user);
  await queryClient.invalidateQueries();
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials): Promise<UserDto> => {
      const result = await authClient.signIn.email({
        email: credentials.email,
        password: credentials.password,
      });
      if (result.error) throw new Error(loginErrorMessage(result.error));
      return toUserDto(result.data.user);
    },
    onSuccess: async (user) => {
      await seedSession(queryClient, user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: Credentials): Promise<UserDto> => {
      const result = await authClient.signUp.email({
        email: credentials.email,
        password: credentials.password,
        name: nameFromEmail(credentials.email),
      });
      if (result.error) throw new Error(authErrorMessage(result.error));
      return toUserDto(result.data.user);
    },
    onSuccess: async (user) => {
      await seedSession(queryClient, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(authErrorMessage(result.error));
    },
    onSettled: () => {
      // Drop every cached resource, including the user.
      queryClient.clear();
    },
  });
}
