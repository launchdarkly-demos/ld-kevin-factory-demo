# Flight Deck for Demo Depot. arm64-safe (node:22-slim is multi-arch), non-root, health on /api/health.
# With GITHUB_REPO and GITHUB_TOKEN set, the entrypoint clones main and runs it so merges reach the
# floor (see docker-entrypoint.sh); the Operate menu needs the same two plus LD_API_KEY.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=7777 \
    FLIGHT_DECK_AUTO_DEPLOY=0 FLIGHT_DECK_NO_CODE_CHECK=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 7777
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:7777/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
