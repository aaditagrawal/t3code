import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { CodexAppServerManager } from "../../codexAppServerManager.ts";
import { AmpServerManager } from "../../ampServerManager.ts";
import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import { ServerConfig } from "../../config.ts";
import { makeAmpAdapterLive } from "./AmpAdapter.ts";
import { makeClaudeAdapterLive } from "./ClaudeAdapter.ts";
import { makeCodexAdapterLive } from "./CodexAdapter.ts";
import { makeCopilotAdapterLive } from "./CopilotAdapter.ts";
import { makeCursorAdapterLive } from "./CursorAdapter.ts";
import { makeGeminiCliAdapterLive } from "./GeminiCliAdapter.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  getProviderCapabilities,
  validateProviderAdapterConformance,
} from "../Services/ProviderAdapter.ts";
import { AmpAdapter } from "../Services/AmpAdapter.ts";
import { ClaudeAdapter } from "../Services/ClaudeAdapter.ts";
import { CodexAdapter } from "../Services/CodexAdapter.ts";
import { CopilotAdapter } from "../Services/CopilotAdapter.ts";
import { CursorAdapter } from "../Services/CursorAdapter.ts";
import { GeminiCliAdapter } from "../Services/GeminiCliAdapter.ts";

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used in conformance tests")),
  getBinding: () => Effect.succeed(Option.none()),
  remove: () => Effect.void,
  listThreadIds: () => Effect.succeed([]),
});

const codexLayer = makeCodexAdapterLive({ manager: new CodexAppServerManager() }).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(providerSessionDirectoryTestLayer),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

const copilotLayer = makeCopilotAdapterLive({
  clientFactory: () =>
    ({
      start: async () => undefined,
      listModels: async () => [],
      createSession: async () => {
        throw new Error("createSession should not be called in conformance tests");
      },
      resumeSession: async () => {
        throw new Error("resumeSession should not be called in conformance tests");
      },
      stop: async () => [],
    }) as never,
}).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

const claudeLayer = makeClaudeAdapterLive({
  createQuery: () =>
    ({
      [Symbol.asyncIterator]: async function* () {
        yield* [] as never[];
      },
      interrupt: async () => undefined,
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      setMaxThinkingTokens: async () => undefined,
      close: () => undefined,
    }) as never,
}).pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

const cursorLayer = makeCursorAdapterLive({
  createProcess: () => ({}) as never,
}).pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(NodeServices.layer),
);

const geminiLayer = makeGeminiCliAdapterLive({
  manager: new GeminiCliServerManager(),
}).pipe(Layer.provideMerge(ServerSettingsService.layerTest()));

const ampLayer = makeAmpAdapterLive({
  manager: new AmpServerManager(),
}).pipe(Layer.provideMerge(ServerSettingsService.layerTest()));

describe("provider adapter conformance", () => {
  const cases = [
    {
      provider: "codex" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* CodexAdapter;
          }).pipe(Effect.provide(codexLayer)),
        ),
    },
    {
      provider: "copilot" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* CopilotAdapter;
          }).pipe(Effect.provide(copilotLayer)),
        ),
    },
    {
      provider: "claudeAgent" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* ClaudeAdapter;
          }).pipe(Effect.provide(claudeLayer)),
        ),
    },
    {
      provider: "cursor" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* CursorAdapter;
          }).pipe(Effect.provide(cursorLayer)),
        ),
    },
    {
      provider: "geminiCli" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* GeminiCliAdapter;
          }).pipe(Effect.provide(geminiLayer)),
        ),
    },
    {
      provider: "amp" as const,
      load: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            return yield* AmpAdapter;
          }).pipe(Effect.provide(ampLayer)),
        ),
    },
  ];

  it.each(cases)("declares the shared harness matrix for $provider", async ({ provider, load }) => {
    const adapter = await load();

    expect(validateProviderAdapterConformance(adapter)).toEqual([]);
    expect(adapter.provider).toBe(provider);
    expect(adapter.capabilities).toEqual(getProviderCapabilities(provider));
  });
});
