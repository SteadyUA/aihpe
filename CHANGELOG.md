# Changelog

All notable changes to this project will be documented in this file.

## [v5.0.0] - 2026-05-28

### Added
- **Project Import/Initialization**: Enhanced project layout, initialization UI, workflow, and markdown rendering.
- **Client Features**:
  - Implemented visual highlighting for active clipboard items.
  - Implemented LRU cache and robust scroll sync for session previews.
  - Polished Project Workspace UI and `UiButton` component.
  - Moved element picker to preview toolbar.
- **Server Features**:
  - Implemented file-based ETag caching in `FileResponseHandler`.
  - Stabilized and enhanced autonomous HTML import orchestration pipeline workflows.
- **Shared/Core**:
  - Pushed resource description updates via SSE.
  - Enhanced LLM file editing tools and handled `ToolAbortError`.

### Changed
- **Client Architecture**: Implemented React Portals for the layout system and adjusted UI styles.
- **Server Architecture**: Simplified edit tools, enforced fail-fast in prompts, refined job granularity rules in the HTML plan prompt, and strictly enforced exact resource filenames in `PageGenPrompt`.
- **Shared Data Models**: Removed the `Task` entity and migrated the project initialization flow.
- **Documentation**: Consolidated agent rules and removed obsolete files.

### Fixed
- Added support for AVIF thumbnails and metadata extraction.
- Fixed resource selection on thumbnail click in user messages.
- Isolated ElementPicker per Preview iframe to preserve selection.
- Matched session collage order with project session order.
- Deferred import-completed broadcast until temp dir is cleaned up.
- Fixed `HtmlImportService` SSE status broadcasting and paths.
- Applied IDE curl/wget patch in devcontainer and removed obsolete path workaround.
- Ignored nested `dist` and `node_modules` directories in docker build.

## [v4.0.0] - 2026-05-12

### Added
- **Screenshot Service**: Introduced `screenshot-service` microservice for generating web page previews and thumbnails.
- **Global Clipboard System**: Implemented cross-project global clipboard for seamless resource sharing.
- **Memory Management**: Introduced tool-based memory files system for session context (`edit_memory_file` tool) and migrated memory display to version badges.
- **Interactive Quotes**: Added interactive quotes and a modular context menu in the client, alongside cursor navigation improvements.
- **Parallel Generation**: Implemented parallel generation and unified session cloning.
- **Console Commands**: Added `get-models` server console command.

### Changed
- **HTML Archive Import**: Improved the mechanism for importing HTML archives during project creation.
- **Project Structure**: Simplified the project entity structure.
- **Resource Management**: Refactored `ImageService` into `SessionResourceService`, adding robust support for video and font files.
- **SSE Architecture**: Completely decoupled `ChatService` and implemented a robust event-driven architecture for SSE.
- **API & Controllers**: Modernized API endpoints with explicit DTOs and interceptors.
- **LLM Infrastructure**: Refactored core LLM architecture, decoupled tools, and improved token usage tracking.
- **Database Schema**: Standardized database schema and enums. Removed foreign key constraints from Session to Project and dropped legacy summary/preferences columns.
- **Client UI**: Enhanced Chat message UI with timestamps and flexible layouts. Standardized UI components and session state.

### Fixed
- Fixed `targetIndex` resolution and initialization during tool calls in `OpenaiRawClient` to prevent chunk shattering.
- Fixed UI modal constraints and memory modal rendering.
- Fixed missing metadata fields during session clone.

## [v3.1.0] - 2026-02-19

### Added
- **AI Integration**:
  - Implemented page generation logic.
  - Added history summarization with new LLM client architecture.
- **Security**:
  - Implemented robust authorization for SSE connections.

### Fixed
- **Chat**:
  - Fixed image attachment uploading functionality.
- **Infrastructure**:
  - Fixed Nginx buffering issues causing delayed streaming responses.
- **General**:
  - Fixed project creation flow.
  - Fixed initial JavaScript initialization errors.
  - Fixed SSE reconnection logic.

## [v3.0.0] - 2026-02-12

### Added
- **Infrastructure**:
  - Added comprehensive Docker and Devcontainer setup for development and production.
  - Added `APP_BASE_PATH` configuration support.
- **AI Integration**:
  - Implemented `LiteLLMImageService` and `OpenaiClient` for enhanced LLM support.
  - Added `LITELLM_IMAGE_MODEL` environment variable support.
  - Added `TokenUsageService` for better token tracking and management.
  - Added context summarization logic.

### Changed
- **Storage Migration**:
  - Migrated data storage from JSON files to a SQLite database.
- **Architecture**:
  - Refactored `ChatService` and `AiClient` implementations.
  - Removed `session.history` abstraction in favor of `session.turns`.
  - Refactored client layout and components composition.
- **UI/UX**:
  - Significant UI improvements including Session Bar refactoring.
  - Improved usage abort controllers for background requests.
  - Enhanced session summary generation.

### Fixed
- Fixed Devcontainer configuration issues.
- Fixed UI title display.

## [v2.0.0] - 2026-01-12

### Added
- **Authentication System**:
  - Implemented server-side account management with `accounts.json`.
  - Added user login and logout functionality.
  - Added `create-account` and `change-password` server console commands.
  - Added Authentication middleware for securing API endpoints.
  - Added Client-side token refresh mechanism (JWT).
- **Projects Support**:
  - Introduced Project-based structure with `projects.json`.
  - Added Projects dashboard and project selection logic.
  - Added Project Settings UI.
- **Settings Page**: New settings page including "Change Password" functionality.
- **Planing** Added planing mode implementation (default mode).
- **Fast Mode**: Fast Mode for quicker agent interactions.
- **Localization**: Full application localization to English.
- **Tools**: Added `image_info` tool for the AI agent.

### Changed
- **UI/UX**:
  - Refactored Global Layout: `AppHeader` now persists across navigation.
  - Improved Chat user interface.
  - Enhanced Preview component and added color preview.
  - Improved split-view resizing experience.
  - "Step-based" window management logic.
- **Session Management**:
  - Improved session state persistence and error handling.
  - Persistent session error states displayed to the user.
- **API**: Refactored API routes for better structure and security.

### Fixed
- Fixed session deletion consistency between file system and project data.
- Fixed transition animations (removed for better feel).
- Various bug fixes in `RichInput` and modal dialogs.
