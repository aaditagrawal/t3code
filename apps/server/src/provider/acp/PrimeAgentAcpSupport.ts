/**
 * PrimeAgentAcpSupport — per-provider ACP glue for the Prime Intellect
 * `prime-agent` CLI (https://github.com/PrimeIntellect-ai/prime-agent).
 *
 * Prime Agent speaks ACP over stdio via `prime-agent --mode acp`. Three
 * behaviours differ from the other ACP drivers and are encoded here:
 *
 *  1. **No `authenticate`.** Prime Agent advertises no auth methods and
 *     answers `authenticate` with JSON-RPC `-32601 Method not found`
 *     (verified against v0.7.0). Credentials come from env vars / `auth.json`
 *     resolved before spawn, so `authMethodId` is `undefined` and
 *     `AcpSessionRuntime` skips the round-trip.
 *  2. **cwd is fixed at process start.** Prime Agent's ACP mode does not
 *     honour a per-session `cwd`; a mismatched client cwd is only echoed back
 *     in `_meta`. We therefore pass the working directory both as the child
 *     process cwd and as an explicit `--cwd` argument.
 *  3. **No in-session model switching.** ACP mode exposes no model list or
 *     `session/set_model`, so the model is pinned at spawn time via
 *     `--model`. Drivers using this support must declare
 *     `sessionModelSwitch: "unsupported"`.
 *
 * @module provider/acp/PrimeAgentAcpSupport
 */
import { type GenericProviderSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const PRIME_AGENT_DRIVER_KIND = ProviderDriverKind.make("primeAgent");
const PRIME_AGENT_DEFAULT_BINARY = "prime-agent";

/**
 * Prime Agent resolves credentials itself (env var, `~/.prime/agent/auth.json`,
 * or an OAuth subscription) and implements no `authenticate` method.
 */
const PRIME_AGENT_AUTH_METHOD_ID = undefined;

type PrimeAgentAcpRuntimeSettings = Pick<GenericProviderSettings, "binaryPath"> & {
  readonly configDir?: string;
};

interface PrimeAgentAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly primeAgentSettings: PrimeAgentAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  /** Model slug pinned for the lifetime of this process, if any. */
  readonly model?: string | undefined;
}

export function buildPrimeAgentAcpSpawnInput(
  primeAgentSettings: PrimeAgentAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  model?: string | undefined,
): AcpSessionRuntime.AcpSpawnInput {
  const trimmedModel = model?.trim();
  const configDir = primeAgentSettings?.configDir?.trim();
  return {
    command: primeAgentSettings?.binaryPath?.trim() || PRIME_AGENT_DEFAULT_BINARY,
    // `--cwd` is required in addition to the child process cwd: Prime Agent
    // pins the working directory at process start and ignores per-session cwd.
    args: [
      "--mode",
      "acp",
      "--cwd",
      cwd,
      ...(trimmedModel ? (["--model", trimmedModel] as const) : []),
    ],
    cwd,
    ...(configDir
      ? { env: { ...(environment ?? process.env), PRIME_AGENT_CODING_AGENT_DIR: configDir } }
      : environment
        ? { env: environment }
        : {}),
  };
}

export const makePrimeAgentAcpRuntime = (
  input: PrimeAgentAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildPrimeAgentAcpSpawnInput(
          input.primeAgentSettings,
          input.cwd,
          input.environment,
          input.model,
        ),
        authMethodId: PRIME_AGENT_AUTH_METHOD_ID,
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

/**
 * Normalizes a requested model slug for Prime Agent. Prime Agent accepts both
 * bare ids (`claude-sonnet-4-20250514`) and `provider/id` forms, optionally
 * with a `:<thinking>` suffix — all of which we pass through untouched beyond
 * the shared slug normalization.
 */
export function resolvePrimeAgentAcpModelId(model: string | null | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  return normalizeModelSlug(trimmed, PRIME_AGENT_DRIVER_KIND) ?? trimmed;
}
