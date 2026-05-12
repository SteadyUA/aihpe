# Deployment & Setup Guide

This project can be run locally for development or deployed to a production environment.

## 1. Local Development (DevContainer)
We highly recommend using the included `.devcontainer` configuration.
- **Prerequisites:** Docker, VS Code + DevContainers extension.
- **Steps:** 
  1. Open the repo in VS Code.
  2. Click "Reopen in Container".
  3. Run `npm install` and `npm run dev`.
  4. The client runs on `:5173` and the server on `:5000`.

## 2. Production Deployment (Docker Compose)
For staging or production, use the `docker-compose.yml` configuration. This sets up the Node server and a `litellm` proxy sidecar.

**Steps:**
1. Copy `.env.example` to `.env` and fill in your API keys (e.g., `OPENAI_API_KEY`).
2. Configure your models in `litellm/config.yaml`.
3. Run the deployment script (if using a remote server) or manually build:
   ```bash
   docker compose up --build -d
   ```
4. The service will be available on port `5000`. 

**Persistent Data:**
Ensure the `server/data` directory is mounted correctly as a Docker volume so SQLite databases and uploaded files are not lost during container restarts.

## 3. The `deploy.sh` Script
The `deploy.sh` script automates zero-downtime (or minimal downtime) deployments.
- It pulls the latest code.
- Builds the client (`npm run build` in `/client`).
- Compiles the server (`npm run build` in `/server`).
- Restarts the Node.js process or Docker container depending on the environment configuration.
