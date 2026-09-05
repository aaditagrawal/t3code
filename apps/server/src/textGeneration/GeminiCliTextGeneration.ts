/**
 * GeminiCliTextGeneration — text-generation service factory for the Gemini CLI
 * provider.
 *
 * Earlier revisions invoked `gemini -p <prompt> --approval-mode yolo` inside
 * the user's repository to coerce structured JSON output. That gave a
 * commit/PR/branch/title generation request the same trust posture as a
 * full agentic session — capable of executing arbitrary tool calls in the
 * workspace without user approval. The Gemini CLI does not expose a
 * non-interactive mode that disables tool execution outright (the only
 * non-interactive approval mode is `yolo`), so the safe option is to not
 * run it at all from text-generation paths.
 *
 * This factory keeps Gemini CLI a valid `ProviderInstance` member by
 * returning a graceful "not supported" failure on every operation. Callers
 * (`SessionTextGeneration` etc.) already fall back to other providers when
 * one fails, so picking Gemini for chat/sessions still works — only the
 * automated text-generation helpers redirect users to a different provider.
 *
 * @module GeminiCliTextGeneration
 */
import * as Effect from "effect/Effect";

import { type GenericProviderSettings, TextGenerationError } from "@t3tools/contracts";

import { type TextGeneration } from "./TextGeneration.ts";

type TextGenerationService = TextGeneration["Service"];

const UNSUPPORTED_DETAIL =
  "Gemini CLI is not supported for headless text generation (the only non-interactive Gemini mode auto-approves tool calls in the workspace). Pick a different provider for commit / PR / branch / thread title generation.";

export const makeGeminiCliTextGeneration = Effect.fn("makeGeminiCliTextGeneration")((
  _config: GenericProviderSettings,
  _environment: NodeJS.ProcessEnv = process.env,
) => {
  const fail = <
    Op extends
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle",
  >(
    operation: Op,
  ) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: UNSUPPORTED_DETAIL,
      }),
    );

  const generateCommitMessage: TextGenerationService["generateCommitMessage"] = () =>
    fail("generateCommitMessage");
  const generatePrContent: TextGenerationService["generatePrContent"] = () =>
    fail("generatePrContent");
  const generateBranchName: TextGenerationService["generateBranchName"] = () =>
    fail("generateBranchName");
  const generateThreadTitle: TextGenerationService["generateThreadTitle"] = () =>
    fail("generateThreadTitle");

  return Effect.succeed({
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationService);
});
