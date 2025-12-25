# Agent Guide
1. Root dev: `npm run dev` (spawns client+server via concurrently).
2. Solo dev: `npm run dev --prefix server` or `--prefix client`.
3. Server build/start: `npm run build --prefix server` then `npm run start --prefix server`.
4. Client build/preview: `npm run build --prefix client` and `npm run preview --prefix client`.
5. Lint: `npm run lint --prefix client`; server type-checks during `npm run build --prefix server`.
6. Tests are not configured; once added run single specs via `npm run test -- path/to/file.test.ts`.
7. Default ports: client 5173, server 5000; `/api/*` proxy targets 5000.
8. Server tech: Express + routing-controllers + typedi; keep every endpoint under `/api`.
9. Controllers validate input, call services, and return JSON DTOs; services own business logic.
10. Wrap async work with try/catch (or routing-controllers decorators) and emit precise HTTP status codes.
11. Group imports Node → third-party → blank line → internal (prefer absolute from `src`).
12. TypeScript is strict everywhere; declare return types and avoid `any` without a TODO + justification.
13. React favors function components/hooks; keep class components only when lifecycle control is required.
14. Indent with 2 spaces on the server and 4 spaces on the client; prefer single quotes and minimal trailing commas.
15. Naming: PascalCase components/classes, camelCase vars/functions, UPPER_SNAKE constants.
16. Share DTOs/types instead of duplicating literals; store them under `server/src/types` or the closest module.
17. Stream handlers like `/api/sse` must keep connections open and clean up listeners.
18. Load secrets/config from `.env`; never commit credentials.
19. Update this doc whenever build/test/lint tooling changes.
