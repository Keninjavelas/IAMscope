# Build from the repository root: docker compose builds with context "." so the
# workspace packages are available to the backend build.
FROM node:20-bookworm-slim AS build
WORKDIR /app

# argon2 needs a toolchain only if no prebuilt binary matches; keep the image lean
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/schemas/package.json packages/schemas/
COPY packages/tokens/package.json packages/tokens/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --include=dev --ignore-scripts --workspace backend --workspace @iamscope/types --workspace @iamscope/schemas --workspace @iamscope/tokens --include-workspace-root
RUN npm rebuild argon2

COPY tsconfig.base.json ./
COPY packages ./packages
COPY backend ./backend

RUN npm run build:packages && npm run build --workspace backend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
# The root package.json MUST be present. `backend/dist/env.js` resolves APP_VERSION
# through `require("../../package.json")`, which from /app/backend/dist/ lands on
# /app/package.json. Dropping this line does not break the build - it produces an image
# that fails at boot with "Cannot find module '../../package.json'". See DECISIONS D15.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

EXPOSE 4000
CMD ["node", "backend/dist/index.js"]
