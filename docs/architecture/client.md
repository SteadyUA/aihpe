# Client Architecture

**Location:** `/client`

The client is a React 19 application built with Vite, designed to provide a seamless, real-time interface for AI-assisted coding.

## Core Responsibilities
- **Chat Interface:** Provides the UI for user-AI interaction, rendering code blocks, markdown, and agent reasoning.
- **Live Preview:** Uses an `iframe` to render the generated web application securely.
- **Real-time Synchronization:** Listens to Server-Sent Events (SSE) from the backend to stream LLM responses and track code generation progress in real-time.
- **Session Management:** Handles navigating between projects, branching sessions, and viewing historical versions via preview screenshots.

## Tech Stack
- **Framework:** React 19
- **Bundler:** Vite
- **Routing:** React Router v7
- **Styling:** CSS Modules with local scoping, global CSS variables for theming.
- **Icons:** Custom SVG React components (`client/src/icons`).

## Key Components
- **`App.tsx`**: The main entry point, mostly using Class Components.
- **`SessionBar.tsx`**: Manages the chat history and timeline for a specific session.
- **Connection Context**: Manages the global SSE connection (`/api/sse`) to receive real-time updates without polling.
