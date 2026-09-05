# AGENTS.md

T3 Code is a multi-provider GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (ACP Agent, Codex, Claude Code, Cursor, Droid, Fx, Grok, OpenCode, Amp, Copilot, Gemini CLI, Hermes Agent, Kilo, Oh My Pi, Pi, and Antigravity) and serves web, desktop, and mobile clients.

## Git & GitHub Policy (CRITICAL — DO NOT VIOLATE)

- This is a FORK of `pingdotgg/t3code`. The upstream remote is READ-ONLY for us.
- **NEVER create PRs, push branches, post comments, or perform ANY write operation against `pingdotgg/t3code` or any upstream/third-party repo.**
- **NEVER run `gh pr create` without `--repo aaditagrawal/t3code`.** Always explicitly target the fork.
- **NEVER run `gh` write commands (pr create, issue create, pr comment, pr close, pr merge) against any repo other than `aaditagrawal/t3code`.**
- Any request involving PRs, issues, GitHub Actions, workflows, checks, comments, labels, releases, or other GitHub repo operations is fork-only: use `aaditagrawal/t3code` explicitly and do not target upstream.
- The ONLY interaction with upstream is `git fetch upstream` to pull changes. Everything else targets `origin` (the fork).
- When merging upstream changes, create a PR on `aaditagrawal/t3code` targeting the fork's `main` branch.

## Fork-First Policy

- The fork's `README.md` takes priority over upstream's. On merge conflicts, keep ours.
- Do NOT commit scratch/analysis markdown files (e.g. `CONFLICT_ANALYSIS.md`, plan dumps) into the repo.

## Protected Fork Features

When syncing upstream, preserve these fork features unless the user explicitly asks to remove them:

1. Multi-provider runtime support for the built-in drivers: configurable ACP, Codex CLI, Claude Code, Cursor, Droid, Fx, Grok Build, OpenCode, Amp, Copilot, Gemini CLI, Hermes Agent, Kilo, Oh My Pi, Pi, and Antigravity.
2. Usage and limit monitoring, including token/context usage snapshots, provider usage events, Codex account rate-limit streams, and the web rate-limit banner/panel UX.
3. Provider management UX, including custom provider instances, per-instance environment/config/model state, custom model slugs, and provider-scoped traits such as reasoning, context window, fast mode, and agent selection.
4. Provider-neutral orchestration reliability, including SQLite event persistence, command receipts, replay/live stream ordering, session restart/reconnect behavior, and projection consistency.

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.
- Keep local verification focused on the files and packages changed when iterating. Prefer `vp test run <test-files>` for focused Vite+ tests; use `vp run test` when the affected package specifically requires its `test` script.
- Backend changes must include and run focused tests for the changed behavior.
- After frontend feature development or any user-visible frontend behavior change, the primary agent must run one integrated verification pass for each affected client surface after integrating the work:
  - Web: use the `test-t3-app` skill. Launch one isolated environment, authenticate through the printed pairing URL, and verify the affected flow in the controlled browser.
  - Mobile: use the `test-t3-mobile` skill. Connect one representative iOS Simulator or Android Emulator available on the host to one isolated environment and verify the affected flow. On compatible macOS hosts, prefer iOS for cross-platform changes and stream it through serve-sim in the T3 Code in-app browser or another available agent browser; use Android when it is the affected or viable platform.
  - Subagents must not independently launch dev servers or repeat integrated client verification unless their delegated task explicitly requires it.
  - Stop dev servers, watchers, and other long-running verification processes when the focused verification is complete.

## Project Snapshot

T3 Code is a multi-provider web GUI for coding agents. This fork supports 16 built-in provider drivers. `BUILT_IN_DRIVERS` in `apps/server/src/provider/builtInDrivers.ts` is the source of truth:

- **ACP Agent** — configurable executable and arguments for any stdio ACP implementation
- **Codex CLI** (v0.37.0+) — JSON-RPC over stdio
- **Claude Code** — Claude Agent SDK with thinking tokens and permission modes
- **Cursor** — TypeScript SDK with local agents, SDK model discovery, and usage-dashboard tracking
- **Droid** — Factory Droid SDK runtime
- **Fx** — `fx acp` over stdio
- **Grok Build** — ACP over stdio with xAI protocol extensions
- **OpenCode** — SDK CLI server
- **Antigravity** — official Google ACP agent with managed install and Google sign-in
- **Amp** — Amp Code headless mode (no `/mode free`)
- **Copilot** — GitHub Copilot CLI
- **Gemini CLI** — Google Gemini CLI with persistent JSON
- **Hermes Agent** — `hermes-acp` over stdio
- **Kilo** — HTTP SSE transport
- **Oh My Pi** — `omp acp` over stdio
- **Pi** — `pi-acp` over stdio

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long-term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server` (`"t3"`) — Node.js WebSocket server. Multi-provider session management, orchestration engine, event persistence (SQLite), and RPC streams to the web client.
- `apps/web` (`"@t3tools/web"`) — React/Vite UI. Session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `apps/desktop` (`"@t3tools/desktop"`) — Electron desktop app wrapping the web UI.
- `apps/marketing` (`"@t3tools/marketing"`) — Astro marketing site.
- `apps/mobile` — Expo/React Native mobile app (WIP), sharing client code via `packages/client-runtime`.
- `packages/contracts` (`"@t3tools/contracts"`) — Shared Effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared` (`"@t3tools/shared"`) — Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`, `@t3tools/shared/model`, `@t3tools/shared/logging`) — no barrel index.
- `packages/client-runtime` — Shared runtime package for sharing client code across web and mobile.

## Server Architecture

### Provider Adapter Pattern

All providers implement `ProviderAdapterShape` in `apps/server/src/provider/Services/ProviderAdapter.ts`. Capabilities declare `sessionModelSwitch` (`"in-session"` or `"unsupported"`), optional `promptlessTurnContinuation`, and optional `supportsConversationRollback`. Adapters without native history rewind must explicitly set `supportsConversationRollback: false` so checkpoints reject rewind before restoring files.

`provider/builtInDrivers.ts` registers built-in drivers; the adapter registry resolves providers and their configured instances. Transport and model discovery are driver implementation details, not adapter capability fields. Complex providers have dedicated process managers, while ACP providers share the runtime in `provider/acp/`.

### Key Server Modules

- `apps/server/src/provider/Services/ProviderService.ts` — Cross-provider facade for sessions, turns, and checkpoints.
- `apps/server/src/provider/Services/ProviderAdapterRegistry.ts` — Adapter lookup by provider kind.
- `apps/server/src/provider/Services/ProviderSessionDirectory.ts` — Session lifecycle management.
- `apps/server/src/orchestration/Services/OrchestrationEngine.ts` — Command dispatch, event persistence, read-model updates.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — Normalizes provider events into canonical `OrchestrationEvent` type.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Projects events into queryable state.
- `apps/server/src/ws.ts` — WebSocket RPC server using Effect's `RpcServer.toHttpEffectWebsocket()`.

### Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the chat view is usually also reachable from Settings, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (wraps web, adds Electron shell/IPC), and mobile (React Native, separate navigation). Shared logic lives in `packages/client-runtime`.
- **Providers.** ACP Agent, Codex, Claude, Cursor, Droid, Fx, Grok, OpenCode, Antigravity, Amp, Copilot, Gemini CLI, Hermes Agent, Kilo, Oh My Pi, and Pi each have an adapter. Provider-shaped features need a decision per adapter, even if the decision is "not supported here".
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and the server, web, mobile, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Snooze needs unsnooze. Close needs reopen. A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel behave differently. Multi-device and multi-environment cases are real.
- **Docs.** `docs/` splits by audience. Behavior changes that a user would notice belong in `docs/user/` (shipped-product voice, no repo tooling or source paths); architecture and contributor changes in `docs/internals/`; runbooks in `docs/operations/`; new vocabulary in `docs/internals/glossary.md`.

### Event Sourcing & Orchestration

Provider runtime activity is normalized into canonical `OrchestrationEvent`s by the ingestion layer, persisted in a SQLite event store with sequence-based ordering, and projected into in-memory materialized views. Clients receive ordered events via Effect RPC streams (replay + live merge). Command receipts provide idempotency for reconnects and retries.

## Local Development Notes

- `vp i` installs. Worktrees get this from the `t3.json` setup script; if module resolution looks broken, it probably did not run.
- `vp run dev` starts server and web. In a worktree, state defaults to that worktree's gitignored `.t3`, which deliberately outranks an ambient `T3CODE_HOME` so you cannot land on shared state by accident. An explicit `--home-dir` still wins.
- Ports derive from the worktree path and are stable across restarts, but read the real ones from the `[dev-runner]` line since occupied ports shift.
- Sharing over the tailnet is three steps: run `vp run dev --share` in the background, wait for the `pairingUrl:` line in its output, paste that full URL (token included) in your reply. Do not wire up `tailscale serve` by hand for this, and do not open the URL yourself.
- The web app requires pairing. Hand over the pairing URL, not the bare origin. A URL without its token is useless to whoever you gave it to. If the token got consumed, mint a fresh one with `node apps/server/src/bin.ts pair` — note it carries standard scopes, while the startup URL carries admin scopes (needed for Settings → Connections management).
- Stop what you started, by the PID you tracked.

### Effect Architecture

The server uses Effect throughout for dependency injection, typed errors, and streaming:

- `Layer.effect()` for service composition
- `Effect.gen()` generator-style async
- `Stream` API for event/data streaming
- Domain-specific error types (`ProviderAdapterError`, `OrchestrationDispatchError`, etc.)

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- Codex-Monitor (Tauri, feature-complete reference): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `vpr sync:repos`; use `vpr sync:repos --repo <id>` to sync one configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed T3 Code server in the user guides.
