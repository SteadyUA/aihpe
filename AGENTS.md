# Project Overview

This project is a **Monorepo** containing a React frontend and an Express backend, designed to test SSE (Server-Sent Events) sessions and chat functionality.

## Structure

- **/client**: Frontend application.
  - **Framework**: React + Vite
  - **Language**: TypeScript
  - **Components**: Class Components (refactored from functional)
  - **Port**: 5173 (proxies /api to 5000)
- **/server**: Backend application.
  - **Framework**: Express.js
  - **Language**: TypeScript
  - **Port**: 5000
  - **Features**: SSE, Chat API, Session Management
- **package.json**: Root configuration to manage both workspaces.

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```
   This installs dependencies for root, client, and server.

2. **Run Development Mode**:
   ```bash
   npm run dev
   ```
   This command uses `concurrently` to start both the backend server and the frontend client.

## Key Features
- **Monorepo**: Unified management of client and server.
- **Server-Sent Events (SSE)**: Real-time chat updates.
- **Preview**: Render HTML/CSS/JS snippets in an iframe.
- **TypeScript**: Full type safety across the frontend.
- **Class Components**: Frontend uses React Class Components for state management.