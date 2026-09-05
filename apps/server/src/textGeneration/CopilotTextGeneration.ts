/**
 * CopilotTextGeneration — text-generation service factory for the GitHub
 * Copilot provider.
 *
 * The Copilot SDK does not expose a straightforward "one-shot prompt with
 * structured JSON output" command analogous to `claude -p --output-format
 * json` or `codex exec`. Spinning up a full session per text-generation
 * call (commit messages, PR titles, etc.) would be both expensive and a
 * poor product experience because every invocation would run agentic tool
 * approvals, slash-command discovery, etc.
 *
 * Until/unless the SDK ships a dedicated structured-prompt entrypoint,
 * this factory exposes a text-generation service that fails gracefully on
 * every operation with a stable, user-actionable error message. Callers
 * (`SessionTextGeneration` etc.) already fall back to other providers
 * when one fails, so this keeps Copilot a valid `ProviderInstance` member
 * without claiming a capability it cannot honour.
 *
 * @module CopilotTextGeneration
 */
import * as Effect from "effect/Effect";

import { TextGenerationError } from "@t3tools/contracts";

import { type TextGeneration } from "./TextGeneration.ts";

type TextGenerationService = TextGeneration["Service"];
import type { CopilotSettings } from "../provider/Drivers/CopilotSettings.ts";

const UNSUPPORTED_DETAIL =
  "GitHub Copilot does not support headless text generation. Pick a different provider for commit / PR / branch / thread title generation.";

export const makeCopilotTextGeneration = Effect.fn("makeCopilotTextGeneration")((
  _copilotSettings: CopilotSettings,
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
