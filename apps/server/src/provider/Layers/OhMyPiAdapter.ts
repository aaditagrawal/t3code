import {
  type ModelSelection,
  type OhMyPiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  collectSessionConfigOptionValues,
  findSessionConfigOption,
} from "../acp/AcpRuntimeModel.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  applyStandardAcpConfigOptionModelSelection,
  currentStandardAcpConfigOptionModelFromSetup,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("ohMyPi");

export const OH_MY_PI_AUTH_METHOD_ID = "agent";
export const OH_MY_PI_THINKING_CONFIG_ID = "thinking";
export const OH_MY_PI_MODE_CONFIG_ID = "mode";
export const OH_MY_PI_PLAN_MODE_ID = "plan";
export const OH_MY_PI_DEFAULT_MODE_ID = "default";
export const OH_MY_PI_THINKING_OFF = "off";
export const OH_MY_PI_THINKING_AUTO = "auto";

const OH_MY_PI_THINKING_ALIASES: Readonly<Record<string, string>> = {
  none: OH_MY_PI_THINKING_OFF,
  off: OH_MY_PI_THINKING_OFF,
  false: OH_MY_PI_THINKING_OFF,
  inherit: OH_MY_PI_THINKING_OFF,
  auto: OH_MY_PI_THINKING_AUTO,
  on: OH_MY_PI_THINKING_AUTO,
  true: OH_MY_PI_THINKING_AUTO,
  min: "minimal",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  med: "medium",
  high: "high",
  xhigh: "xhigh",
  "extra-high": "xhigh",
  extra_high: "xhigh",
  xhi: "xhigh",
  max: "max",
};

type OhMyPiSessionSetup =
  | EffectAcpSchema.LoadSessionResponse
  | EffectAcpSchema.NewSessionResponse
  | EffectAcpSchema.ResumeSessionResponse;

type OhMyPiAcpRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "getConfigOptions" | "setConfigOption" | "setMode" | "setModel"
>;

export function ohMyPiLaunchCommand(settings: OhMyPiSettings): {
  readonly command: string;
  readonly args: readonly ["acp"];
} {
  return { command: settings.binaryPath || "omp", args: ["acp"] };
}

export function resolveOhMyPiAuthMethodId(
  initializeResult: EffectAcpSchema.InitializeResponse,
): string {
  const methods = initializeResult.authMethods ?? [];
  const byId = methods.find((method) => method.id.trim() === OH_MY_PI_AUTH_METHOD_ID);
  if (byId) return byId.id;
  const byName = methods.find(
    (method) => method.name.trim().toLowerCase() === OH_MY_PI_AUTH_METHOD_ID,
  );
  if (byName) return byName.id;
  return OH_MY_PI_AUTH_METHOD_ID;
}

export function normalizeOhMyPiThinkingValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  return OH_MY_PI_THINKING_ALIASES[trimmed];
}

export function resolveOhMyPiThinkingValue(
  selection: ModelSelection | undefined,
): string | undefined {
  const thinkingString = normalizeOhMyPiThinkingValue(
    getModelSelectionStringOptionValue(selection, OH_MY_PI_THINKING_CONFIG_ID),
  );
  if (thinkingString) return thinkingString;

  const reasoningEffort = normalizeOhMyPiThinkingValue(
    getModelSelectionStringOptionValue(selection, "reasoningEffort") ??
      getModelSelectionStringOptionValue(selection, "reasoning"),
  );
  if (reasoningEffort) return reasoningEffort;

  const thinkingEnabled = getModelSelectionBooleanOptionValue(
    selection,
    OH_MY_PI_THINKING_CONFIG_ID,
  );
  if (thinkingEnabled === false) return OH_MY_PI_THINKING_OFF;
  if (thinkingEnabled === true) return OH_MY_PI_THINKING_AUTO;
  return undefined;
}

export function resolveOhMyPiPlanMode(mode: string | undefined): string | undefined {
  if (mode === OH_MY_PI_PLAN_MODE_ID) return OH_MY_PI_PLAN_MODE_ID;
  if (mode === OH_MY_PI_DEFAULT_MODE_ID) return OH_MY_PI_DEFAULT_MODE_ID;
  return undefined;
}

function currentSelectConfigOptionValue(
  setup: OhMyPiSessionSetup,
  configId: string,
): string | undefined {
  const option = findSessionConfigOption(setup.configOptions, configId);
  if (!option || option.type !== "select") return undefined;
  return option.currentValue.trim() || undefined;
}

export function currentOhMyPiOptionsFromSetup(
  setup: OhMyPiSessionSetup,
): Readonly<Record<string, string | undefined>> {
  return {
    thinking: currentSelectConfigOptionValue(setup, OH_MY_PI_THINKING_CONFIG_ID),
    mode:
      currentSelectConfigOptionValue(setup, OH_MY_PI_MODE_CONFIG_ID) ??
      setup.modes?.currentModeId.trim() ??
      undefined,
  };
}

export function requestedOhMyPiOptionsFromSelection(
  selection: ModelSelection | undefined,
): Readonly<Record<string, string | undefined>> {
  return {
    thinking: resolveOhMyPiThinkingValue(selection),
  };
}

const applyAdvertisedSelectConfigOption = <E>(input: {
  readonly runtime: Pick<OhMyPiAcpRuntime, "setConfigOption">;
  readonly configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly configId: string;
  readonly requested: string | undefined;
  readonly current: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<void, E> => {
  if (input.requested === undefined || input.requested === input.current) {
    return Effect.void;
  }
  const option = findSessionConfigOption(input.configOptions, input.configId);
  // Oh My Pi rejects boolean ACP config options; only string selects are mapped.
  if (!option || option.type !== "select") {
    return Effect.void;
  }
  const allowed = collectSessionConfigOptionValues(option);
  if (!allowed.includes(input.requested)) {
    return Effect.void;
  }
  return input.runtime
    .setConfigOption(input.configId, input.requested)
    .pipe(Effect.mapError(input.mapError), Effect.asVoid);
};

export const applyOhMyPiAcpSelection = Effect.fn("applyOhMyPiAcpSelection")(function* <E>(input: {
  readonly runtime: OhMyPiAcpRuntime;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly currentModelOptions: Readonly<Record<string, string | undefined>>;
  readonly requestedModelOptions: Readonly<Record<string, string | undefined>>;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.fn.Return<string | undefined, E> {
  const boundModelId = yield* applyStandardAcpConfigOptionModelSelection(input);
  const configOptions = yield* input.runtime.getConfigOptions;
  yield* applyAdvertisedSelectConfigOption({
    runtime: input.runtime,
    configOptions,
    configId: OH_MY_PI_THINKING_CONFIG_ID,
    requested: input.requestedModelOptions.thinking,
    current: input.currentModelOptions.thinking,
    mapError: input.mapError,
  });

  const requestedMode = resolveOhMyPiPlanMode(input.requestedModelOptions.mode);
  if (requestedMode !== undefined && requestedMode !== input.currentModelOptions.mode) {
    const modeOption = findSessionConfigOption(configOptions, OH_MY_PI_MODE_CONFIG_ID);
    const allowed =
      modeOption?.type === "select" ? collectSessionConfigOptionValues(modeOption) : [];
    if (allowed.includes(requestedMode)) {
      yield* input.runtime.setMode(requestedMode).pipe(Effect.mapError(input.mapError));
    }
  }

  return boundModelId;
});

export function makeOhMyPiAdapter(
  settings: OhMyPiSettings,
  options?: StandardAcpAdapterLiveOptions,
) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("ohMyPi"),
      label: "Oh My Pi",
      makeRuntime: (input) => {
        const launch = ohMyPiLaunchCommand(settings);
        return makeStandardAcpCliRuntime({
          ...input,
          ...launch,
          ...(options?.environment ? { environment: options.environment } : {}),
          resolveAuthMethodId: resolveOhMyPiAuthMethodId,
        });
      },
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: currentStandardAcpConfigOptionModelFromSetup,
      currentModelOptionsFromSetup: currentOhMyPiOptionsFromSetup,
      requestedModelOptionsFromSelection: requestedOhMyPiOptionsFromSelection,
      applyModelSelection: applyOhMyPiAcpSelection,
      modelSelectionMethod: "session/set_config_option",
      formElicitation: true,
    },
    options,
  );
}
