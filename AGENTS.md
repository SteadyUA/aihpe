# Agent Handbook
## Commands
- Install deps: `npm install`.
- Dev server: `npm run dev` (watches `src/server.ts`).
- Type check/build: `npm run build` (outputs to `dist/`).
- Production start: `npm start` after a build.
- Testing: not configured; single-test workflow unavailable until added.
## Style
- Language: strict TypeScript with decorators; keep `reflect-metadata` import.
- Imports: side-effect first, then Node (`node:*`), externals, relatives.
- Formatting: two-space indent, semicolons, single quotes, trailing commas.
- Types: prefer `interface` for shapes, narrow unions, avoid `any`.
- DI: rely on `typedi` `@Service`/tokens; register via `Container.set`.
- Controllers: use `routing-controllers` decorators and return plain JSON objects.
- Error handling: catch external calls, `console.error`, return fallback payloads.
- Validation: continue using `class-validator`, trim inputs, enforce whitelists.
- State: treat session files as immutable snapshots; clone before update.
- Responses: keep `Date` internally, serialize with `toISOString()`.
- Env/config: manage via `dotenv`; document new vars in `README.md`.
- Session storage: persisted under `SESSION_ROOT` (default `data/sessions`).
- Tooling: lint suite absent—coordinate before adding.
- Cursor/Copilot rules: none present.