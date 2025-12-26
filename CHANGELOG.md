# Change Log

All notable changes to the "WayLog" extension will be documented in this file.

## [0.0.5] - 2025-12-26

### Fixed
- **CodeBuddy on Windows**: Fixed an issue where chat history was not being detected correctly on Windows
- **App Detection**: Improved detection logic for CodeBuddy to prioritize workspaces with actual chat history
- **VS Code Insiders**: Added support for Alibaba Lingma when running in VS Code Insiders

### Documentation
- **Open Source**: Updated documentation to highlight open-source status and contribution guidelines


## [0.0.3] - 2025-12-26

### Fixed
- **Windows Compatibility**: Fixed GitHub Copilot Chat detection on Windows for both VS Code Stable and Insiders
- **App Support**: Improved detection for Cline, Roo Code, and Kilo Code on VS Code Stable and Insiders

### Improved
- **Performance**: Improved database query performance and stability across all platforms
- **Reliability**: Enhanced cross-platform compatibility for path detection

### Documentation
- **Contribution**: Added Contributing Guide and updated License information


## [0.0.2] - 2025-12-26

### Fixed
- **App Selection**: Fixed an issue where Cursor was incorrectly auto-selected in VS Code environments
- **User Experience**: Improved the provider selection prompt to only appear when necessary

### New
- **Marketplace**: Added support for Open VSX Registry (compatible with VSCodium, etc.)


## [0.0.1] - 2025-12-26

- **Initial Release**: Launched WayLog with full cross-platform support (macOS & Windows)
- **Supported Apps**: Auto-discovery for Cursor, GitHub Copilot, Alibaba Lingma, CodeBuddy, Cline, Roo Code, and more
- **Core Features**:
    - Background auto-save to local `.waylog` folder
    - Export chat history to Markdown with full metadata
    - Smart session filtering and fuzzy workspace matching
