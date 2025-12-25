# Server Agent Guide
1. Dev entrypoint: `npm run dev --prefix server` (ts-node-dev).
2. Production build: `npm run build --prefix server`; start via `npm run start --prefix server`.
3. Tests are not configured; once they exist run single specs with `npm run test -- path/to/file.test.ts`.
4. Load config from `.env` or process env; never hardcode secrets.
5. Express + routing-controllers + typedi: register controllers/services via decorators and dependency injection.
6. Every endpoint lives under `/api` and returns JSON DTOs.
7. Controllers should only validate, authorize, and call services; keep business logic in `/services`.
8. Validate payloads with class-validator DTOs; convert types via class-transformer.
9. Session/file mutations belong in `SessionStore` or dedicated services to keep controllers stateless.
10. Formatting: 4 spaces indentation, single quotes, avoid dangling commas unless TS/JSON requires them.
11. Imports order: Node builtins, npm packages, blank line, absolute `src/...` modules.
12. Use async/await with `try/catch`; respond with precise HTTP status codes and error payloads.
13. Throw routing-controllers `HttpError` or return `response.status(...).json(...)`; never leak stack traces to clients.
14. Streaming (`/api/sse`) must keep connections open, remove listeners on close, and guard against double writes.
15. Log actionable context with `console.error`; avoid noisy per-request info logs.
16. Share DTOs/types under `src/types`; do not duplicate literals in multiple files.
17. Keep services pure/testable; they can depend on AI SDK clients or stores but not Express response objects.
18. Update this document whenever scripts, env expectations, or structure changes.
