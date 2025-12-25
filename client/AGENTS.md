# Client Agent Guide
1. Dev server: `npm run dev --prefix client` (Vite + React 19).
2. Build artifacts: `npm run build --prefix client`; preview via `npm run preview --prefix client`.
3. Lint before pushing: `npm run lint --prefix client` (ESLint flat config).
4. Tests are not wired; once added run single specs with `npm run test -- --runInBand path/to/file.test.ts`.
5. Never commit secrets; load env values via Vite `import.meta.env`.
6. Prefer function components + hooks; only use class components when lifecycle control demands it.
7. Type everything: explicit `Props`/`State` interfaces, no implicit `any`.
8. Imports order: Node builtins, third-party, blank line, internal `src/...` modules.
9. Formatting: 4 spaces indentation, single quotes, wrap JSX props when >80 chars, minimal trailing commas.
10. Keep JSX expression per line; multiline props end with closing bracket on its own line.
11. CSS Modules live beside components; use camelCase class names and `classnames` for conditionals.
12. Reuse DTOs/types shared by the server to avoid magic literals.
13. Side effects live in `useEffect` with cleanup; remove global listeners/timeouts on unmount.
14. Streams/WebSocket/SSE handlers must unsubscribe in `useEffect` cleanup to prevent leaks.
15. Fetch/data logic goes in hooks or `/src/lib`, keep components focused on rendering.
16. Surface user-friendly errors in UI; log technical details to the console sparingly.
17. Prefer `async/await`; wrap network code in try/catch and expose loading/error states.
18. Document new scripts or guidelines in this file and mirror critical items in the root `AGENTS.md`.
