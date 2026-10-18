# PulseCheck - production container build for the web app.
#
# Build from the repository root:
#   docker build -f packages/web/Dockerfile -t pulsecheck-web .
#
# The built assets are served by nginx, which also proxies /api and /health to
# the API service so the browser sees a single origin (cookies stay same-site).
#
# NOTE: this Dockerfile was written but NOT executed: no Docker daemon was
# available in the development environment used to build this project.

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY packages/web packages/web

RUN npm run build -w @pulsecheck/shared && npm run build -w @pulsecheck/web

# ---------------------------------------------------------------------------
# Serve stage
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1/ || exit 1
