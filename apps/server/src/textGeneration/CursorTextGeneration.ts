import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { type CursorSettings, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import {
  cursorSdkApiKey,
  toCursorSdkModelSelection,
} from "../provider/cursor/CursorSdkMappings.ts";
import {
  liveCursorSdkClient,
  type CursorSdkClient,
  type CursorSdkRunResult,
} from "../provider/cursor/CursorSdkClient.ts";
import { type ThreadTitleGenerationResult, type TextGenerationShape } from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const CURSOR_TIMEOUT_MS = 180_000;

export interface CursorTextGenerationOptions {
  readonly sdkClient?: CursorSdkClient;
}

function cursorTextGenerationError(
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle",
  detail: string,
  cause?: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const isTextGenerationError = Schema.is(TextGenerationError);

function resultText(
  result: CursorSdkRunResult,
  operation:
    | "generateCommitMessage"
    | "generatePrContent"
    | "generateBranchName"
    | "generateThreadTitle",
): Effect.Effect<string, TextGenerationError> {
  const raw = result.result?.trim() ?? "";
  if (raw.length === 0) {
    return Effect.fail(
      cursorTextGenerationError(
        operation,
        result.status === "cancelled"
          ? "Cursor SDK request was cancelled."
          : "Cursor SDK returned empty output.",
      ),
    );
  }
  if (result.status === "error") {
    return Effect.fail(cursorTextGenerationError(operation, raw));
  }
  return Effect.succeed(raw);
}

/**
 * Build a Cursor text-generation closure bound to a specific `CursorSettings`
 * payload. See `makeCodexAdapter` for the overall per-instance rationale.
 */
export const makeCursorTextGeneration = Effect.fn("makeCursorTextGeneration")(function* (
  cursorSettings: CursorSettings,
  environment: NodeJS.ProcessEnv = process.env,
  options?: CursorTextGenerationOptions,
) {
  yield* Effect.void;
  const sdkClient = options?.sdkClient ?? liveCursorSdkClient;

  const runCursorJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      if (!cursorSettings.enabled) {
        return yield* cursorTextGenerationError(operation, "Cursor provider is disabled.");
      }
      const apiKey = cursorSdkApiKey(environment);
      if (!apiKey) {
        return yield* cursorTextGenerationError(
          operation,
          "CURSOR_API_KEY is required for Cursor SDK text generation.",
        );
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          sdkClient.prompt(prompt, {
            apiKey,
            model: toCursorSdkModelSelection(modelSelection.model, modelSelection.options),
            local: {
              cwd,
              settingSources: ["all"],
            },
          }),
        catch: (cause) =>
          cursorTextGenerationError(operation, "Cursor SDK text generation failed.", cause),
      }).pipe(
        Effect.timeoutOption(CURSOR_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(cursorTextGenerationError(operation, "Cursor SDK request timed out.")),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : cursorTextGenerationError(operation, "Cursor SDK text generation failed.", cause),
        ),
      );

      const rawResult = yield* resultText(result, operation);
      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(rawResult)).pipe(
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            cursorTextGenerationError(
              operation,
              "Cursor SDK returned invalid structured output.",
              cause,
            ),
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : cursorTextGenerationError(operation, "Cursor SDK text generation failed.", cause),
      ),
    );

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "CursorTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
      policy: input.policy,
    });

    const generated = yield* runCursorJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "CursorTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
      policy: input.policy,
      changeRequestTemplate: input.changeRequestTemplate,
    });

    const generated = yield* runCursorJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "CursorTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });

    const generated = yield* runCursorJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "CursorTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      previousTitle: input.previousTitle,
      attachments: input.attachments,
    });

    const generated = yield* runCursorJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    } satisfies ThreadTitleGenerationResult;
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});
