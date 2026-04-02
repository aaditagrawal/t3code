# Conflict Analysis: upstream/main → origin/main (43 conflicts)

## Summary

43 conflicting files from `git merge-tree` of upstream/main into origin/main.
Conflicts fall into 5 categories based on root cause.

---

## CATEGORY 1: Effect.fn Migration + Fork Multi-Provider Logic (14 files)
**Root cause**: Upstream migrated from `Effect.gen(function*() {...})` to `Effect.fn("name")(function*(...) {...})` syntax. Fork simultaneously added multi-provider support (copilot, cursor, geminiCli, amp, opencode, kilo adapters).

### Files:
1. `apps/server/src/provider/Layers/ClaudeProvider.ts` — upstream: Effect.fn + spawnAndCollect refactor; fork: multi-provider wiring
2. `apps/server/src/provider/Layers/CodexProvider.ts` — same pattern as ClaudeProvider
3. `apps/server/src/provider/Layers/CodexAdapter.ts` — upstream: new error types, ProviderSendTurnInput; fork: additional adapter capabilities
4. `apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — upstream: test updates for Effect.fn; fork: test additions
5. `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts` — upstream: removes multi-provider imports (only claude+codex); fork: added all 8 providers
6. `apps/server/src/provider/Layers/ProviderRegistry.ts` — **HEAVY** upstream: 537→90 lines, stripped to 2 providers; fork: had all 8 provider snapshots
7. `apps/server/src/provider/Layers/ProviderService.ts` — upstream: Effect.fn rewrite of makeProviderService; fork: multi-provider session mgmt
8. `apps/server/src/checkpointing/Layers/CheckpointDiffQuery.ts` — upstream: Effect.fn migration; fork: minor changes
9. `apps/server/src/git/Layers/GitCore.ts` — upstream: Effect.fn throughout; fork: modifications
10. `apps/server/src/git/Layers/GitCore.test.ts` — upstream: test updates; fork: test additions
11. `apps/server/src/git/Layers/GitManager.ts` — upstream: Effect.fn; fork: modifications
12. `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — upstream: ProjectionSnapshotQuery + Effect.forkScoped changes; fork: multi-provider
13. `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` — upstream: refactoring; fork: multi-provider dispatch
14. `apps/server/src/orchestration/Layers/CheckpointReactor.test.ts` — upstream: test updates; fork: test additions

**Resolution Strategy**: TAKE UPSTREAM + RE-ADD FORK CHANGES
- Start from upstream's Effect.fn syntax (it's the future API direction)
- Re-apply fork's multi-provider adapter registrations on top
- For ProviderRegistry.ts and ProviderAdapterRegistry.ts: take upstream structure, add back the 6 extra providers
- For ProviderService.ts: take upstream Effect.fn version, merge back fork's session management for extra providers

---

## CATEGORY 2: Module Restructuring — wsServer/serverLayers deleted (7 files)
**Root cause**: Upstream deleted `wsServer.ts` (1165 lines), replaced with `ws.ts` (RPC-based). Deleted `serverLayers.ts`, replaced with inline layer composition. Deleted `packages/contracts/src/ws.ts`, replaced with `packages/contracts/src/rpc.ts`. Fork had modified all these files.

### Files (all modify/delete conflicts):
1. `apps/server/src/wsServer.ts` — **DELETED upstream**, fork modified (multi-provider WS handlers)
2. `apps/server/src/wsServer.test.ts` — **DELETED upstream**, fork modified
3. `apps/server/src/wsServer/pushBus.ts` — **DELETED upstream**, fork modified
4. `apps/server/src/serverLayers.ts` — **DELETED upstream**, fork added multi-provider layer wiring
5. `apps/server/src/main.test.ts` — **DELETED upstream**, fork modified
6. `packages/contracts/src/ws.ts` — **DELETED upstream** (replaced by rpc.ts), fork modified
7. `apps/server/vitest.config.ts` — content conflict (upstream restructured test config)

**Resolution Strategy**: TAKE UPSTREAM + PORT FORK CHANGES TO NEW ARCHITECTURE
- Accept upstream's ws.ts (RPC-based) and rpc.ts contract
- The fork's wsServer.ts modifications (multi-provider WS handlers, usage queries for amp/gemini) need to be re-implemented as RPC handlers in the new ws.ts
- serverLayers.ts fork additions (extra adapter layers) need to be wired into upstream's new layer composition
- pushBus.ts is superseded by upstream's RPC streaming model
- This is the hardest category — requires understanding upstream's new RPC architecture

---

## CATEGORY 3: Contracts/Schema Changes (3 files)
**Root cause**: Upstream simplified ProviderKind to only `codex | claudeAgent` (2 providers). Fork expanded it to 8 providers. Upstream also restructured server schemas, removed quota snapshots.

### Files:
1. `packages/contracts/src/orchestration.ts` — upstream: ProviderKind = 2 literals, removed ORCHESTRATION_WS_CHANNELS, removed 6 ModelSelection types; fork: 8 providers
2. `packages/contracts/src/server.ts` — upstream: removed ServerProviderQuotaSnapshot, added RPC types (ServerConfigUpdatedPayload etc); fork: kept quota snapshots, expanded providers
3. `packages/contracts/src/editor.ts` — upstream: windsurf→trae, removed positron/sublime/webstorm/intellij/fleet/ghostty, added OpenError class; fork: had added extra editors

**Resolution Strategy**: NEEDS MANUAL RECONCILIATION
- orchestration.ts: Must expand ProviderKind back to 8 providers while keeping upstream's other simplifications (RPC methods, etc.)
- server.ts: Take upstream's new RPC types, but re-add ServerProviderQuotaSnapshot if fork uses it, and keep fork's expanded provider support
- editor.ts: Take upstream's structural changes (OpenError class), but keep fork's extra editor IDs (positron, sublime, webstorm, etc.)

---

## CATEGORY 4: UI Component Conflicts (13 files)
**Root cause**: Upstream did significant UI refactoring (sidebar normalization, virtualized messages timeline, copy-to-clipboard for plans, provider model picker updates). Fork added multi-provider UI (settings panels for 8 providers, provider model picker, usage display).

### Files:
1. `apps/web/src/components/ChatView.tsx` — upstream: removed multi-provider type imports (CursorReasoningOption etc); fork: added them
2. `apps/web/src/components/ChatView.browser.tsx` — upstream: UI refactoring; fork: multi-provider features
3. `apps/web/src/components/Sidebar.tsx` — upstream: heavy refactor (extracted sub-components, pointer events, keyboard nav); fork: minor changes
4. `apps/web/src/components/ProjectFavicon.tsx` — upstream: changes; fork: changes
5. `apps/web/src/components/chat/ChangedFilesTree.tsx` — upstream: changes; fork: changes
6. `apps/web/src/components/chat/ProposedPlanCard.tsx` — upstream: added copy-to-clipboard; fork: changes
7. `apps/web/src/components/settings/SettingsPanels.tsx` — upstream: refactored settings; fork: added 6 extra provider settings panels
8. `apps/web/src/lib/gitReactQuery.ts` — upstream: changes; fork: changes
9. `apps/web/src/lib/utils.ts` — upstream: changes; fork: changes
10. `apps/web/src/routes/__root.tsx` — upstream: routing changes; fork: routing changes
11. `apps/web/src/routes/_chat.$threadId.tsx` — upstream: changes; fork: changes
12. `apps/web/src/routes/_chat.tsx` — upstream: changes; fork: changes
13. `apps/web/src/store.ts` — upstream: added sidebarThreadsById, threadIdsByProjectId, session-logic helpers, 2-provider normalizeModelSelection; fork: kept 8-provider model selection

**Resolution Strategy**: TAKE UPSTREAM + RE-ADD FORK CHANGES
- For most UI files: take upstream's refactored version (better UX: virtualized timelines, sidebar extraction, copy-to-clipboard)
- Re-add fork's multi-provider UI elements (settings panels, provider picker options)
- store.ts: take upstream's performance optimizations (normalized sidebar state), expand normalizeModelSelection back to 8 providers

---

## CATEGORY 5: Transport/Client-side WS Rewrite (6 files)
**Root cause**: Upstream rewrote the WebSocket transport layer to use Effect RPC protocol. Fork had modified the old WS transport for multi-provider support.

### Files:
1. `apps/web/src/wsTransport.ts` — upstream: complete rewrite (313→131 lines) using Effect RPC client; fork: multi-provider WS requests
2. `apps/web/src/wsTransport.test.ts` — upstream: new tests for RPC transport; fork: old transport tests
3. `apps/web/src/wsNativeApi.ts` — upstream: updated for RPC; fork: multi-provider native API
4. `apps/server/src/persistence/Migrations.ts` — upstream: renumbered migrations 17-19, added ProjectionSnapshotLookupIndexes; fork: added NormalizeLegacyClaudeCodeProvider migration
5. `apps/server/src/persistence/NodeSqliteClient.ts` — upstream: refactored error handling, node compat check; fork: minor changes
6. `apps/server/integration/OrchestrationEngineHarness.integration.ts` — upstream: test harness changes; fork: multi-provider harness

**Resolution Strategy**: TAKE UPSTREAM + RE-ADD FORK CHANGES
- wsTransport.ts: take upstream's RPC-based transport, add fork's multi-provider request types
- Migrations.ts: take upstream's numbering, add fork's NormalizeLegacyClaudeCodeProvider as migration 20
- NodeSqliteClient.ts: take upstream (mostly style/refactoring changes)

---

## Resolution Priority Order

1. **Contracts first** (Category 3) — everything depends on these types
   - Expand ProviderKind back to 8 providers in orchestration.ts
   - Merge server.ts schemas
   - Merge editor.ts editor list

2. **Server architecture** (Category 2) — the structural foundation
   - Accept upstream's ws.ts + rpc.ts architecture
   - Port fork's multi-provider WS handlers to RPC handlers

3. **Effect.fn service layers** (Category 1) — core business logic
   - Take upstream's Effect.fn syntax, re-add multi-provider logic

4. **Client transport** (Category 5) — connects to server
   - Take upstream's RPC transport, extend for multi-provider

5. **UI components** (Category 4) — presentation layer
   - Take upstream's UI improvements, re-add multi-provider UI

## Estimated Effort

- Category 1 (Effect.fn + providers): ~4-6 hours — mostly mechanical re-application
- Category 2 (module restructuring): ~8-12 hours — requires understanding new RPC architecture
- Category 3 (contracts): ~2-3 hours — careful type alignment
- Category 4 (UI): ~3-4 hours — mostly additive
- Category 5 (transport): ~3-4 hours — follow RPC pattern

**Total estimated: 20-29 hours of focused work**
