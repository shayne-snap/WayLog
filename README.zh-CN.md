# WayLog - 保存和导出 AI 对话历史

[English](README.md) | [简体中文](README.zh-CN.md)

[![GitHub](https://img.shields.io/badge/GitHub-shayne--snap%2FWayLog-blue?logo=github)](https://github.com/shayne-snap/WayLog)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/waylog.waylog)](https://marketplace.visualstudio.com/items?itemName=waylog.waylog)
[![License](https://img.shields.io/github/license/shayne-snap/WayLog)](https://github.com/shayne-snap/WayLog/blob/main/LICENSE)

WayLog 是一个**免费、开源、本地优先的扩展**，它能将你转瞬即逝的 AI 对话转化为永久的、Git 友好的知识库。

不要再因为切换 IDE 或关闭窗口而丢失宝贵的上下文了。WayLog 将来自多个编码助手（Cursor、Copilot、通义灵码等）的知识库统一到一个安全的地方。**永不丢失 AI 对话历史。**

🌟 **[GitHub 开源](https://github.com/shayne-snap/WayLog)** - 社区驱动开发，透明且值得信赖。

> ❗️ **重要提示**：所有对话历史都保存在工作区的 `.waylog` 文件夹中。

## ✨ 核心特性

- **🌟 开源项目**：完全透明，采用 Apache-2.0 许可证，社区驱动。[在 GitHub 上贡献](https://github.com/shayne-snap/WayLog)！
- **本地优先架构**：WayLog 在本地运行，直接访问磁盘上的 SQLite 数据库和 JSON 日志。你的数据在你的设备上处理。
- **后台自动保存**：无需手动操作，保持历史记录实时更新。
- **统一历史聚合**：自动发现并读取设备上已安装的受支持 AI 扩展的对话历史。
- **选择性保存**：使用 `Save AI Chat History` 命令手动选择要保存的特定对话。
- **跨平台支持**：完全兼容 macOS（Intel 和 Apple Silicon）以及 Windows（x64 和 ARM64）。

## 🔌 支持的 AI 助手

WayLog 开箱即用地支持以下工具：

- **Cursor IDE**（聊天和 Composer / Agent）
- **GitHub Copilot**（VS Code 扩展）
- **阿里巴巴通义灵码**（VS Code 扩展）
- **腾讯云代码助手 CodeBuddy**（VS Code 扩展）
- **Roo Code**（VS Code 扩展）
- **Cline**（VS Code 扩展）
- **Kilo**（VS Code 扩展）
- **OpenAI Codex**（VS Code 扩展）
- *...更多即将推出！*

## 📖 使用方法

1.  从 VS Code 市场**安装 WayLog**，然后**重启 VS Code 或 Cursor** 以激活。
2.  **打开工作区**：WayLog 需要一个活动文件夹来保存你的历史记录。
3.  **自动保存**：WayLog 会在后台自动检查新对话。

## 🔒 隐私与数据

WayLog 采用严格的**本地优先**策略。它智能地与已安装 AI 扩展的本地存储进行交互，以只读方式检索对话历史。
- 我们**不会**修改或删除你的原始对话记录。
- 所有数据处理完全在你的设备上进行。
- 你的对话历史直接保存到工作区的 `.waylog` 文件夹，让你完全掌控自己的数据。

## 🤝 贡献

WayLog 是**开源的**，我们欢迎来自全球开发者的贡献！🌍

**代码仓库**：[github.com/shayne-snap/WayLog](https://github.com/shayne-snap/WayLog)

无论你想：
- 🐛 报告 bug 或请求新功能
- 🔌 添加对新 AI 助手的支持
- 📝 改进文档
- 💻 贡献代码改进

请查看我们的[贡献指南](https://github.com/shayne-snap/WayLog/blob/main/CONTRIBUTING.md)开始参与。

**加入我们，一起打造最好的 AI 对话历史工具！** ⭐

## 📄 许可证

本项目采用 **Apache License 2.0** 许可证 - 详见 [LICENSE](LICENSE) 文件。

Copyright (c) 2025 WayLog Contributors

---

**享受零记忆丢失的编码体验。**
