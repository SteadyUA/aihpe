# SSE Streaming Architecture

Server-Sent Events (SSE) are crucial for delivering real-time feedback from the LLM to the client without the overhead of WebSockets.

## The Connection Flow

1. **Client Connection:**
   The React client connects to `GET /api/sse` (usually handled in a global `ConnectionContext`).
   - The server authorizes the request and keeps the TCP connection open.
   - The server assigns a client ID or uses the user's session token to route events.

2. **Triggering Generation:**
   The client sends a standard HTTP POST request to `POST /api/sessions/:sessionId/chat`.
   - The server acknowledges the request (`200 OK` or `202 Accepted`) immediately.
   - The actual LLM generation is kicked off in the background.

3. **Streaming Data:**
   As the LLM generates tokens, the `ChatService` emits internal events via the `EventBus`.
   - The SSE handler listens to these internal events (e.g., `ChunkGeneratedEvent`, `ToolCallEvent`).
   - The server formats these into standard SSE text payloads and pushes them down the open `/api/sse` connection.

## Event Payloads
Data sent over SSE typically includes:
- `event: message` - A standard text chunk from the LLM.
- `event: status` - Status updates (e.g., "Planning...", "Writing code...").
- `event: error` - If the generation fails mid-stream.
- `event: end` - Signals the generation for this turn is complete.

## Why SSE over WebSockets?
- **Unidirectional:** The server only needs to push data to the client during generation. The client sends prompts via standard REST.
- **Simplicity:** Built-in browser reconnection logic via `EventSource`.
- **Firewall friendly:** Operates over standard HTTP/HTTPS ports.
