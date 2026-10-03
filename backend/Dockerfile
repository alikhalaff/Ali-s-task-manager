FROM node:26-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN DATABASE_URL=mysql://build:build@localhost:3306/build npm run build

FROM build AS test
CMD ["sh", "-c", "npm run db:deploy && npm test"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
ENV NODE_ENV=production
ENV PATH="/nodejs/bin:${PATH}"
WORKDIR /app
COPY --from=production-dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/package.json ./package.json
USER 65532:65532
EXPOSE 3000
CMD ["dist/server.js"]
