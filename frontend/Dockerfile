# Build from the repository root: docker compose builds with context "." so the
# workspace packages are available.
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/schemas/package.json packages/schemas/
COPY packages/tokens/package.json packages/tokens/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.base.json ./
COPY packages ./packages
COPY frontend ./frontend

ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build:packages && npm run build --workspace frontend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/frontend ./frontend

EXPOSE 3000
CMD ["npx", "vite", "preview", "--config", "frontend/vite.config.ts", "--port", "3000", "--host"]
