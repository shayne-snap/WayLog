# WayLog - Save & Export AI Chat History

 

WayLog is a **local-first extension** that turns your fleeting AI conversations into a permanent, git-friendly knowledge base.


Stop losing valuable context when you switch IDEs or close a window. WayLog unifies your knowledge base from multiple coding assistants—Cursor, Copilot, Lingma, and more—in one secure place. **Never lose AI chat history.**

> ❗️ **Important Note**: All chat history is saved locally in the `.waylog` folder within your workspace.
>
## ✨ Key Features

- **Local-First Architecture**: WayLog runs locally, directly accessing the SQLite databases and JSON logs on your disk. Your data is processed on your devices.
- **Background Auto-Save**: Keep your history up-to-date without manual intervention.
- **Unified History Aggregation**: Automatically discovers and reads chat history from supported AI extensions installed on your devices.
- **Selective Saving**: Manually select specific conversations to save using the `Save AI Chat History` command.

## 🔌 Supported AI Assistants

WayLog connects with the following tools out of the box:

- **Cursor IDE** (Chat & Composer / Agent)
- **GitHub Copilot** (VS Code Extension)
- **Alibaba Lingma** (通义灵码 - VS Code Extension)
- **Tencent Cloud CodeBuddy** (腾讯云代码助手 - VS Code Extension)
- **Roo Code** (VS Code Extension)
- **Cline** (VS Code Extension)
- **Kilo** (VS Code Extension)
- **OpenAI Codex** (VS Code Extension)
- *...and more coming soon!*

## 📖 How to Use

1.  **Install WayLog** from the VS Code Marketplace, then **Restart VS Code or Cursor** to activate.
2.  **Open a Workspace**: WayLog requires an active folder to save your history.

3.  **Auto-Save**: WayLog automatically checks for new conversations in the background.


## 🔒 Privacy & Data

WayLog operates with a strict **local-first** policy. It intelligently interfaces with the local storage of your installed AI extensions to retrieve chat history in a read-only manner.
- We **do not** modify or delete your original chat records.
- All data processing happens entirely on your devices.
- Your chat history is saved directly to your workspace's `.waylog` folder, giving you full control over your data.

---

**Enjoy coding with zero memory loss.**
