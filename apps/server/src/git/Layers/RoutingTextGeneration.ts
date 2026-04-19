/**
 * RoutingTextGeneration – Dispatches text generation requests to the
 * appropriate CLI implementation based on the provider in each request input.
 *
 * Currently supported providers with dedicated layers:
 *  - `"claudeAgent"` → Claude CLI layer
 *  - `"copilot"`     → Copilot text-generation layer (partial – falls back to
 *                       codex for branch names / thread titles)
 *  - `"codex"`       → Codex CLI layer (also the default fallback)
 *  - `"cursor"`      → Cursor text-generation layer (ACP-based)
 *  - `"opencode"`    → OpenCode text-generation layer (SDK-based)
 *
 * Providers without a dedicated CLI text-generation layer (geminiCli, amp,
 * kilo) fall back to Codex.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";

import type { ProviderKind } from "@t3tools/contracts";
import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import {
  CopilotTextGeneration,
  type CopilotTextGenerationShape,
} from "../Services/CopilotTextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { makeCopilotTextGenerationLive } from "./CopilotTextGeneration.ts";
import { CursorTextGenerationLive } from "./CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "./OpenCodeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Supported git text-generation providers.  Providers not in this set fall
// back to codex (the most broadly compatible CLI implementation).
// ---------------------------------------------------------------------------

const GIT_TEXT_GEN_PROVIDERS = new Set<ProviderKind>([
  "codex",
  "claudeAgent",
  "copilot",
  "cursor",
  "opencode",
]);

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

class CopilotTextGen extends Context.Service<CopilotTextGen, CopilotTextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CopilotTextGen",
) {}

class CursorTextGen extends Context.Service<CursorTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CursorTextGen",
) {}

class OpenCodeTextGen extends Context.Service<OpenCodeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/OpenCodeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;
  const copilot = yield* CopilotTextGen;
  const cursor = yield* CursorTextGen;
  const openCode = yield* OpenCodeTextGen;

  const route = (provider?: ProviderKind): TextGenerationShape => {
    if (!provider || !GIT_TEXT_GEN_PROVIDERS.has(provider)) return codex;
    if (provider === "claudeAgent") return claude;
    if (provider === "cursor") return cursor;
    if (provider === "opencode") return openCode;
    if (provider === "copilot") {
      return {
        generateCommitMessage: copilot.generateCommitMessage,
        generatePrContent: copilot.generatePrContent,
        // Copilot text generation doesn't support these yet; fall back to codex.
        generateBranchName: codex.generateBranchName,
        generateThreadTitle: codex.generateThreadTitle,
      };
    }
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

const InternalCopilotLayer = Layer.effect(
  CopilotTextGen,
  Effect.gen(function* () {
    const svc = yield* CopilotTextGeneration;
    return svc;
  }),
).pipe(Layer.provide(makeCopilotTextGenerationLive()));

const InternalCursorLayer = Layer.effect(
  CursorTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CursorTextGenerationLive));

const InternalOpenCodeLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalCopilotLayer),
  Layer.provide(InternalCursorLayer),
  Layer.provide(InternalOpenCodeLayer),
);
