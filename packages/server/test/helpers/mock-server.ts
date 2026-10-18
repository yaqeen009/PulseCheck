import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export type MockHandler = (
  request: MockRequest,
  response: import('node:http').ServerResponse,
) => void | Promise<void>;

export interface MockServer {
  /** Base URL, e.g. `http://127.0.0.1:53123`. */
  url: string;
  port: number;
  requests: MockRequest[];
  close(): Promise<void>;
}

/** Start a throwaway HTTP server on an ephemeral loopback port. */
export async function startMockServer(handler: MockHandler): Promise<MockServer> {
  const requests: MockRequest[] = [];

  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const request: MockRequest = {
        method: incoming.method ?? 'GET',
        url: incoming.url ?? '/',
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);
      void Promise.resolve(handler(request, response)).catch(() => {
        if (!response.headersSent) response.statusCode = 500;
        response.end('handler failed');
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export interface StaticResponseOptions {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Milliseconds to wait before responding, used by timeout tests. */
  delayMs?: number;
}

/** Start a server that always answers the same way. */
export function startStaticServer(options: StaticResponseOptions = {}): Promise<MockServer> {
  return startMockServer((_request, response) => {
    const send = (): void => {
      response.writeHead(
        options.status ?? 200,
        options.headers ?? { 'content-type': 'text/plain' },
      );
      response.end(options.body ?? 'ok');
    };
    if (options.delayMs && options.delayMs > 0) setTimeout(send, options.delayMs);
    else send();
  });
}

/**
 * Start a server that redirects to `location` until `hopsBeforeSuccess` is
 * reached, after which it answers 200. Used to test redirect following.
 */
export function startRedirectServer(
  location: (request: MockRequest) => string,
  hopsBeforeSuccess = Number.POSITIVE_INFINITY,
): Promise<MockServer> {
  let hops = 0;
  return startMockServer((_request, response) => {
    hops += 1;
    if (hops > hopsBeforeSuccess) {
      response.writeHead(200);
      response.end('ok');
      return;
    }
    response.writeHead(302, { location: location(_request) });
    response.end();
  });
}
