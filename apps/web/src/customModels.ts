import type { ProviderKind } from "@t3tools/contracts";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";

import type { AppSettings } from "./appSettings";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

export type CustomModelSettingsKey =
  | "customCodexModels"
  | "customCopilotModels"
  | "customClaudeModels"
  | "customCursorModels"
  | "customOpencodeModels"
  | "customGeminiCliModels"
  | "customAmpModels"
  | "customKiloModels";

export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  settingsKey: CustomModelSettingsKey;
  defaultSettingsKey: CustomModelSettingsKey;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  copilot: new Set(getModelOptions("copilot").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
  cursor: new Set(getModelOptions("cursor").map((option) => option.slug)),
  opencode: new Set(getModelOptions("opencode").map((option) => option.slug)),
  geminiCli: new Set(getModelOptions("geminiCli").map((option) => option.slug)),
  amp: new Set(getModelOptions("amp").map((option) => option.slug)),
  kilo: new Set(getModelOptions("kilo").map((option) => option.slug)),
};

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    settingsKey: "customCodexModels",
    defaultSettingsKey: "customCodexModels",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  copilot: {
    provider: "copilot",
    settingsKey: "customCopilotModels",
    defaultSettingsKey: "customCopilotModels",
    title: "Copilot",
    description: "Save additional Copilot model slugs for the picker and `/model` command.",
    placeholder: "your-copilot-model-slug",
    example: "gpt-4o-copilot",
  },
  claudeAgent: {
    provider: "claudeAgent",
    settingsKey: "customClaudeModels",
    defaultSettingsKey: "customClaudeModels",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
  cursor: {
    provider: "cursor",
    settingsKey: "customCursorModels",
    defaultSettingsKey: "customCursorModels",
    title: "Cursor",
    description: "Save additional Cursor model slugs for the picker and `/model` command.",
    placeholder: "your-cursor-model-slug",
    example: "cursor-fast",
  },
  opencode: {
    provider: "opencode",
    settingsKey: "customOpencodeModels",
    defaultSettingsKey: "customOpencodeModels",
    title: "OpenCode",
    description: "Save additional OpenCode model slugs for the picker and `/model` command.",
    placeholder: "your-opencode-model-slug",
    example: "opencode-pro",
  },
  geminiCli: {
    provider: "geminiCli",
    settingsKey: "customGeminiCliModels",
    defaultSettingsKey: "customGeminiCliModels",
    title: "Gemini CLI",
    description: "Save additional Gemini CLI model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-2.0-ultra",
  },
  amp: {
    provider: "amp",
    settingsKey: "customAmpModels",
    defaultSettingsKey: "customAmpModels",
    title: "Amp",
    description: "Save additional Amp model slugs for the picker and `/model` command.",
    placeholder: "your-amp-model-slug",
    example: "amp-pro",
  },
  kilo: {
    provider: "kilo",
    settingsKey: "customKiloModels",
    defaultSettingsKey: "customKiloModels",
    title: "Kilo",
    description: "Save additional Kilo model slugs for the picker and `/model` command.",
    placeholder: "your-kilo-model-slug",
    example: "kilo-advanced",
  },
};

export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export type ProviderCustomModelSettings = Pick<
  AppSettings,
  | "customCodexModels"
  | "customCopilotModels"
  | "customClaudeModels"
  | "customCursorModels"
  | "customOpencodeModels"
  | "customGeminiCliModels"
  | "customAmpModels"
  | "customKiloModels"
>;

export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getCustomModelsForProvider(
  settings: ProviderCustomModelSettings,
  provider: ProviderKind,
): readonly string[] {
  switch (provider) {
    case "copilot":
      return settings.customCopilotModels;
    case "claudeAgent":
      return settings.customClaudeModels;
    case "cursor":
      return settings.customCursorModels;
    case "opencode":
      return settings.customOpencodeModels;
    case "geminiCli":
      return settings.customGeminiCliModels;
    case "amp":
      return settings.customAmpModels;
    case "kilo":
      return settings.customKiloModels;
    case "codex":
    default:
      return settings.customCodexModels;
  }
}

export function patchCustomModels(provider: ProviderKind, models: string[]): Partial<AppSettings> {
  switch (provider) {
    case "copilot":
      return { customCopilotModels: models };
    case "claudeAgent":
      return { customClaudeModels: models };
    case "cursor":
      return { customCursorModels: models };
    case "opencode":
      return { customOpencodeModels: models };
    case "geminiCli":
      return { customGeminiCliModels: models };
    case "amp":
      return { customAmpModels: models };
    case "kilo":
      return { customKiloModels: models };
    case "codex":
    default:
      return { customCodexModels: models };
  }
}

export function getDefaultCustomModelsForProvider(
  defaults: Pick<AppSettings, CustomModelSettingsKey>,
  provider: ProviderKind,
): readonly string[] {
  return defaults[PROVIDER_CUSTOM_MODEL_CONFIG[provider].defaultSettingsKey];
}

export function getCustomModelsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, readonly string[]> {
  return {
    codex: getCustomModelsForProvider(settings, "codex"),
    copilot: getCustomModelsForProvider(settings, "copilot"),
    claudeAgent: getCustomModelsForProvider(settings, "claudeAgent"),
    cursor: getCustomModelsForProvider(settings, "cursor"),
    opencode: getCustomModelsForProvider(settings, "opencode"),
    geminiCli: getCustomModelsForProvider(settings, "geminiCli"),
    amp: getCustomModelsForProvider(settings, "amp"),
    kilo: getCustomModelsForProvider(settings, "kilo"),
  };
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
): string {
  const customModelsForProvider = customModels[provider];
  const options = getAppModelOptions(provider, customModelsForProvider, selectedModel);
  return resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider);
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, CustomModelSettingsKey>,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions("codex", customModelsByProvider.codex),
    copilot: getAppModelOptions("copilot", customModelsByProvider.copilot),
    claudeAgent: getAppModelOptions("claudeAgent", customModelsByProvider.claudeAgent),
    cursor: getAppModelOptions("cursor", customModelsByProvider.cursor),
    opencode: getAppModelOptions("opencode", customModelsByProvider.opencode),
    geminiCli: getAppModelOptions("geminiCli", customModelsByProvider.geminiCli),
    amp: getAppModelOptions("amp", customModelsByProvider.amp),
    kilo: getAppModelOptions("kilo", customModelsByProvider.kilo),
  };
}

export function getSlashModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  query: string,
  selectedModel?: string | null,
): AppModelOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const options = getAppModelOptions(provider, customModels, selectedModel);
  if (!normalizedQuery) {
    return options;
  }

  return options.filter((option) => {
    const searchSlug = option.slug.toLowerCase();
    const searchName = option.name.toLowerCase();
    return searchSlug.includes(normalizedQuery) || searchName.includes(normalizedQuery);
  });
}
