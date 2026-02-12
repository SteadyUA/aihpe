# Deployment Guide (Production)

This guide will help you deploy the application to a production server (DigitalOcean), update code, and run database migrations.

## Prerequisites
- Server with Docker and Docker Compose installed.
- Git installed.
- SSH access to the server.

## 1. Initial Setup

1. **Clone the repository:**
   SSH into your server and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USER/YOUR_REPO.git app
   cd app
   ```

2. **Configure environment:**
   Copy the example configuration file and fill in your details:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Ensure variables (especially `DATA_DIR`) are configured correctly.

3. **Start application:**
   ```bash
   docker-compose up -d --build
   ```
   This command builds the Docker image and starts containers in detached mode.

## 2. Code Update (Deploy)

To update the application to the latest version from the repository:

1. **Pull fresh code:**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart containers:**
   ```bash
   docker-compose up -d --build
   ```
   The `--build` flag ensures the image is rebuilt with new code. Docker Compose recreates only changed containers.

3. **Run migrations (if any):**
   See "Database Migrations" section below.

### Quick Deploy Script (deploy.sh)
You can use the `deploy.sh` script in the project root for automation. It implements a safe strategy for SQLite:
1. Builds the new image.
2. Stops the running application (to release the database lock).
3. Runs migrations in a temporary container.
4. Starts the application.

```bash
#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# 1. Pull latest code changes
echo "📥 Pulling updates..."
git pull origin main

# 2. Build new image
echo "🔨 Building new image..."
docker compose build

# 3. Stop running containers to release SQLite lock
echo "🛑 Stopping containers..."
docker compose down

# 4. Run migrations
echo "🗄️  Running database migrations..."
docker compose run --rm app node node_modules/typeorm/cli.js migration:run -d dist/data-source.js

# 5. Start application
echo "🚀 Starting application..."
docker compose up -d

echo "✅ Deployment completed successfully!"
```
Make it executable: `chmod +x deploy.sh`. Run it: `./deploy.sh`.

## 3. Database Migrations

**Important Note for SQLite:**
SQLite locks the database file during write operations. Running migrations while the application is active and writing to the database can lead to `SQLITE_BUSY` errors. Therefore, it is recommended to **stop the application** before running migrations.

**Safe command to run pending migrations (when app is stopped):**
```bash
docker compose run --rm app node node_modules/typeorm/cli.js migration:run -d dist/data-source.js
```

**Revert last migration:**
```bash
docker compose exec app node node_modules/typeorm/cli.js migration:revert -d dist/data-source.js
```

### Creating New Migrations (Local Dev Environment)
Migrations should be created in your local development environment, not on the server.

1. Modify Entities.
2. Generate migration (ensure DB is running locally):
   ```bash
   npm run migration:generate --name=NameOfMigration
   ```
   *(Replace `NameOfMigration` with a descriptive name)*
3. Check created file in `server/src/migrations`.
4. Commit changes and push to repository (`git push`).

## 4. Logs and Monitoring

**View logs:**
```bash
docker compose logs -f --tail=100
```

**Check container status:**
```bash
docker compose ps
```

**Stop application:**
```bash
docker compose down
```
