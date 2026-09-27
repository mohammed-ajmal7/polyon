FROM node:24-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm --filter web build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV POLYON_DATA_DIR=/data
ENV POLYON_RUNTIME_AUTOSTART=true
ENV POLYON_EXECUTION_ENABLED=false
ENV POLYON_APPROVAL_MODE=ASK_EVERYTHING

RUN addgroup --system --gid 1001 polyon && adduser --system --uid 1001 polyon
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p /data && chown -R polyon:polyon /data
USER polyon
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
