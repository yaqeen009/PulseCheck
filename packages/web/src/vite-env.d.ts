/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Neon Auth branch, e.g. `https://<host>/<db>/auth`. */
  readonly VITE_NEON_AUTH_URL?: string;
  /**
   * Absolute base URL of the deployed API, e.g.
   * `https://pulsecheck-api.onrender.com`. Set this in Vercel; leave it empty
   * in development so the Vite dev-server proxy keeps requests same-origin.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
