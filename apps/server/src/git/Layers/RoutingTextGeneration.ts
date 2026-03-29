/**
 * RoutingTextGeneration – Dispatches text generation requests to the
 * appropriate CLI implementation based on the provider in each request input.
 *
 * Currently supported providers:
 *  - `"claudeAgent"` → Claude CLI layer
 *  - `"codex"`       → Codex CLI layer (also the default fallback)
 *
 * Providers without a dedicated CLI text-generation layer (copilot, cursor,
 * opencode, geminiCli, amp, kilo) fall back to Codex.  When a dedicated
 * layer is added for one of those providers, add a route here.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, ServiceMap } from "effect";

import type { ProviderKind } from "@t3tools/contracts";
import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Supported git text-generation providers.  Providers not in this set fall
// back to codex (the most broadly compatible CLI implementation).
// ---------------------------------------------------------------------------

const GIT_TEXT_GEN_PROVIDERS = new Set<ProviderKind>(["codex", "claudeAgent"]);

class CodexTextGen extends ServiceMap.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends ServiceMap.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: ProviderKind): TextGenerationShape => {
    if (!provider || !GIT_TEXT_GEN_PROVIDERS.has(provider)) return codex;
    if (provider === "claudeAgent") return claude;
    return codex;
  };

  return {
    generateCommitMessage: (input) =>
      route(input.modelSelection.provider).generateCommitMessage(input),
    generatePrContent: (input) => route(input.modelSelection.provider).generatePrContent(input),
    generateBranchName: (input) => route(input.modelSelection.provider).generateBranchName(input),
    generateThreadTitle: (input) => route(input.modelSelection.provider).generateThreadTitle(input),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));
