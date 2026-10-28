# The API and the worker, from one build.
#
# They share every dependency and the whole of packages/, so building them
# separately would compile the same workspace twice and ship two copies of
# node_modules. One image, two entry points, chosen by the compose service.
#
#   docker build -f infra/Dockerfile --target api    -t nima-api .
#   docker build -f infra/Dockerfile --target worker -t nima-worker .

# ---------------------------------------------------------------- base ---
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Prisma's engines and sharp both need these at runtime, not just to build.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ------------------------------------------------------------ deps ---
# Only the manifests, so a code change does not reinstall the world.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/app/package.json apps/app/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
# The app is Expo and is not part of the server build, but pnpm needs its
# manifest to resolve the workspace.
RUN pnpm install --frozen-lockfile --filter "@nima/api..." --filter "@nima/worker..."

# ----------------------------------------------------------- build ---
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/worker/ apps/worker/
RUN pnpm --filter @nima/db generate \
  && pnpm --filter @nima/config build \
  && pnpm --filter @nima/contracts build \
  && pnpm --filter @nima/db build \
  && pnpm --filter @nima/jobs build \
  && pnpm --filter @nima/api build \
  && pnpm --filter @nima/worker build

# ------------------------------------------------------------- web ---
# The Expo web app, exported to static files. The API serves them, so the
# web app and the API share one address and the sign in cookie stays first
# party. Its own install, because the app pulls in React Native and the
# server images should not carry that.
FROM base AS web
ENV CI=1 EXPO_NO_TELEMETRY=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/app/package.json apps/app/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/jobs/package.json packages/jobs/
RUN pnpm install --frozen-lockfile --filter "@nima/app..."
COPY tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY apps/app/ apps/app/
RUN pnpm --filter @nima/contracts build   && cd apps/app   && pnpm exec expo export --platform web --output-dir dist

# ------------------------------------------------------------- api ---
FROM build AS api
ENV NODE_ENV=production
COPY --from=web /app/apps/app/dist /app/web
ENV WEB_DIR=/app/web
WORKDIR /app/apps/api
EXPOSE 3333
HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3333/health || exit 1
CMD ["node", "dist/server.js"]

# ---------------------------------------------------------- worker ---
FROM build AS worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]

# -------------------------------------------------------- migrate ---
# Runs once on deploy, then exits. Kept separate so the API never carries
# the ability to change the schema of the database it is reading.
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /app/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
