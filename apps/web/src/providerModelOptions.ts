import { type ProviderKind } from "@t3tools/contracts";
import { resolveCursorPickerModelSlug } from "@t3tools/shared/model";

import { getAppModelOptions } from "./customModels";
import { getCursorModelFamilyOptions } from "@t3tools/shared/model";

export type ModelOptionEntry = {
  slug: string;
  name: string;
  pricingTier?: string;
  isCustom?: boolean;
  connected?: boolean;
};

export function buildModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customCopilotModels: readonly string[];
  customClaudeModels: readonly string[];
  customCursorModels: readonly string[];
  customOpencodeModels: readonly string[];
  customGeminiCliModels: readonly string[];
  customAmpModels: readonly string[];
  customKiloModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<ModelOptionEntry>> {
  const cursorFamilyOptions = getCursorModelFamilyOptions();
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
    copilot: getAppModelOptions("copilot", settings.customCopilotModels),
    claudeAgent: getAppModelOptions("claudeAgent", settings.customClaudeModels),
    cursor: [
      ...cursorFamilyOptions,
      ...getAppModelOptions("cursor", settings.customCursorModels).filter(
        (option) =>
          option.isCustom && !cursorFamilyOptions.some((family) => family.slug === option.slug),
      ),
    ],
    opencode: getAppModelOptions("opencode", settings.customOpencodeModels),
    geminiCli: getAppModelOptions("geminiCli", settings.customGeminiCliModels),
    amp: getAppModelOptions("amp", settings.customAmpModels),
    kilo: getAppModelOptions("kilo", settings.customKiloModels),
  };
}

export function mergeDiscoveredModels(
  base: Record<ProviderKind, ReadonlyArray<ModelOptionEntry>>,
  discovered: Partial<Record<ProviderKind, ReadonlyArray<ModelOptionEntry> | undefined>>,
): Record<ProviderKind, ReadonlyArray<ModelOptionEntry>> {
  const result = { ...base };
  for (const [provider, models] of Object.entries(discovered) as Array<
    [ProviderKind, ReadonlyArray<ModelOptionEntry> | undefined]
  >) {
    if (!models || models.length === 0) continue;
    const normalizedModels =
      provider === "cursor"
        ? models.filter((model) => resolveCursorPickerModelSlug(model.slug) === model.slug)
        : models;
    const dedupedModels = Array.from(new Map(normalizedModels.map((m) => [m.slug, m])).values());
    const existing = new Set(base[provider]?.map((m) => m.slug));
    if (provider === "copilot") {
      const baseTiers = new Map((base[provider] ?? []).map((m) => [m.slug, m.pricingTier]));
      const enriched = dedupedModels.map((m) => {
        if (m.pricingTier) return m;
        const tier = baseTiers.get(m.slug);
        return tier ? { ...m, pricingTier: tier } : m;
      });
      const customOnly = (base[provider] ?? []).filter(
        (m) => m.isCustom && !dedupedModels.some((d) => d.slug === m.slug),
      );
      result[provider] = [...enriched, ...customOnly];
      continue;
    }
    const discoveredBySlug = new Map(dedupedModels.map((m) => [m.slug, m]));
    const merged = (base[provider] ?? []).map((m) => {
      const discoveredModel = discoveredBySlug.get(m.slug);
      return discoveredModel ? Object.assign({}, m, discoveredModel) : m;
    });
    const additions = dedupedModels.filter((m) => !existing.has(m.slug));
    result[provider] = [...additions, ...merged];
  }
  return result;
}

export function resolveModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customCopilotModels: readonly string[];
  customClaudeModels: readonly string[];
  customCursorModels: readonly string[];
  customOpencodeModels: readonly string[];
  customGeminiCliModels: readonly string[];
  customAmpModels: readonly string[];
  customKiloModels: readonly string[];
  discovered?: Partial<Record<ProviderKind, ReadonlyArray<ModelOptionEntry> | undefined>>;
}): Record<ProviderKind, ReadonlyArray<ModelOptionEntry>> {
  return mergeDiscoveredModels(buildModelOptionsByProvider(settings), settings.discovered ?? {});
}
