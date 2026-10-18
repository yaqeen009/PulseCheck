import type { Express } from 'express';
import supertest from 'supertest';

/** Per-request options. `token` overrides the client's stored token. */
export interface RequestOptions {
  body?: unknown;
  /**
   * `undefined` uses the stored token; `null` sends no Authorization header;
   * a string sends exactly that token.
   */
  token?: string | null;
}

/**
 * A supertest client that carries a single bearer token.
 *
 * Authentication is header-based, so there is nothing to persist between
 * requests beyond the token: `setToken` after signing in, `clearToken` to act
 * anonymously. `raw` accepts a per-request `token` override (including `null` to
 * prove a route rejects an unauthenticated caller), but the stored token wins
 * only when the option is omitted.
 */
export class TestClient {
  private token: string | null = null;

  constructor(private readonly app: Express) {}

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  get(path: string, options: RequestOptions = {}): Promise<supertest.Response> {
    return this.raw('get', path, options);
  }

  post(path: string, body?: unknown, options: RequestOptions = {}): Promise<supertest.Response> {
    return this.raw('post', path, { ...options, body });
  }

  patch(path: string, body?: unknown, options: RequestOptions = {}): Promise<supertest.Response> {
    return this.raw('patch', path, { ...options, body });
  }

  put(path: string, body?: unknown, options: RequestOptions = {}): Promise<supertest.Response> {
    return this.raw('put', path, { ...options, body });
  }

  delete(path: string, body?: unknown, options: RequestOptions = {}): Promise<supertest.Response> {
    return this.raw('delete', path, { ...options, body });
  }

  async raw(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    options: RequestOptions = {},
  ): Promise<supertest.Response> {
    let test: supertest.Test;
    switch (method) {
      case 'get':
        test = supertest(this.app).get(path);
        break;
      case 'post':
        test = supertest(this.app).post(path);
        break;
      case 'patch':
        test = supertest(this.app).patch(path);
        break;
      case 'put':
        test = supertest(this.app).put(path);
        break;
      case 'delete':
        test = supertest(this.app).delete(path);
        break;
    }

    // An explicit `token` (including `null`) overrides the stored token.
    const token = Object.hasOwn(options, 'token') ? options.token : this.token;
    if (token) test = test.set('authorization', `Bearer ${token}`);

    if (options.body !== undefined) test = test.send(options.body as object);

    return test;
  }
}
