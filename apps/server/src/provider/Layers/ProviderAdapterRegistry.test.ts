import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";
import type { ProviderKind } from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";

import { ProviderUnsupportedError } from "../Errors.ts";
import { ClaudeAdapter, type ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import { CopilotAdapter, type CopilotAdapterShape } from "../Services/CopilotAdapter.ts";
import { CodexAdapter, type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import { CursorAdapter, type CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { GeminiCliAdapter, type GeminiCliAdapterShape } from "../Services/GeminiCliAdapter.ts";
import { OpenCodeAdapter, type OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { AmpAdapter, type AmpAdapterShape } from "../Services/AmpAdapter.ts";
import { KiloAdapter, type KiloAdapterShape } from "../Services/KiloAdapter.ts";
import { getProviderCapabilities } from "../Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: getProviderCapabilities("codex"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: "claudeAgent",
  capabilities: getProviderCapabilities("claudeAgent"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCopilotAdapter: CopilotAdapterShape = {
  provider: "copilot",
  capabilities: getProviderCapabilities("copilot"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: "cursor",
  capabilities: getProviderCapabilities("cursor"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: "opencode",
  capabilities: getProviderCapabilities("opencode"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeGeminiCliAdapter: GeminiCliAdapterShape = {
  provider: "geminiCli",
  capabilities: getProviderCapabilities("geminiCli"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeAmpAdapter: AmpAdapterShape = {
  provider: "amp",
  capabilities: getProviderCapabilities("amp"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeKiloAdapter: KiloAdapterShape = {
  provider: "kilo",
  capabilities: getProviderCapabilities("kilo"),
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const layer = it.layer(
  ProviderAdapterRegistryLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(CopilotAdapter, fakeCopilotAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(GeminiCliAdapter, fakeGeminiCliAdapter),
        Layer.succeed(AmpAdapter, fakeAmpAdapter),
        Layer.succeed(KiloAdapter, fakeKiloAdapter),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves registered provider adapters", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider("codex");
      const copilot = yield* registry.getByProvider("copilot");
      const claude = yield* registry.getByProvider("claudeAgent");
      const cursor = yield* registry.getByProvider("cursor");
      const opencode = yield* registry.getByProvider("opencode");
      const geminiCli = yield* registry.getByProvider("geminiCli");
      const amp = yield* registry.getByProvider("amp");
      const kilo = yield* registry.getByProvider("kilo");

      assert.equal(codex, fakeCodexAdapter);
      assert.equal(copilot, fakeCopilotAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(cursor, fakeCursorAdapter);
      assert.equal(opencode, fakeOpenCodeAdapter);
      assert.equal(geminiCli, fakeGeminiCliAdapter);
      assert.equal(amp, fakeAmpAdapter);
      assert.equal(kilo, fakeKiloAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, [
        "codex",
        "copilot",
        "claudeAgent",
        "cursor",
        "opencode",
        "geminiCli",
        "amp",
        "kilo",
      ]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});
