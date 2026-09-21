FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @valostudy/worker build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Workspace TypeScript exports are resolved by tsx. The Web process is not included in the command.
COPY --from=build --chown=node:node /app ./
USER node
CMD ["./node_modules/.bin/tsx", "apps/worker/dist/index.js"]
