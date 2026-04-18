import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderKind,
  type ProviderModelOptions,
  type ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { createModelSelection, resolveSelectableModel } from "@t3tools/shared/model";

import { getComposerProviderState } from "./components/chat/composerProviderRegistry";
import { getAppModelOptions, MAX_CUSTOM_MODEL_LENGTH } from "./customModels";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";

export { MAX_CUSTOM_MODEL_LENGTH };

export function getCustomModelOptionsByProvider(
  settings: UnifiedSettings,
  _providers?: ReadonlyArray<ServerProvider>,
  selectedProvider?: ProviderKind | null,
  selectedModel?: string | null,
) {
  return {
    codex: getAppModelOptions(
      "codex",
      settings.providers.codex.customModels,
      selectedProvider === "codex" ? selectedModel : undefined,
    ),
    copilot: getAppModelOptions(
      "copilot",
      settings.providers.copilot.customModels,
      selectedProvider === "copilot" ? selectedModel : undefined,
    ),
    claudeAgent: getAppModelOptions(
      "claudeAgent",
      settings.providers.claudeAgent.customModels,
      selectedProvider === "claudeAgent" ? selectedModel : undefined,
    ),
    cursor: getAppModelOptions(
      "cursor",
      settings.providers.cursor.customModels,
      selectedProvider === "cursor" ? selectedModel : undefined,
    ),
    opencode: getAppModelOptions(
      "opencode",
      settings.providers.opencode.customModels,
      selectedProvider === "opencode" ? selectedModel : undefined,
    ),
    geminiCli: getAppModelOptions(
      "geminiCli",
      settings.providers.geminiCli.customModels,
      selectedProvider === "geminiCli" ? selectedModel : undefined,
    ),
    amp: getAppModelOptions(
      "amp",
      settings.providers.amp.customModels,
      selectedProvider === "amp" ? selectedModel : undefined,
    ),
    kilo: getAppModelOptions(
      "kilo",
      settings.providers.kilo.customModels,
      selectedProvider === "kilo" ? selectedModel : undefined,
    ),
  } as const;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  settings: UnifiedSettings,
  _providers: ReadonlyArray<ServerProvider>,
  model: string | null | undefined,
): string {
  const modelOptions = getCustomModelOptionsByProvider(settings, _providers, provider, model);
  return (
    resolveSelectableModel(provider, model, modelOptions[provider]) ??
    getDefaultServerModel(_providers, provider)
  );
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    provider: "codex" as const,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
  };
  const provider = resolveSelectableProvider(providers, selection.provider);
  const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

  const model =
    resolveSelectableModel(
      provider,
      provider === selection.provider ? selection.model : null,
      modelOptionsByProvider[provider],
    ) ?? getDefaultServerModel(providers, provider);

  const providerModelOptions: Partial<ProviderModelOptions> = {
    [provider]: provider === selection.provider ? selection.options : undefined,
  };
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: providerModelOptions,
  });

  return createModelSelection(provider, model, modelOptionsForDispatch);
}
