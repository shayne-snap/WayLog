# Change Log

All notable changes to the "WayLog" extension will be documented in this file.

## [0.0.3] - 2025-12-26

### Fixed
- **Windows Compatibility**: Fixed GitHub Copilot Chat detection on Windows by supporting both VS Code Stable and Insiders versions
- **Path Detection**: Fixed Cline/Roo Code/Kilo Code readers to detect both VS Code Stable and Insiders installations
- **Cross-Platform Paths**: Unified path handling using `PlatformPaths` utility for better maintainability

### Improved
- **SQLite Performance**: Simplified SQLite query implementation by using `@vscode/sqlite3` on all platforms, removing system CLI dependency
- **Code Quality**: Reduced code complexity by ~34 lines in `BaseVscdbReader`, improving maintainability
- **Consistency**: All platforms now use the same SQLite implementation for consistent behavior

### Documentation
- **README**: Added Contributing and License sections
- **Open Source**: Updated LICENSE copyright to 2025 WayLog Contributors
- **Cleanup**: Removed `.specstory` directory and added to `.gitignore`

## [0.0.2] - 2025-12-26

- **Fixed**: Resolved issue where Cursor Reader was incorrectly auto-selected in VS Code when no other AI tools had chat history.
- **Improved**: Provider selection logic now only skips the picker when there's exactly one "active" provider in the current environment.
- **Enhanced**: Added Open VSX publishing support for broader compatibility with VS Code forks.

## [0.0.1] - 2025-12-26

- **Initial Release**: Launched WayLog with full cross-platform support (macOS Intel/Apple Silicon, Windows x64/ARM64).
- **Core Features**:
    - Auto-discovery and local reading of Cursor, Lingma, CodeBuddy, and other AI assistant histories.
    - Background auto-save to `.waylog` folder in your workspace.
    - Export chat history to Markdown with metadata (models, timestamps).
- **Optimization**: Built with esbuild bundling for minimal size (~5MB compressed) and fast startup.
- **Robustness**: Native SQLite integration for reliable data access, fuzzy path matching for Windows compatibility, and smart empty session filtering.
