/**
 * KiloTextGeneration — Text generation layer using a per-instance Kilo
 * server for branch/commit/PR/thread-title generation.
 *
 * Kilo's API mirrors OpenCode's, so this driver delegates to a private
 * `KiloServerManager` (no shared state with the adapter's manager) and
 * runs `session.prompt`-style requests via the SDK client. Unlike the
 * OpenCode text-generation driver, Kilo does not yet expose a long-lived
 * shared server pool: each request currently creates a transient session
 * on the manager-owned server and the server is released when the
 * factory's scope finalizer fires (registry shutdown).
 *
 * @module KiloTextGeneration
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TextGenerationError, type ChatAttachment, type ModelSelection } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";

import { KiloServerManager } from "../kiloServerManager.ts";
import { parseKiloModel, readJsonData } from "../kilo/utils.ts";
import { createClient } from "../kilo/serverLifecycle.ts";
import type { KiloProviderOptions, SharedServerState } from "../kilo/types.ts";
import { type TextGeneration } from "./TextGeneration.ts";

type TextGenerationService = TextGeneration["Service"];
import {
  BranchNameOutput,
  CommitMessageOutput,
  CommitMessageWithBranchOutput,
  PrContentOutput,
  ThreadTitleOutput,
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
import type { KiloSettings } from "../provider/Layers/KiloProvider.ts";

const decodeCommitMessageWithBranchOutput = Schema.decodeEffect(
  Schema.fromJsonString(CommitMessageWithBranchOutput),
);
const decodeCommitMessageOutput = Schema.decodeEffect(Schema.fromJsonString(CommitMessageOutput));
const decodePrContentOutput = Schema.decodeEffect(Schema.fromJsonString(PrContentOutput));
const decodeBranchNameOutput = Schema.decodeEffect(Schema.fromJsonString(BranchNameOutput));
const decodeThreadTitleOutput = Schema.decodeEffect(Schema.fromJsonString(ThreadTitleOutput));

type TextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

function getKiloPromptErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const message =
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
      ? error.data.message.trim()
      : "";
  if (message.length > 0) {
    return message;
  }
  if ("name" in error && typeof error.name === "string") {
    const name = error.name.trim();
    return name.length > 0 ? name : null;
  }
  return null;
}

function getKiloTextResponse(parts: ReadonlyArray<unknown> | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      if (!("type" in part) || part.type !== "text") {
        return [];
      }
      if (!("text" in part) || typeof part.text !== "string") {
        return [];
      }
      return [part.text];
    })
    .join("")
    .trim();
}

export const makeKiloTextGeneration = Effect.fn("makeKiloTextGeneration")(function* (
  kiloSettings: KiloSettings,
  _environment: NodeJS.ProcessEnv = process.env,
) {
  // Per-instance manager: one server process bound to this text-generation
  // factory's scope. The manager owns the spawned child via its internal
  // `ensureServer`/`getOrStartServer`, so `stopAll()` actually kills it on
  // scope close. Concurrent generation calls share the same pending start
  // because `getOrStartServer` is internally serialized.
  const manager = new KiloServerManager();

  yield* Effect.acquireRelease(
    Effect.sync(() => manager),
    (m) => Effect.sync(() => m.stopAll()),
  );

  const resolveBinaryPath = (): string => kiloSettings.binaryPath.trim() || "kilo";

  const ensureKiloServer = (): Promise<SharedServerState> =>
    manager.getOrStartServer({ binaryPath: resolveBinaryPath() } as KiloProviderOptions);

  const runKiloJson = Effect.fn("runKiloJson")(function* <A>(input: {
    readonly operation: TextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly decodeOutput: (raw: string) => Effect.Effect<A, Schema.SchemaError>;
    readonly modelSelection: ModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) {
    const parsed = parseKiloModel(input.modelSelection.model);
    if (!parsed) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "Kilo model selection must use the 'provider/model' format.",
      });
    }

    const rawText = yield* Effect.tryPromise({
      try: async () => {
        const shared = await ensureKiloServer();
        const client = await createClient({
          baseUrl: shared.baseUrl,
          directory: input.cwd,
          responseStyle: "data",
          throwOnError: true,
          ...(shared.authHeader ? { headers: { Authorization: shared.authHeader } } : {}),
        });

        const created = (await readJsonData(
          client.session.create({ title: `T3 Code ${input.operation}` }),
        )) as { readonly id?: string } | { readonly data?: { readonly id?: string } };
        const sessionId =
          ("id" in created && typeof created.id === "string" && created.id) ||
          ("data" in created &&
            created.data &&
            typeof created.data.id === "string" &&
            created.data.id) ||
          "";
        if (!sessionId) {
          throw new Error("Kilo session.create returned no session id.");
        }

        const result = (await readJsonData(
          client.session.promptAsync({
            sessionID: sessionId,
            model: { providerID: parsed.providerId, modelID: parsed.modelId },
            ...(parsed.variant ? { variant: parsed.variant } : {}),
            parts: [{ type: "text", text: input.prompt }],
          }),
        )) as
          | {
              readonly data?: {
                readonly info?: { readonly error?: unknown };
                readonly parts?: ReadonlyArray<unknown>;
              };
              readonly info?: { readonly error?: unknown };
              readonly parts?: ReadonlyArray<unknown>;
            }
          | undefined;

        const data = result && "data" in result && result.data ? result.data : result;
        const errorMessage = getKiloPromptErrorMessage(data?.info?.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }
        const text = getKiloTextResponse(data?.parts);
        if (text.length === 0) {
          throw new Error("Kilo returned empty output.");
        }
        return text;
      },
      catch: (cause) =>
        new TextGenerationError({
          operation: input.operation,
          detail: cause instanceof Error ? cause.message : "Kilo text generation failed.",
          cause,
        }),
    });

    return yield* input.decodeOutput(extractJsonObject(rawText)).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation: input.operation,
            detail: "Kilo returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  const generateCommitMessage: TextGenerationService["generateCommitMessage"] = Effect.fn(
    "KiloTextGeneration.generateCommitMessage",
  )(function* (input) {
    const { prompt } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runKiloJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      decodeOutput:
        input.includeBranch === true
          ? decodeCommitMessageWithBranchOutput
          : decodeCommitMessageOutput,
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

  const generatePrContent: TextGenerationService["generatePrContent"] = Effect.fn(
    "KiloTextGeneration.generatePrContent",
  )(function* (input) {
    const { prompt } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runKiloJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      decodeOutput: decodePrContentOutput,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationService["generateBranchName"] = Effect.fn(
    "KiloTextGeneration.generateBranchName",
  )(function* (input) {
    const { prompt } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runKiloJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      decodeOutput: decodeBranchNameOutput,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationService["generateThreadTitle"] = Effect.fn(
    "KiloTextGeneration.generateThreadTitle",
  )(function* (input) {
    const { prompt } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runKiloJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      decodeOutput: decodeThreadTitleOutput,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationService;
});
