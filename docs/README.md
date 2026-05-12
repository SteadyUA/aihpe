# Code App Documentation

Welcome to the Code App documentation. This documentation is designed to be useful for both human developers and AI agents working on the project.

## Directory Structure

- [User Guide](./user_guide.md): A complete tutorial for users on how to use the Code App.
- **Architecture**
  - [Client Architecture](./architecture/client.md): Details about the React frontend.
  - [Server Architecture](./architecture/server.md): Details about the Node.js backend.
  - [Screenshot Service](./architecture/screenshot_service.md): Details about the Puppeteer microservice.
  - [Database Schema](./architecture/database.md): Entities, relationships, and migration rules.
- **Features & Deep Dives**
  - [SSE Streaming](./features/sse_streaming.md): How real-time generation feedback works.
  - [LLM Tools & Capabilities](./features/llm_tools.md): How the AI edits files and manages memory.
- **API & Contracts**
  - [API Endpoints](./api/endpoints.md): REST endpoints and WebSocket/SSE contracts.
- **Deployment**
  - [Deployment & Setup Guide](./deployment.md): Instructions for DevContainers, Docker Compose, and deploy scripts.

## Notes for AI Agents
If you are an AI agent, please read `AGENTS.md` in the root directory for specific coding guidelines and instructions on where to find or save information.
