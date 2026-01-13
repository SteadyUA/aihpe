# Changelog

All notable changes to this project will be documented in this file.

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
