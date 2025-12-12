# HTML Preview Chat Server

A Node.js + TypeScript HTTP server that turns chat instructions into a simple web page. The backend uses `Express`, `routing-controllers`, and OpenAI's `gpt-5.1-codex` (or another model you configure). A bundled frontend provides a chat interface with live HTML/CSS/JS preview.

## Prerequisites

- Node.js 18+
- npm 9+
- An OpenAI API key with access to the desired model

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment variables**
   - Copy `.env` and set the values:
     ```bash
     cp .env .env.local
     ```
   - Edit `.env.local` (or `.env`) with your credentials:
     ```env
      MODEL=gpt-5.1-codex        # Any Responses API-compatible model
      OPENAI_API_KEY=sk-...      # Required for live generation
      PORT=3000                  # Optional, defaults to 3000
      SESSION_ROOT=data/sessions # Optional, overrides session storage root
      ```

    - The app loads environment variables via [`dotenv`](https://www.npmjs.com/package/dotenv) at startup.
 3. **Run in development mode**
    ```bash

   npm run dev
   ```
4. **Build and run production bundle**
   ```bash
   npm run build
   npm start
   ```

The server hosts the frontend at `http://localhost:3000/` (or your chosen port). Use the chat panel to describe changes; each reply updates the preview iframe and shows the generated asset contents.

## API

### `POST /api/chat`
Send chat instructions for a specific session.

```json
{
  "sessionId": "string",
  "message": "Describe what to create or change"
}
```

Response:

```json
{
  "message": "Summary of what changed"
}
```

### `GET /api/sessions/:sessionId`
Returns the full session snapshot (history + assets). Response:

```json
{
  "id": "session-123",
  "updatedAt": "2025-12-05T13:37:00.000Z",
  "history": [
    { "role": "user", "content": "...", "createdAt": "..." },
    { "role": "assistant", "content": "...", "createdAt": "..." }
  ],
  "files": {
    "html": "<!DOCTYPE html>...",
    "css": "body { ... }",
    "js": "console.log('...');"
  }
}
```

### `GET /api/sessions/:sessionId/files`
Fetch only the latest generated assets for the session. Returns:

```json
{
  "html": "<!DOCTYPE html>...",
  "css": "body { ... }",
  "js": "console.log('...');"
}
```

Sessions and files are stored in-memory. Restarting the server clears all state.

## Frontend Preview

The static frontend (served from `public/`) implements:
- Chat UI with persistent session tracking via `localStorage`
- Calls to the REST API for chat interactions and file snapshots
- Live iframe preview that injects returned HTML, CSS, and JavaScript
- Mobile preview toggle that constrains the iframe to a 375px viewport
- Element picker with selector copy to target precise edits

You can customize the UI by editing files in `public/`.

## Development Notes

- Type checking: `npm run build`
- Session data persists to `data/sessions/<sessionId>/` by default; override with `SESSION_ROOT`.
- Linting is not configured; integrate your preferred tool if needed.
- Ensure your OpenAI usage complies with all relevant policies.
