import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ProviderKind,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

import type { AppSettings } from "./appSettings";
import type { ProviderCustomModelSettings } from "./customModels";
import { getCustomModelsByProvider, resolveAppModelSelection } from "./customModels";

const PROVIDER_KINDS = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
] as const satisfies readonly ProviderKind[];

export function getGitTextGenerationModelOverride(
  settings: Pick<AppSettings, "gitTextGenerationModelByProvider">,
  provider: ProviderKind,
): string | null {
  return normalizeModelSlug(settings.gitTextGenerationModelByProvider[provider], provider);
}

export function patchGitTextGenerationModelOverrides(
  overrides: AppSettings["gitTextGenerationModelByProvider"],
  provider: ProviderKind,
  model: string | null | undefined,
): Pick<AppSettings, "gitTextGenerationModelByProvider"> {
  const normalized = normalizeModelSlug(model, provider);
  const nextOverrides = { ...overrides };
  if (normalized) {
    nextOverrides[provider] = normalized;
  } else {
    delete nextOverrides[provider];
  }
  return { gitTextGenerationModelByProvider: nextOverrides };
}

export function resolveGitTextGenerationModelSelection(
  provider: ProviderKind,
  settings: Pick<
    AppSettings,
    keyof ProviderCustomModelSettings | "gitTextGenerationModelByProvider"
  >,
  activeModel: string | null | undefined,
): string {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  const overrideModel = getGitTextGenerationModelOverride(settings, provider);
  if (overrideModel) {
    return resolveAppModelSelection(provider, customModelsByProvider, overrideModel);
  }
  const normalizedActiveModel = normalizeModelSlug(activeModel, provider);
  if (normalizedActiveModel) {
    return resolveAppModelSelection(provider, customModelsByProvider, normalizedActiveModel);
  }
  return resolveAppModelSelection(
    provider,
    customModelsByProvider,
    DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider],
  );
}

export function normalizeGitTextGenerationModelByProvider(
  overrides: Record<string, string>,
): Record<string, string> {
  const normalizedOverrides: Partial<Record<ProviderKind, string>> = {};
  for (const provider of PROVIDER_KINDS) {
    const normalized = normalizeModelSlug(overrides[provider], provider);
    if (!normalized) {
      continue;
    }
    normalizedOverrides[provider] = normalized;
  }
  return normalizedOverrides;
}
