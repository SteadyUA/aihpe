# Codebase Guide for Agents

This repository is a monorepo containing a **React/Vite client** and a **Node.js/Express/TypeScript server**.

## 1. Build, Lint, and Test Commands

### Root Directory
- **Install Dependencies:** `npm install` (Installs for both workspaces)
- **Start Development (Both):** `npm run dev` (Runs client and server concurrently)
- **Build Production:** `npm run build` (Builds both and copies client assets to server public dir)

### Client (`/client`)
- **Start Dev Server:** `npm run dev` (Port 5173 default)
- **Build:** `npm run build` (Output to `dist`)
- **Lint:** `npm run lint` (ESLint)
- **Test:** *No test scripts currently configured.*

### Server (`/server`)
- **Start Dev Server:** `npm run dev` (Uses `ts-node-dev`, Port 5000 default)
- **Build:** `npm run build` (Compiles TS to `dist`)
- **Start Production:** `npm start` (Runs `dist/server.js`)
- **Database Migrations:**
  - Generate: `npm run migration:generate -- -n <MigrationName>`
  - Run: `npm run migration:run`
  - Revert: `npm run migration:revert`
- **Test:** *No test scripts currently configured.*

---

## 2. Code Style & Conventions

### General
- **Language:** TypeScript throughout.
- **Enums:** Always define and use TypeScript `enum`s for enumerable values instead of relying on magic strings.
- **Indentation:** **4 spaces** for source code (`.ts`, `.tsx`), **2 spaces** for configuration/JSON (`.json`, `.yml`).
- **Semicolons:** Always use semicolons.
- **Quotes:** Single quotes `'` preferred for strings, unless double quotes `"` are needed to avoid escaping.

### Client (React)
- **Framework:** React 19 + Vite.
- **Routing:** `react-router-dom` v7.
- **Component Style:** 
  - The codebase contains both **Class Components** (e.g., `App.tsx`) and **Functional Components**.
  - **New Components:** Use **Class Components** by default. Use functional components only as an exception where class components cannot be used.
- **State Management:** React local state and Context API (e.g., `ConnectionContext`).
- **Styling:** Use CSS modules for component-specific styles (e.g., `import styles from './Component.module.css'`). Use the `classnames` library for conditional class application. Global CSS files should only contain CSS variables. Inline styles are allowed only as an exception.
- **Naming:** PascalCase for components (`ProjectWorkspace.tsx`), camelCase for utilities/functions.

### Server (Node.js)
- **Framework:** Express with `routing-controllers`.
- **Dependency Injection:** Uses `typedi` (`@Service`, `Container.get`).
- **Database:** SQLite with `TypeORM`.
- **Architecture:** Controller-Service-Repository pattern.
  - **Controllers:** Class-based using decorators provided by `routing-controllers` (`@JsonController`, `@Get`, `@Post`, `@UseBefore`). Avoid interacting with raw Express `req` and `res` objects.
    - Use the `@CurrentUser()` decorator to access the user object instead of accessing the raw `@Req() request` object.
    - Use `@UploadedFile()` and `@UploadedFiles()` decorators for handling `multipart/form-data` uploads instead of parsing the request manually.
    - Use the `@HttpCode()` decorator to set specific success HTTP status codes (e.g., 201) rather than using the `response` object.
    - **File Responses:** For returning files or streams, do not use the raw `response` object. Instead:
      - Return a `FileResponse` object for files on disk.
      - Return a `FileStreamResponse` object for raw streams.
      - Use the `@UseInterceptor(FileResponseHandler)` decorator to handle these return types and automatically set the appropriate `Content-Type` header.
      - **Security:** Always use `path.basename(filename)` before joining with a directory path to prevent path traversal attacks.
    - Request and response objects (DTOs) must be defined as classes within the same file as the controller.
    - Do not return raw database entities. Map entities to response classes using private mapper functions defined within the controller class.
  - **Services:** Business logic, marked with `@Service()`.
  - **Entities:** TypeORM entities (`@Entity`, `@Column`).
- **Event Bus:** Applications use a custom `EventBus` wrapper (`server/src/utils/bus.ts`) over `ts-bus`. 
  - Define events in the same file as the Service that publishes them (e.g., `UserService.ts`) via `EventBus.createEvent()`. 
  - **Global/Lifecycle Events:** Core system events (e.g., `AppStartedEvent`, `AppStoppingEvent`) are defined in `server/src/utils/bus.ts`.
  - Services can inject `EventBus` to `.publish()` events. 
  - **Publishing Timing:** ALWAYS publish events at the very end of a function, after all database operations (e.g., `save`, `delete`) and local state changes have fully completed. This prevents race conditions where handlers might query the database before the originating transaction or operation has finalized.
  - **Subscribers (Handlers):** Event subscribers must be placed in `server/src/handlers/` and use the `@Subscribe` decorator on their methods. Do not subscribe inside core business services to separate concerns. **Do not** import `ts-bus` directly.
  - **Error Handling in Subscribers:** Do not wrap subscriber methods in `try...catch` blocks. Errors thrown by subscribers or rejected promises are caught and logged centrally in the `EventBus` wrapper (`server/src/utils/bus.ts`).
- **Error Handling:** Use standard `try-catch` blocks. Controllers should throw HTTP errors (e.g., `HttpError`, `NotFoundError`, `ForbiddenError`, `BadRequestError`) which are classes provided by `routing-controllers` and are automatically handled by middleware. Do not manually use the `response` object to return error status codes.
- **Async/Await:** Always prefer `async/await` over raw Promises.

### Imports
- **Ordering:**
  1. External libraries (`react`, `express`, `typedi`).
  2. Internal absolute/alias imports (if configured).
  3. Internal relative imports (`./components/...`, `../services/...`).
  4. Styles (`./App.css`).
- **Type Imports:** Use `import type` when importing interfaces/types only, to aid tree-shaking (optional but recommended).

### Workflow Rules for Agents
1. **Monorepo Awareness:** Always double-check which workspace (`client` or `server`) you are operating in.
2. **Configuration:** Respect `.env` usage. Client uses `import.meta.env`, Server uses `process.env`.
3. **Existing Patterns:** Before creating new controllers or components, read `TaskController.ts` or `App.tsx` respectively to match the exact decorator usage and class structure.
4. **Safety:** When modifying the database schema, always create a migration script rather than relying on `synchronize: true` in production.
5. **Environment Integrity:** DO NOT modify `.env` files. If you need to change environment variables for a temporary or test script, pass the values in the command line (e.g., `VAR=value npm run script`) instead of changing the `.env` file.
6. **Data Persistence:** DO NOT reset the database or delete existing data. If a table structure must be recreated, create a temporary script to migrate data instead of dropping tables and re-running migrations.

---

## 3. Git Commit Guidelines for Agents

To maintain a clean, readable, and consistent project history, all AI agents must format their Git commits according to the following template (based on the Conventional Commits standard).

### Commit Message Template

```text
<type>(<scope>): <subject>

<body>
```

### Rules

1. **`<type>`**: Must be one of the following:
   - `feat`: A new feature
   - `fix`: A bug fix
   - `refactor`: Code changes that neither fix a bug nor add a feature (e.g., extracting DTOs, restructuring)
   - `docs`: Documentation-only changes (e.g., updating `AGENTS.md` or README)
   - `chore`: Maintenance tasks, dependency updates, or configuration changes
   - `style`: Code style changes (formatting, missing semicolons, etc.)
2. **`<scope>`**: Indicates the workspace or area affected. Use `client`, `server`, `shared`, `db`, or `config`. If the change spans across the entire monorepo, you can omit the scope.
3. **`<subject>`**: A short, imperative summary of the change (maximum 72 characters). Start with a lowercase letter and do not put a period at the end.
   - *Example:* `add filename property to SessionVersionFileParams`
4. **`<body>`**: Provide a detailed explanation of **WHY** the change was made and **HOW** it solves the problem. Agents should use this section to summarize their architectural decisions, making it easier for human developers to review the commit context without reading AI conversation logs. Wrap lines at 72 characters.
