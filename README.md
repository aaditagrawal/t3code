# T3 Code (Gemini Fork)

T3 Code is a minimal web GUI for coding agents made by [Pingdotgg](https://github.com/pingdotgg). This project is a downstream fork of [aaditagrawal's T3 Code](https://github.com/aaditagrawal/t3code), which itself is a fork of the original [T3 Code](https://github.com/pingdotgg/t3code). 

This fork by [mtdewwolf](https://github.com/mtdewwolf) focuses on enhancing the Gemini CLI integration, improving persistence layers, and refining the provider management system.

It supports Codex, Claude Code, Cursor, Copilot, Gemini CLI, Amp, Kilo, and OpenCode.

(NOTE: Amp /mode free is not supported, as Amp Code doesn't support it in headless mode - since they need to show ads for that business model to work.)

## Why this fork?

This fork aims to provide a more robust and feature-rich experience for Gemini CLI users, with improved server management and more reliable persistence of orchestration events. It also includes several UI refinements for settings and model selection.

### Multi-provider support (Enhanced)

Adds full provider adapters (server managers, service layers, runtime layers) for agents that are not yet on the upstream roadmap:

| Provider    | What's included                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Gemini CLI  | **Enhanced:** Adapter + `geminiCliServerManager` with full test coverage   |
| Amp         | Adapter + `ampServerManager` for headless Amp sessions                    |
| Copilot     | Adapter + CLI binary resolution + text generation layer                   |
| Cursor      | Adapter + ACP probe integration + usage tracking                          |
| Kilo        | Adapter + `kiloServerManager` + OpenCode-style server URL config          |
| OpenCode    | Adapter + `opencodeServerManager` with hostname/port/workspace config     |
| Claude Code | Full adapter with permission mode, thinking token limits, and SDK typings |

### Persistence & Orchestration Improvements

- **Normalized Provider Kinds:** Migration added to handle legacy provider kind naming consistently.
- **Improved Event Store:** Robust persistence layer for orchestration events with better error handling.
- **Session Management:** refined `ProviderSessionDirectory` for better tracking of active sessions.

### UX enhancements

| Feature             | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Settings page       | Dedicated route (`/settings`) for theme, accent color, and custom model slug configuration |
| Accent color system | Preset palette with contrast-safe terminal color injection across the entire UI            |
| Theme support       | Light / dark / system modes with transition suppression                                    |
| Command palette     | `Cmd+K` / `Ctrl+K` palette for quick actions, script running, and thread navigation        |
| Sidebar search      | Normalized thread title search with instant filtering                                      |
| Plan sidebar        | Dedicated panel for reviewing, downloading, or saving proposed agent plans                 |
| Terminal drawer     | Theme-aware integrated terminal with accent color styling                                  |

## Getting started

### Quick install (recommended)

Run the interactive installer — it detects your OS, checks prerequisites (git, Node.js ≥ 24, bun ≥ 1.3.9), installs missing tools, and lets you choose between development/production and desktop/web builds:

```bash
# macOS / Linux / WSL
bash <(curl -fsSL https://raw.githubusercontent.com/mtdewwolf/t3code-gemini/main/scripts/install.sh)
```

```powershell
# Windows (Git Bash, MSYS2, or WSL)
bash <(curl -fsSL https://raw.githubusercontent.com/mtdewwolf/t3code-gemini/main/scripts/install.sh)
```

### Manual build

> [!WARNING]
> You need at least one supported coding agent installed and authorized. See the supported agents list below.

```bash
# Prerequisites: Bun >=1.3.9, Node >=24.13.1
git clone https://github.com/mtdewwolf/t3code-gemini.git
cd t3code-gemini
bun install
bun run dev
```

## Supported agents

- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Claude Code](https://github.com/anthropics/claude-code)
- [Cursor](https://cursor.sh)
- [Codex CLI](https://github.com/openai/codex) (requires v0.37.0 or later)
- [Copilot](https://github.com/features/copilot)
- [Amp](https://ampcode.com)
- [Kilo](https://kilo.dev)
- [OpenCode](https://opencode.ai)

## Notes

- This project is very early in development. Expect bugs.
- Interested in contributing? See [CONTRIBUTING.md](CONTRIBUTING.md).
- Special thanks to [Pingdotgg](https://github.com/pingdotgg) for the original project and [aaditagrawal](https://github.com/aaditagrawal) for the foundational fork.
