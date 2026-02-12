# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++

ARG APP_BASE_PATH
ENV APP_BASE_PATH=$APP_BASE_PATH

# Copy root package files
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
RUN npm install -g npm@latest
RUN npm ci

# Copy source code
COPY . .

# Build client
WORKDIR /app/client
RUN npm run build

# Build server
WORKDIR /app/server
RUN npm run build

# Copy client build to server public directory
RUN mkdir -p dist/public && cp -r ../client/dist/* dist/public/

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
# We only copy the server package files to treat it as a standalone app, avoiding workspace devDependencies
COPY server/package*.json ./

# Install only production dependencies for server
RUN npm install -g npm@latest
# We use npm install instead of ci because the lockfile was generated in a monorepo
# and we are now installing as a standalone app, so the lockfile needs to be updated.
RUN npm install --omit=dev && npm prune --production && npm cache clean --force

# Copy built artifacts from builder
COPY --from=builder /app/server/dist ./dist
# We need to copy the static files again if they are inside dist, or ensure dist/public is correct
COPY --from=builder /app/server/dist/public ./dist/public

# Expose port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Start server
CMD ["node", "dist/server.js"]
