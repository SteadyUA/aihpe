#!/bin/bash

# Stop script on error
set -e

echo "🚀 Starting deployment..."

# 1. Pull latest code changes
echo "📥 Pulling updates (git pull)..."
git pull origin main

# 2. Build new image
echo "� Building new image..."
docker-compose build

# 3. Stop running containers to release SQLite lock
echo "🛑 Stopping containers to safely run SQLite migrations..."
docker-compose down

# 4. Running migrations
echo "🗄️  Running database migrations..."
# Run migration in a temporary container. 
# We use 'run --rm' which starts a new container, but shares the volume if configured in docker-compose.
# Since the main app is stopped, this migration process has exclusive access to the DB file.
docker-compose run --rm app node node_modules/typeorm/cli.js migration:run -d dist/data-source.js

# 5. Start application
echo "🚀 Starting application..."
docker-compose up -d

echo "✅ Deployment completed successfully!"
