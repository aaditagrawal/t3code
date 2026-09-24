/**
 * PrimeAgentTextGeneration — Graceful "not supported" text-generation shape
 * for Prime Agent.
 *
 * Prime Agent exposes exactly one model-facing tool (`ipython`) and has no
 * structured-output mode that maps cleanly onto our `TextGenerationShape`
 * contract (commit messages, PR titles, branch names, thread titles). Rather
 * than block the driver from registering, this factory fails every operation
 * with a clear `TextGenerationError`; users pick a different instance for
 * text-generation features while the Prime Agent instance stays usable for
 * chat-style sessions.
 *
 * A future revision could back these with a one-shot `prime-agent --print`
 * invocation, but that spends a full agent turn per title and is deliberately
 * out of scope for the initial driver.
 *
 * @module PrimeAgentTextGeneration
 */
import * as Effect from "effect/Effect";

import type { GenericProviderSettings } from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";

import { type TextGeneration } from "./TextGeneration.ts";
type TextGenerationShape = TextGeneration["Service"];

const NOT_SUPPORTED_DETAIL =
  "Prime Agent does not expose a structured text-generation API. Use a different provider instance for commit/PR/branch/title generation.";

const fail = (
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle",
) => Effect.fail(new TextGenerationError({ operation, detail: NOT_SUPPORTED_DETAIL }));

export const makePrimeAgentTextGeneration = (
  _primeAgentSettings: GenericProviderSettings,
  _environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<TextGenerationShape> =>
  Effect.sync(() => {
    const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = () =>
      fail("generateCommitMessage");

    const generatePrContent: TextGenerationShape["generatePrContent"] = () =>
      fail("generatePrContent");

    const generateBranchName: TextGenerationShape["generateBranchName"] = () =>
      fail("generateBranchName");

    const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = () =>
      fail("generateThreadTitle");

    return {
      generateCommitMessage,
      generatePrContent,
      generateBranchName,
      generateThreadTitle,
    } satisfies TextGenerationShape;
  });
