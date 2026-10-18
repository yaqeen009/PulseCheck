# PulseCheck - production container build for the API and the monitoring worker.
#
# Build from the repository root:
#   docker build -f packages/server/Dockerfile -t pulsecheck-api .
#
# The image contains the compiled server plus the Prisma CLI, so the same image
# can run migrations (`docker compose run --rm api migrate`).
#
# NOTE: this Dockerfile was written but NOT executed: no Docker daemon was
# available in the development environment used to build this project.

# ---------------------------------------------------------------------------
# Build stage: install workspaces, generate the Prisma client, compile TypeScript
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Only the manifests first, so dependency installation is cached.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json

# Install every workspace dependency (dev dependencies included: tsc, prisma).
RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY packages/server packages/server

RUN npm run build -w @pulsecheck/shared \
  && npm run db:generate -w @pulsecheck/server \
  && npm run build -w @pulsecheck/server

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/server/prisma packages/server/prisma
COPY --from=build /app/packages/server/prisma.config.ts packages/server/prisma.config.ts
COPY --from=build /app/packages/server/scripts packages/server/scripts
COPY packages/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app

USER node

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/index.js"]
