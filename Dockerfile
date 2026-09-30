FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/collector/package.json ./apps/collector/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/analytics-engine/package.json ./packages/analytics-engine/package.json
COPY packages/sdk-browser/package.json ./packages/sdk-browser/package.json
COPY packages/sdk-node/package.json ./packages/sdk-node/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 DATABASE_PROVIDER=azure DEMO_MODE=false
RUN groupadd --gid 1001 houseedge && useradd --uid 1001 --gid 1001 --no-create-home houseedge
COPY --from=build --chown=houseedge:houseedge /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=houseedge:houseedge /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build --chown=houseedge:houseedge /app/apps/dashboard/public ./apps/dashboard/public
USER houseedge
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/dashboard/server.js"]
