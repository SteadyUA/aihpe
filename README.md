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

## Architecture & API Reference

### Overview
- **Client**: Handles the chat UI, code preview (via iframe), and session management.
- **Server**: Manages projects, sessions, interacts with the LLM, and persists data to the file system.

### Key API Endpoints

The server exposes a REST API and an SSE endpoint for real-time updates.

#### Structure
- **SSE Stream**: `GET /api/sse` - Connect for real-time updates on session status and generation progress.

#### Projects
- `POST /api/projects`: Create a new project.
- `GET /api/projects/:projectId`: Get project details and list of sessions.
- `PATCH /api/projects/:projectId`: Update project settings.

#### Sessions
- `POST /api/sessions`: Create a new chat session.
- `GET /api/sessions/:sessionId`: Get full session history and state.
- `DELETE /api/sessions/:sessionId`: Delete a session.

#### Chat & Interaction
- `POST /api/sessions/:sessionId/chat`: Send a user message (triggers LLM generation).
- `POST /api/sessions/:sessionId/unsent`: Save current draft input/selection (auto-save).
- `POST /api/sessions/:sessionId/undo`: Revert the last turn.
- `POST /api/sessions/:sessionId/clone/:turn`: Branch a session from a specific turn.

#### Assets & Files
- `POST /api/sessions/:sessionId/uploads`: Upload an image/file.
- `DELETE /api/sessions/:sessionId/uploads/:filename`: Delete an uploaded file.
- `GET /api/sessions/:sessionId/uploads/:filename`: Serve an uploaded file.
- `GET /api/sessions/:sessionId/:version/files/:filename`: Get content of a specific generated file (html/css/js) for a version.
- `GET /api/sessions/:sessionId/:version/archive`: Download a ZIP archive of the generated code.
- `GET /api/sessions/:sessionId/artifacts/:turn/:filename`: Get intermediate artifacts (e.g. plans) for a turn.

## Features
- **Live Preview**: See changes in real-time as the AI writes code.
- **Session Management**: Organized by Projects with support for multiple sessions.
- **Branching**: Clone functionality to explore different iterations.
- **Persistence**: File-system based storage for sessions and generated code.
