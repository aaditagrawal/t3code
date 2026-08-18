# T3 Code

T3 Code is a minimal web GUI for coding agents made by [Pingdotgg](https://github.com/pingdotgg). This project is a downstream fork of the original [T3 Code](https://github.com/pingdotgg/t3code), maintained in [aaditagrawal/t3code](https://github.com/aaditagrawal/t3code).

This fork focuses on expanding provider support, keeping usage and limit monitoring visible, improving persistence layers, and refining provider management across the app. The current branded release is [T3 Code v0.0.36 — ACP Edition](https://github.com/aaditagrawal/t3code/releases/tag/v0.0.36).

It supports Codex, Claude Code, Cursor, Droid, OpenCode, Copilot, Gemini CLI, Amp, Kilo,
Hermes Agent, Pi, and configurable stdio ACP agents.

(NOTE: Amp /mode free is not supported, as Amp Code doesn't support it in headless mode - since they need to show ads for that business model to work.)

## Why this fork?

This fork aims to provide a more robust and feature-rich multi-provider experience, with improved server management, visible usage/rate-limit monitoring, more reliable persistence of orchestration events, and UI refinements for settings and model selection.

The protected fork features are multi-provider runtime support, usage and limit monitoring, provider management UX, and provider-neutral orchestration reliability. Upstream syncs should preserve those unless a change explicitly replaces them with equivalent or better behavior.

### Multi-provider support (Enhanced)

Adds full provider adapters (server managers, service layers, runtime layers) for agents that are not yet on the upstream roadmap:

| Provider       | What's included                                                            |
| -------------- | -------------------------------------------------------------------------- |
| Codex CLI      | App-server JSON-RPC support with usage/rate-limit monitoring               |
| Claude Code    | Full adapter with permission mode, thinking token limits, and SDK typings  |
| Cursor         | TypeScript SDK adapter + SDK model discovery + usage-dashboard tracking    |
| Droid          | Factory Droid SDK runtime integration                                      |
| OpenCode       | Adapter with hostname/port/workspace config                                |
| Amp            | Adapter + `ampServerManager` for headless Amp sessions                     |
| GitHub Copilot | Adapter + CLI binary resolution + text generation layer                    |
| Gemini CLI     | **Enhanced:** Adapter + `geminiCliServerManager` with full test coverage   |
| Kilo           | Adapter + `kiloServerManager` + OpenCode-style server URL config           |
| Hermes Agent   | ACP chats plus an optional companion for Home, cron, handoffs, and media   |
| Pi             | ACP integration through `pi-acp`, with shared model and session handling   |
| ACP Agent      | Configurable executable and argument list for any stdio ACP implementation |

Hermes uses `hermes-acp` for ordinary interactive conversations. Its optional [T3 companion plugin](integrations/hermes-t3-gateway/README.md) adds enrollment, proactive Home and cron delivery, handoffs, and media without replacing the standard ACP path. Pi stays on the shared ACP transport through `pi-acp`.

### Configurable ACP agents

In **Settings → Providers**, add an **ACP Agent** instance, enter its executable, and put one
command argument on each line. Credentials and model configuration stay agent-owned; instance
environment variables are inherited by the ACP process. This keeps T3 on the standard protocol
instead of adding a transport fork for every compatible agent.

Real OpenRouter turns using `dots-studio/dots-3-note-preview:free` are covered by the live ACP
harness for:

| Agent        | Executable       | Arguments, one per line                    |
| ------------ | ---------------- | ------------------------------------------ |
| Goose        | `goose`          | `acp`                                      |
| OpenCode     | `opencode`       | `acp`                                      |
| Qwen Code    | `qwen`           | `--acp`<br>`--experimental-skills`         |
| fast-agent   | `fast-agent-acp` | Configure the model with its CLI or config |
| Docker Agent | `docker-agent`   | `serve`<br>`acp`<br>`/path/to/agent.yaml`  |

Hermes and Pi remain available as branded presets because Hermes has companion capabilities and Pi
needs a separate `pi-acp` process. For Pi models whose OpenRouter metadata advertises maximum output
equal to the entire context window, install the [T3 Pi compatibility extension](integrations/pi-openrouter-compat/README.md).
It omits the unsafe request field rather than imposing a replacement token cap.

Kimi CLI and Cline can launch over ACP, but their current ACP servers require their own account
authentication before `session/new`, even when an OpenRouter key and custom model are configured.
They can still be added through **ACP Agent** after completing that vendor login, but OpenRouter alone
is not sufficient in the versions tested.

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
| Usage monitoring    | Context window meter, token usage events, and account rate-limit banner/panel visibility   |

## Getting started

### Quick install (recommended)

Run the interactive installer — it detects your OS, checks prerequisites (git, Node.js ≥ 24, bun ≥ 1.3.9), installs missing tools, and lets you choose between development/production and desktop/web builds:

```bash
# macOS / Linux / WSL
bash <(curl -fsSL https://raw.githubusercontent.com/aaditagrawal/t3code/main/scripts/install.sh)
```

```powershell
# Windows (Git Bash, MSYS2, or WSL)
bash <(curl -fsSL https://raw.githubusercontent.com/aaditagrawal/t3code/main/scripts/install.sh)
```

### Manual build

> [!WARNING]
> You need at least one supported coding agent installed and authorized. See the supported agents list below.

```bash
# Prerequisites: Bun >=1.3.9, Node >=24.13.1
git clone https://github.com/aaditagrawal/t3code.git
cd t3code
bun install
bun run dev
```

## Supported agents

- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Claude Code](https://github.com/anthropics/claude-code)
- [Cursor](https://cursor.sh)
- [Droid](https://factory.ai)
- [Codex CLI](https://github.com/openai/codex) (requires v0.37.0 or later)
- [Copilot](https://github.com/features/copilot)
- [Amp](https://ampcode.com)
- [Kilo](https://kilo.dev)
- [OpenCode](https://opencode.ai)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) (`hermes-acp`; run `hermes-acp --setup` after installation)
- [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (install it together with `pi-acp`, then authenticate with `pi`)
- Any stdio [Agent Client Protocol agent](https://agentclientprotocol.com/get-started/agents) through the configurable **ACP Agent** driver

## Notes

- This project is very early in development. Expect bugs.
- Interested in contributing? See [CONTRIBUTING.md](CONTRIBUTING.md).
- Special thanks to [Pingdotgg](https://github.com/pingdotgg) for the original project and [aaditagrawal](https://github.com/aaditagrawal) for the foundational fork.
