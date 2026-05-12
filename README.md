# Code App Monorepo

This repository is a monorepo containing the source code for the **Code App**, an AI-powered coding workspace that allows users to generate and preview web applications via a chat interface.

It consists of two main workspaces:
- **Client**: A React application built with Vite (`/client`).
- **Server**: A Node.js/Express server with TypeScript (`/server`).

## Prerequisites

- **Node.js**: v18 or higher
- **npm**: v9 or higher
- **OpenAI API Key**: Required for the server to communicate with the LLM.

## Installation & Setup

1.  **Install Dependencies**
    Run the following command in the root directory to install dependencies for both client and server:
    ```bash
    npm install
    ```

2.  **Server Configuration**
    Go to the server directory and set up your environment variables:
    ```bash
    cd server
    cp .env .env.local
    ```
    Edit `.env.local` (or `.env`) and add your credentials:
    ```env
    OPENAI_API_KEY=sk-...
    PORT=3000
    # Optional:
    MODEL=gpt-4o
    DATA_DIR=data
    ```

## Development

To run the application in development mode (starts both client and server concurrently):

```bash
npm run dev
```

- **Frontend**: http://localhost:5173 (usually)
- **Backend**: http://localhost:3000

You can also run them individually:
- **Server only**: `npm run server`
- **Client only**: `npm run client`

## Production Build

To build and serve the production version:

1.  **Build** (builds both client and server, and copies client assets to server):
    ```bash
    npm run build
    ```

2.  **Start**:
    ```bash
    npm start
    ```
    The server will host the frontend at `http://localhost:3000/`.

## Docker Support

The application supports both development and production-like execution using Docker.

### 1. Development (Dev Container)
For **writing code**, use the provided Dev Container configuration.
1.  Open the project in **VS Code**.
2.  Click "Reopen in Container" when prompted.
3.  The environment is pre-configured with Node.js 20 and all dependencies.

### 2. Production / Preview (Docker Compose)
For **running the app** in a production-like environment with the `litellm` service:
1.  Run: `docker compose up --build`
2.  Access the app at: `http://localhost:5000`
3.  Litellm service is available at: `http://localhost:4000`

**Configuration:**
- Edit `litellm/config.yaml` to configure your LLM models.
- Server data is persisted in `server/data` (mounted from host).

## Documentation

For a detailed user guide, architectural overview, and API reference, please see the [Documentation](./docs/README.md).
