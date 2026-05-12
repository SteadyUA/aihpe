# API Endpoints & Contracts

**Base URL:** `/api` (or relative to the configured API base in the client).

## 1. Real-time Connection
- **`GET /api/sse`**
  Establishes the Server-Sent Events connection. Requires authentication (e.g., via cookies or headers).

## 2. Projects
- **`POST /projects`**
  Creates a new project. Accepts an optional ZIP file (`archive`) for importing existing code.
- **`GET /projects/:projectId`**
  Returns project metadata and an array of associated sessions.
- **`PATCH /projects/:projectId`**
  Updates project settings (name, default provider).

## 3. Sessions
- **`POST /sessions`**
  Creates a new session inside a project.
  *Payload:* `{ projectId: string, provider?: string, fastMode?: boolean }`
- **`GET /sessions/:sessionId`**
  Returns the complete session state, including chat history (`turns`), current file tree, and memory context.
- **`DELETE /sessions/:sessionId`**
  Soft or hard deletes a session.

## 4. Chat & Generation
- **`POST /sessions/:sessionId/chat`**
  Sends a user message and triggers the LLM.
  *Payload:* `{ message: string, quote?: string, attachments?: string[] }`
- **`POST /sessions/:sessionId/clone/:turn`**
  Branches the session from a specific turn, creating a parallel timeline.

## 5. File & Asset Access
- **`GET /sessions/:sessionId/:version/files/:filename`**
  Fetches the raw content of a generated HTML/CSS/JS file for a specific version.
- **`POST /sessions/:sessionId/uploads`**
  Uploads a binary asset (image/video/font) to the session.
- **`GET /sessions/:sessionId/uploads/:filename`**
  Serves an uploaded asset.
