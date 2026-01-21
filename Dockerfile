# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
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
COPY package*.json ./
COPY server/package*.json ./server/

# Install only production dependencies for server
WORKDIR /app/server
RUN npm ci --omit=dev

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
