import { useCallback, useMemo } from "react";
import { Option, Schema } from "effect";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ProviderKind,
  type ProviderStartOptions,
} from "@t3tools/contracts";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { DEFAULT_ACCENT_COLOR, isValidAccentColor, normalizeAccentColor } from "./accentColor";
import { useLocalStorage } from "./hooks/useLocalStorage";

const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const APP_PROVIDER_LOGO_APPEARANCE_OPTIONS = [
  {
    value: "original",
    label: "Default color",
    description: "Use each provider's native logo colors.",
  },
  {
    value: "grayscale",
    label: "Grayscale",
    description: "Desaturate provider logos while keeping their original shapes.",
  },
  {
    value: "accent",
    label: "Accent color",
    description: "Tint every provider logo with your global or per-provider accent color.",
  },
] as const;
export type AppProviderLogoAppearance =
  (typeof APP_PROVIDER_LOGO_APPEARANCE_OPTIONS)[number]["value"];
const AppProviderLogoAppearanceSchema = Schema.Literals(["original", "grayscale", "accent"]);
export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";
export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";
type CustomModelSettingsKey =
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

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

export const AppSettingsSchema = Schema.Struct({
  claudeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  copilotCliPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  copilotConfigDir: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    withDefaults(() => "local" as const),
  ),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),
  diffWordWrap: Schema.Boolean.pipe(withDefaults(() => false)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => false)),
  showCommandOutput: Schema.Boolean.pipe(withDefaults(() => true)),
  showFileChangeDiffs: Schema.Boolean.pipe(withDefaults(() => true)),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    withDefaults(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: Schema.Literals(["locale", "12-hour", "24-hour"]).pipe(
    withDefaults(() => DEFAULT_TIMESTAMP_FORMAT),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customCopilotModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customClaudeModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customCursorModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customOpencodeModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customGeminiCliModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customAmpModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  customKiloModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
  gitTextGenerationModelByProvider: Schema.Record(Schema.String, Schema.String).pipe(
    withDefaults(() => ({}) as Record<string, string>),
  ),
  providerLogoAppearance: AppProviderLogoAppearanceSchema.pipe(
    withDefaults(() => "original" as const),
  ),
  grayscaleProviderLogos: Schema.Boolean.pipe(withDefaults(() => false)),
  accentColor: Schema.String.check(Schema.isMaxLength(16)).pipe(
    withDefaults(() => DEFAULT_ACCENT_COLOR),
  ),
  providerAccentColors: Schema.Record(Schema.String, Schema.String).pipe(
    withDefaults(() => ({}) as Record<string, string>),
  ),
  customAccentPresets: Schema.Array(
    Schema.Struct({
      label: Schema.String.check(Schema.isMaxLength(64)),
      value: Schema.String.check(Schema.isMaxLength(16)),
    }),
  ).pipe(withDefaults(() => [] as ReadonlyArray<{ label: string; value: string }>)),
  backgroundColorOverride: Schema.String.check(Schema.isMaxLength(16)).pipe(withDefaults(() => "")),
  foregroundColorOverride: Schema.String.check(Schema.isMaxLength(16)).pipe(withDefaults(() => "")),
  uiFont: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  codeFont: Schema.String.check(Schema.isMaxLength(256)).pipe(withDefaults(() => "")),
  uiFontSize: Schema.Number.pipe(withDefaults(() => 0)),
  codeFontSize: Schema.Number.pipe(withDefaults(() => 0)),
  contrast: Schema.Number.pipe(withDefaults(() => 0)),
  translucency: Schema.Boolean.pipe(withDefaults(() => false)),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}
type ProviderCustomModelSettings = Pick<
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

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});
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

function normalizeGitTextGenerationModelByProvider(
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

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customCopilotModels: normalizeCustomModelSlugs(settings.customCopilotModels, "copilot"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeAgent"),
    customCursorModels: normalizeCustomModelSlugs(settings.customCursorModels, "cursor"),
    customOpencodeModels: normalizeCustomModelSlugs(settings.customOpencodeModels, "opencode"),
    customGeminiCliModels: normalizeCustomModelSlugs(settings.customGeminiCliModels, "geminiCli"),
    customAmpModels: normalizeCustomModelSlugs(settings.customAmpModels, "amp"),
    customKiloModels: normalizeCustomModelSlugs(settings.customKiloModels, "kilo"),
    gitTextGenerationModelByProvider: normalizeGitTextGenerationModelByProvider(
      settings.gitTextGenerationModelByProvider,
    ),
    accentColor: normalizeAccentColor(settings.accentColor),
    providerAccentColors: Object.fromEntries(
      Object.entries(settings.providerAccentColors)
        .filter(([, v]) => isValidAccentColor(v))
        .map(([k, v]) => [k, normalizeAccentColor(v)]),
    ),
  };
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

export function getProviderStartOptions(
  settings: Pick<AppSettings, "claudeBinaryPath" | "codexBinaryPath" | "codexHomePath">,
): ProviderStartOptions | undefined {
  const providerOptions: ProviderStartOptions = {
    ...(settings.codexBinaryPath || settings.codexHomePath
      ? {
          codex: {
            ...(settings.codexBinaryPath ? { binaryPath: settings.codexBinaryPath } : {}),
            ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
          },
        }
      : {}),
    ...(settings.claudeBinaryPath
      ? {
          claudeAgent: {
            binaryPath: settings.claudeBinaryPath,
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

let cachedRawSettings: string | null = null;
let cachedSnapshot: AppSettings = DEFAULT_APP_SETTINGS;

function migratePersistedAppSettings(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const settings = { ...(value as Record<string, unknown>) };
  if (settings.providerLogoAppearance === undefined && settings.grayscaleProviderLogos === true) {
    settings.providerLogoAppearance = "grayscale";
  }

  // Migrate legacy "claudeCode" key to "claudeAgent" in record-typed settings
  for (const key of ["gitTextGenerationModelByProvider", "providerAccentColors"] as const) {
    const record = settings[key];
    if (record && typeof record === "object" && !Array.isArray(record)) {
      const obj = record as Record<string, unknown>;
      if ("claudeCode" in obj && !("claudeAgent" in obj)) {
        const { claudeCode, ...rest } = obj;
        settings[key] = { ...rest, claudeAgent: claudeCode };
      }
    }
  }

  return settings;
}

function parsePersistedSettings(value: string | null): AppSettings {
  if (!value) {
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeAppSettings(
      AppSettingsSchema.makeUnsafe(migratePersistedAppSettings(parsed) as Record<string, unknown>),
    );
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function getAppSettingsSnapshot(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }

  const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (raw === cachedRawSettings) {
    return cachedSnapshot;
  }

  cachedRawSettings = raw;
  cachedSnapshot = parsePersistedSettings(raw);
  return cachedSnapshot;
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  // Apply legacy key migration that the schema decode path doesn't handle
  // Migrate legacy "claudeCode" keys to "claudeAgent" in record-typed settings
  // (e.g. gitTextGenerationModelByProvider.claudeCode, providerAccentColors.claudeCode).
  const migratedSettings = useMemo(() => {
    let patched = settings;
    for (const key of ["gitTextGenerationModelByProvider", "providerAccentColors"] as const) {
      const val = patched[key];
      if (val && typeof val === "object" && "claudeCode" in val) {
        const record = { ...val } as Record<string, string>;
        if (typeof record.claudeAgent !== "string" && typeof record.claudeCode === "string") {
          record.claudeAgent = record.claudeCode;
        }
        delete record.claudeCode;
        patched = { ...patched, [key]: record };
      }
    }
    return patched;
  }, [settings]);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => normalizeAppSettings({ ...prev, ...patch }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, [setSettings]);

  return {
    settings: migratedSettings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
