# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code and config
COPY tsconfig.json nest-cli.json ./
COPY src ./src

# Build application
RUN npm run build

# Prune dev dependencies to retain only production dependencies
RUN npm prune --production

# Stage 2: Production Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy package manifest
COPY package.json ./

# Copy production node_modules and compiled output from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Use non-root node user for security
USER node

EXPOSE 3000

# Docker healthcheck targeting process liveness
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1

ENTRYPOINT ["node", "dist/main.js"]
