import type { ProviderDriverKind } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export interface StandardAcpCliRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
  readonly resolveAuthMethodId?: (
    initializeResult: EffectAcpSchema.InitializeResponse,
  ) => string | undefined;
}

export const makeStandardAcpCliRuntime = (
  input: StandardAcpCliRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: {
          command: input.command,
          args: input.args ?? [],
          cwd: input.cwd,
          ...(input.environment ? { env: input.environment } : {}),
        },
        authMethodId: input.resolveAuthMethodId,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export function parseStandardAcpCliArguments(value: string | undefined): ReadonlyArray<string> {
  return (value ?? "")
    .split(/\r?\n/u)
    .map((argument) => argument.trim())
    .filter(Boolean);
}

export function firstAdvertisedAuthMethod(
  initializeResult: EffectAcpSchema.InitializeResponse,
  excludedIds: ReadonlySet<string> = new Set(),
): string | undefined {
  return initializeResult.authMethods?.find((method) => !excludedIds.has(method.id))?.id;
}

export function normalizeStandardAcpModel(
  model: string | null | undefined,
  provider: ProviderDriverKind,
): string {
  const trimmed = model?.trim();
  if (!trimmed) return "";
  return normalizeModelSlug(trimmed, provider) ?? trimmed;
}

export function currentStandardAcpModelFromSetup(
  setup:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return setup.models?.currentModelId?.trim() || undefined;
}

export function currentStandardAcpConfigOptionModelFromSetup(
  setup:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const modelOption = setup.configOptions?.find(
    (option) => option.category === "model" || option.id.trim() === "model",
  );
  return modelOption?.type === "select" ? modelOption.currentValue.trim() || undefined : undefined;
}

export function applyStandardAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  if (input.requestedModelId === undefined || input.requestedModelId === input.currentModelId) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

export function applyStandardAcpConfigOptionModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  if (input.requestedModelId === undefined || input.requestedModelId === input.currentModelId) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}
