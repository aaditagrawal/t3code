# Upstream Sync: 33 Commits Integration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Integrate 33 upstream commits from pingdotgg/t3code into the aaditagrawal/t3code fork while preserving multi-provider support (Gemini, Copilot, Cursor, OpenCode, Amp, Kilo).

**Architecture:** Upstream made 3 major architectural changes: (1) replaced the hand-rolled WebSocket RPC with Effect's unstable RPC module, (2) restructured server entrypoint from main.ts to bin.ts/cli.ts/server.ts, (3) migrated all services to Effect.fn pattern. The fork must adopt all 3 while re-wiring its 6 extra provider adapters into the new architecture.

**Strategy:** Phased merge — accept upstream's architecture first (take theirs for structural conflicts), then re-add multi-provider support on top. This avoids fighting the architecture while preserving the fork's value-add.

---

## Phase 0: Preparation

### Task 0.1: Create integration branch

**Objective:** Set up a clean branch for the sync work.

```bash
cd ~/Documents/Projects/Experiments/vibes/t3code
git fetch upstream
git checkout -b upstream-sync-33-rpc-rewrite origin/main
```

### Task 0.2: Snapshot fork-only files before merge

**Objective:** Copy all fork-only provider files to a temp directory so we can reference them after merge.

**Files to snapshot** (these will be deleted by the merge):
- `apps/server/src/ampServerManager.ts`
- `apps/server/src/geminiCliServerManager.ts` + test
- `apps/server/src/kiloServerManager.ts` + test
- `apps/server/src/opencodeServerManager.ts` + test
- `apps/server/src/kilo/` (entire directory)
- `apps/server/src/opencode/` (entire directory)
- `apps/server/src/provider/Layers/AmpAdapter.ts` + test
- `apps/server/src/provider/Layers/CopilotAdapter.ts` + test
- `apps/server/src/provider/Layers/CursorAdapter.ts` + test + CursorUsage.ts + test
- `apps/server/src/provider/Layers/GeminiCliAdapter.ts` + test
- `apps/server/src/provider/Layers/KiloAdapter.ts` + test
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts` + test
- `apps/server/src/provider/Layers/ProviderAdapterConformance.test.ts`
- `apps/server/src/provider/Layers/ProviderAdapterUtils.ts`
- `apps/server/src/provider/Layers/copilotCliPath.ts` + test
- `apps/server/src/provider/Layers/copilotTurnTracking.ts` + test
- `apps/server/src/provider/Services/AmpAdapter.ts`
- `apps/server/src/provider/Services/CopilotAdapter.ts`
- `apps/server/src/provider/Services/CursorAdapter.ts` + test
- `apps/server/src/provider/Services/GeminiCliAdapter.ts`
- `apps/server/src/provider/Services/KiloAdapter.ts`
- `apps/server/src/provider/Services/OpenCodeAdapter.ts`
- `apps/server/src/provider/claude-agent-sdk.d.ts`
- `apps/server/src/provider/copilot-sdk.d.ts`
- `apps/server/src/provider/toMessage.ts`
- `apps/server/src/git/Layers/CopilotTextGeneration.ts`
- `apps/server/src/git/Services/CopilotTextGeneration.ts`
- `apps/web/src/components/ProviderLogo.tsx`
- `apps/web/src/components/chat/CursorTraitsPicker.tsx`
- `apps/web/src/lib/threadProvider.ts` + test
- `apps/web/src/lib/threadDraftDefaults.ts` + test
- Fork-modified versions of: `serverLayers.ts`, `wsServer.ts`, `wsServer/pushBus.ts`, `contracts/ws.ts`

```bash
mkdir -p /tmp/t3code-fork-snapshot
# Copy all fork-only provider files
rsync -aR apps/server/src/ampServerManager.ts \
  apps/server/src/geminiCliServerManager.ts \
  apps/server/src/kiloServerManager.ts \
  apps/server/src/opencodeServerManager.ts \
  apps/server/src/kilo/ \
  apps/server/src/opencode/ \
  apps/server/src/provider/Layers/AmpAdapter.ts \
  apps/server/src/provider/Layers/CopilotAdapter.ts \
  apps/server/src/provider/Layers/CursorAdapter.ts \
  apps/server/src/provider/Layers/CursorUsage.ts \
  apps/server/src/provider/Layers/GeminiCliAdapter.ts \
  apps/server/src/provider/Layers/KiloAdapter.ts \
  apps/server/src/provider/Layers/OpenCodeAdapter.ts \
  apps/server/src/provider/Layers/ProviderAdapterUtils.ts \
  apps/server/src/provider/Layers/copilotCliPath.ts \
  apps/server/src/provider/Layers/copilotTurnTracking.ts \
  apps/server/src/provider/Services/ \
  apps/server/src/provider/claude-agent-sdk.d.ts \
  apps/server/src/provider/copilot-sdk.d.ts \
  apps/server/src/provider/toMessage.ts \
  apps/server/src/git/Layers/CopilotTextGeneration.ts \
  apps/server/src/git/Services/CopilotTextGeneration.ts \
  apps/server/src/serverLayers.ts \
  apps/server/src/wsServer.ts \
  apps/server/src/wsServer/ \
  apps/web/src/components/ProviderLogo.tsx \
  apps/web/src/components/chat/CursorTraitsPicker.tsx \
  apps/web/src/lib/threadProvider.ts \
  apps/web/src/lib/threadDraftDefaults.ts \
  packages/contracts/src/ws.ts \
  /tmp/t3code-fork-snapshot/
```

---

## Phase 1: Merge Upstream (Take Theirs for Architecture)

### Task 1.1: Merge upstream/main with conflict resolution strategy

**Objective:** Merge the 33 upstream commits, resolving the 43 conflicts by taking upstream's version for architectural files and manually resolving provider-related ones.

**Strategy by conflict category:**

**A. Modify/delete conflicts (take upstream = delete):**
- `apps/server/src/main.test.ts` → delete (upstream replaced with cli.test.ts)
- `apps/server/src/serverLayers.ts` → delete (upstream replaced with server.ts)
- `apps/server/src/wsServer.test.ts` → delete (upstream replaced with server.test.ts)
- `apps/server/src/wsServer.ts` → delete (upstream replaced with ws.ts)
- `apps/server/src/wsServer/pushBus.ts` → delete (upstream replaced with RPC streams)

**B. Effect.fn migration conflicts (take upstream, note for Phase 2):**
- `apps/server/src/checkpointing/Layers/CheckpointDiffQuery.ts`
- `apps/server/src/persistence/NodeSqliteClient.ts`
- `apps/server/src/persistence/Migrations.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts`
- `apps/server/src/provider/Layers/ClaudeProvider.ts`
- `apps/server/src/provider/Layers/CodexProvider.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

**C. Provider registry conflicts (take upstream, re-add fork providers in Phase 2):**
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts` → take upstream (2 adapters), expand in Phase 2
- `apps/server/src/provider/Layers/ProviderRegistry.ts` → take upstream, extend in Phase 2
- `apps/server/src/provider/Layers/ProviderService.ts` → take upstream

**D. Contracts conflicts (take upstream, extend in Phase 2):**
- `packages/contracts/src/server.ts` → take upstream
- `packages/contracts/src/orchestration.ts` → take upstream
- `packages/contracts/src/editor.ts` → take upstream
- `packages/contracts/src/ws.ts` → accept deletion (replaced by rpc.ts)

**E. Web/UI conflicts (take upstream, re-add fork UI in Phase 3):**
- `apps/web/src/components/ChatView.tsx` + browser test
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ProjectFavicon.tsx`
- `apps/web/src/components/chat/ChangedFilesTree.tsx`
- `apps/web/src/components/chat/ProposedPlanCard.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/lib/gitReactQuery.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/_chat.$threadId.tsx`
- `apps/web/src/routes/_chat.tsx`
- `apps/web/src/store.ts`
- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/wsTransport.ts` + test

**F. Config conflicts:**
- `apps/server/vitest.config.ts` → take upstream
- `apps/server/integration/OrchestrationEngineHarness.integration.ts` → take upstream
- `apps/server/src/git/Layers/GitCore.ts` + test → take upstream
- `apps/server/src/git/Layers/GitManager.ts` → take upstream

### Task 1.2: Verify the merge compiles

```bash
bun install
bun typecheck
```

Expect: Type errors related to missing fork providers (they were removed). This is expected — Phase 2 fixes them.

### Task 1.3: Commit the merge

```bash
git add -A
git commit -m "Merge upstream/main: 33 commits (RPC rewrite, Effect.fn, perf projections)"
```

---

## Phase 2: Re-Add Multi-Provider Server Support

### Task 2.1: Extend contracts with multi-provider types

**Objective:** Re-add ProviderKind variants and provider RPC methods to the new contracts.

**Files:**
- Modify: `packages/contracts/src/server.ts` — add provider kinds back
- Modify: `packages/contracts/src/rpc.ts` — add provider.listModels and provider.getUsage RPCs

**What to add to server.ts:**
- Extend `ProviderKind` from `"codex" | "claudeAgent"` to include: `"copilot" | "cursor" | "geminiCli" | "openCode" | "amp" | "kilo"`
- Re-add `ServerProviderQuotaSnapshot` schema if usage display is needed

**What to add to rpc.ts:**
- `provider.listModels` RPC method (request: providerId, response: model list)
- `provider.getUsage` RPC method (request: providerId, response: quota/usage data)

### Task 2.2: Restore provider adapter Services (Effect service definitions)

**Objective:** Re-add the 6 provider adapter Service definitions.

**Files to restore from snapshot** (adapting imports to new architecture):
- `apps/server/src/provider/Services/AmpAdapter.ts`
- `apps/server/src/provider/Services/CopilotAdapter.ts`
- `apps/server/src/provider/Services/CursorAdapter.ts`
- `apps/server/src/provider/Services/GeminiCliAdapter.ts`
- `apps/server/src/provider/Services/KiloAdapter.ts`
- `apps/server/src/provider/Services/OpenCodeAdapter.ts`

These should follow the same pattern as the existing `Services/ProviderAdapter.ts`. Update imports from deleted modules (wsServer, serverLayers) to new equivalents (ws, server).

### Task 2.3: Restore provider adapter Layers (Effect Layer implementations)

**Objective:** Re-add the 6 provider adapter Layer implementations, migrated to Effect.fn pattern.

**Files to restore from snapshot** (with Effect.fn migration):
- `apps/server/src/provider/Layers/AmpAdapter.ts`
- `apps/server/src/provider/Layers/CopilotAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/Layers/CursorUsage.ts`
- `apps/server/src/provider/Layers/GeminiCliAdapter.ts`
- `apps/server/src/provider/Layers/KiloAdapter.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/ProviderAdapterUtils.ts` (shared utilities)
- `apps/server/src/provider/Layers/copilotCliPath.ts`
- `apps/server/src/provider/Layers/copilotTurnTracking.ts`

**Migration pattern** (apply to all):
```typescript
// OLD:
const doThing = (arg: T) => Effect.gen(function* () { ... })
// NEW:
const doThing = Effect.fn("doThing")(function* (arg: T) { ... })
```

**Import updates needed:**
- Remove imports from deleted: `serverLayers`, `wsServer`, `contracts/ws`
- Add imports from new: `server`, `ws`, `contracts/rpc`, `contracts/server`

### Task 2.4: Restore server managers for non-Codex providers

**Objective:** Re-add process managers that wrap external CLI tools.

**Files to restore from snapshot:**
- `apps/server/src/ampServerManager.ts`
- `apps/server/src/geminiCliServerManager.ts`
- `apps/server/src/kiloServerManager.ts`
- `apps/server/src/opencodeServerManager.ts`
- `apps/server/src/kilo/` (entire directory)
- `apps/server/src/opencode/` (entire directory)

**Import updates:** Same as Task 2.3 — fix imports from deleted modules.

### Task 2.5: Restore type declarations

**Files to restore:**
- `apps/server/src/provider/claude-agent-sdk.d.ts`
- `apps/server/src/provider/copilot-sdk.d.ts`
- `apps/server/src/provider/toMessage.ts`

### Task 2.6: Wire providers into ProviderAdapterRegistry

**Objective:** Register all 6 fork providers in the new ProviderAdapterRegistry.

**File:** `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`

Add imports and registrations for: AmpAdapter, CopilotAdapter, CursorAdapter, GeminiCliAdapter, KiloAdapter, OpenCodeAdapter — following the same pattern as CodexAdapter and ClaudeAdapter.

### Task 2.7: Wire provider layers into server.ts

**Objective:** Ensure all provider adapter layers are composed into the server's Effect Layer.

**File:** `apps/server/src/server.ts` (upstream's new layer composition file)

Add the 6 provider adapter layers to the `ProviderLayerLive` composition chain.

### Task 2.8: Add provider RPC handlers to ws.ts

**Objective:** Implement the provider.listModels and provider.getUsage RPC handlers in the new RPC layer.

**File:** `apps/server/src/ws.ts`

Add handlers for the two RPCs added in Task 2.1, using the same pattern as existing RPC handlers in the WsRpcGroup.

### Task 2.9: Restore CopilotTextGeneration for git operations

**Files to restore:**
- `apps/server/src/git/Layers/CopilotTextGeneration.ts`
- `apps/server/src/git/Services/CopilotTextGeneration.ts`

Wire into `apps/server/src/git/Layers/RoutingTextGeneration.ts`.

### Task 2.10: Restore provider adapter tests

**Files to restore from snapshot:**
- All `*.test.ts` files for the 6 provider adapters
- `ProviderAdapterConformance.test.ts`
- Server manager tests

Update test imports and patterns to match upstream's current test infrastructure.

### Task 2.11: Verify server compiles and tests pass

```bash
bun typecheck
bun run test -- --filter apps/server
```

---

## Phase 3: Re-Add Multi-Provider Web/UI Support

### Task 3.1: Restore ProviderLogo component

**File:** `apps/web/src/components/ProviderLogo.tsx`

Restore from snapshot. Update imports — may need to use new contracts/server ProviderKind enum.

### Task 3.2: Restore CursorTraitsPicker

**File:** `apps/web/src/components/chat/CursorTraitsPicker.tsx`

Restore from snapshot. Verify it integrates with the new ChatView layout.

### Task 3.3: Restore threadProvider and threadDraftDefaults

**Files:**
- `apps/web/src/lib/threadProvider.ts` + test
- `apps/web/src/lib/threadDraftDefaults.ts` + test

These handle provider inference and default settings per provider. Restore and update to use new RPC client instead of old wsTransport methods.

### Task 3.4: Update wsNativeApi for multi-provider RPCs

**File:** `apps/web/src/wsNativeApi.ts`

Add client-side wrappers for provider.listModels and provider.getUsage using the new rpc/ transport layer.

### Task 3.5: Update settings UI for multi-provider

**File:** `apps/web/src/components/settings/SettingsPanels.tsx`

Ensure provider-specific settings panels exist for all 8 providers.

### Task 3.6: Verify web compiles and browser tests pass

```bash
bun typecheck
bun run test -- --filter apps/web
```

---

## Phase 4: Final Verification

### Task 4.1: Full lint/format/typecheck pass

```bash
bun fmt
bun lint
bun typecheck
```

### Task 4.2: Full test suite

```bash
bun run test
```

### Task 4.3: Create PR on fork

```bash
git push origin upstream-sync-33-rpc-rewrite
gh pr create --repo aaditagrawal/t3code \
  --title "Merge upstream: 33 commits (RPC rewrite, Effect.fn, perf projections)" \
  --body "Integrates 33 upstream commits while preserving multi-provider support.

## Upstream changes integrated:
- Effect RPC layer replacing hand-rolled WebSocket protocol
- Server entrypoint restructure (bin.ts/cli.ts/server.ts)
- Effect.fn migration across all service layers
- Performance: projection queries, engine bootstrap
- Git/PR: scoped toasts, granular progress, remote parsing fixes
- UI: virtualization stability, copy-to-clipboard, input overflow fix

## Fork preservation:
- All 6 extra provider adapters re-wired to new architecture
- Provider contracts extended (listModels, getUsage RPCs)
- Multi-provider UI components restored
- Provider adapters migrated to Effect.fn pattern"
```

---

## Conflict Tally

| Category | Files | Strategy |
|----------|-------|----------|
| Modify/delete (server restructure) | 5 | Accept deletion |
| Effect.fn migration | 10 | Take upstream |
| Provider registry | 3 | Take upstream, extend Phase 2 |
| Contracts/schemas | 4 | Take upstream, extend Phase 2 |
| Web/UI | 14 | Take upstream, re-add Phase 3 |
| Config/infra | 7 | Take upstream |
| **Total** | **43** | |

## Risk Assessment

- **HIGH:** The RPC transport rewrite (Phase 2.8) — provider.listModels/getUsage need new RPC handlers that didn't exist before. Must understand Effect's unstable RPC pattern.
- **MEDIUM:** Provider adapter imports may reference deleted modules beyond what we've identified. Watch for deep dependency chains.
- **LOW:** Effect.fn migration is mechanical but touches many files. Copy-paste errors possible.
