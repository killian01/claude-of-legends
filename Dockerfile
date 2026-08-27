# Claude of Legends: one image, one process, one port. The runtime stage
# carries only the built client (dist/) and the self-contained server bundle
# (dist-server/server.cjs, no node_modules needed at runtime).

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Runtime state (player identities, match log); mount a volume here.
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 8787
USER node
CMD ["node", "dist-server/server.cjs"]
