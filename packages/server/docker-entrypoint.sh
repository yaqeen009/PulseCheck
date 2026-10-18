#!/bin/sh
# Entrypoint for the PulseCheck API container.
#
#   docker-entrypoint.sh migrate   -> apply pending migrations and exit
#   docker-entrypoint.sh <cmd...>  -> optionally migrate, then run <cmd>
#
# Migrations run automatically on start only when RUN_MIGRATIONS=true, so a
# multi-replica deployment can migrate once and start replicas without racing.
set -e

if [ "$1" = "migrate" ]; then
  exec npx --workspace @pulsecheck/server prisma migrate deploy
fi

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  npx --workspace @pulsecheck/server prisma migrate deploy
fi

exec "$@"
