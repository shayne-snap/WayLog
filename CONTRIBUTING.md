# Contributing to WayLog

Thank you for your interest in contributing to WayLog! We welcome contributions from the community.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue on GitHub with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, VS Code/Cursor version, WayLog version)

### Suggesting Features

We love new ideas! Please create an issue with:
- A clear description of the feature
- Why it would be useful
- Any implementation ideas you have

### Pull Requests

1. **Fork the repository** and create a new branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**:
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes**:
   - Test manually in both VS Code and Cursor
   - Ensure existing functionality still works

4. **Commit your changes**:
   ```bash
   git commit -m "feat: add your feature description"
   ```
   
   Use conventional commit messages:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `refactor:` for code refactoring
   - `chore:` for build/tooling changes

5. **Push and create a PR**:
   ```bash
   git push origin feat/your-feature-name
   ```
   Then create a Pull Request on GitHub.

## Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/shayne-snap/WayLog.git
   cd WayLog
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Open in VS Code**:
   ```bash
   code .
   ```

4. **Run the extension**:
   - Press `F5` to start debugging
   - A new VS Code window will open with the extension loaded

## Project Structure

```
src/
├── commands/          # Command implementations
├── services/          # Core services
│   ├── readers/      # Chat history readers for different tools
│   └── auto-save.ts  # Auto-save functionality
└── utils/            # Utility functions
```

## Code Style

- Use TypeScript
- Follow existing naming conventions
- Use 4 spaces for indentation
- Add JSDoc comments for public APIs

## Questions?

Feel free to create an issue or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
