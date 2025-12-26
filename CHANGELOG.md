# Change Log

All notable changes to the "WayLog" extension will be documented in this file.

## [0.0.1] - 2025-12-26

- **Initial Release**: Launched WayLog with full cross-platform support (macOS Intel/Apple Silicon, Windows x64/ARM64).
- **Core Features**:
    - Auto-discovery and local reading of Cursor, Lingma, CodeBuddy, and other AI assistant histories.
    - Background auto-save to `.waylog` folder in your workspace.
    - Export chat history to Markdown with metadata (models, timestamps).
- **Optimization**: Built with esbuild bundling for minimal size (~5MB compressed) and fast startup.
- **Robustness**: Native SQLite integration for reliable data access, fuzzy path matching for Windows compatibility, and smart empty session filtering.
