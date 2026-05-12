# Server Architecture

**Location:** `/server`

The server is a monolithic Node.js backend built with TypeScript, acting as the orchestrator for LLM interactions, file management, and API services.

## Core Responsibilities
- **API Gateway:** Exposes RESTful endpoints for the client.
- **LLM Orchestration:** Manages system prompts, tool execution (PageGenTools), and communicates with the LiteLLM proxy (or directly with OpenAI).
- **File System Persistence:** Stores session artifacts, generated HTML/CSS/JS files, and user uploads locally.
- **Database:** Uses SQLite (via TypeORM) to track project metadata, session history, file versions, and chat messages.
- **Event Bus:** Uses an internal EventBus to decouple business logic (e.g., publishing `FileUpdated` events which trigger screenshot generation in the background).

## Tech Stack
- **Framework:** Express.js with `routing-controllers`.
- **Language:** TypeScript.
- **Dependency Injection:** `typedi`.
- **Database:** TypeORM with SQLite.

## Architectural Patterns
- **Controller-Service-Repository:**
  - **Controllers** handle HTTP requests/responses and DTO mapping.
  - **Services** contain core business logic (e.g., `ChatService.ts`, `SessionService.ts`).
  - **Repositories/Entities** manage DB access.
- **Event-Driven Handlers:** Code inside `server/src/handlers/` subscribes to system events (like `AppStartedEvent` or session updates) to perform background tasks without blocking the main request loop.
- **Agentic File Tools:** The server provides native tools (like `edit_file`, `copy_clipboard_file`) that the LLM uses to manipulate the user's generated workspace securely.
