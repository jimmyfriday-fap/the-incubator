# Multi-stage build: dependencies and build in one stage, a slim runtime as a non-root user.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY db ./db
COPY scripts/db ./scripts/db
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.status === 200 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/main.js"]
