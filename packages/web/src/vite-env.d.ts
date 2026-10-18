/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Neon Auth branch, e.g. `https://<host>/<db>/auth`. */
  readonly VITE_NEON_AUTH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
