# Changelog

All notable changes to this project will be documented in this file.

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
