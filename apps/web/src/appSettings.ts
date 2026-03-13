import { useCallback } from "react";
import { Option, Schema } from "effect";
import { type ProviderKind } from "@t3tools/contracts";
import { getDefaultModel, getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
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
const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  copilot: new Set(getModelOptions("copilot").map((option) => option.slug)),
  claudeCode: new Set(getModelOptions("claudeCode").map((option) => option.slug)),
  cursor: new Set(getModelOptions("cursor").map((option) => option.slug)),
  opencode: new Set(getModelOptions("opencode").map((option) => option.slug)),
  geminiCli: new Set(getModelOptions("geminiCli").map((option) => option.slug)),
  amp: new Set(getModelOptions("amp").map((option) => option.slug)),
  kilo: new Set(getModelOptions("kilo").map((option) => option.slug)),
};

const AppSettingsSchema = Schema.Struct({
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  copilotCliPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  copilotConfigDir: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    Schema.withConstructorDefault(() => Option.some("local")),
  ),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  showCommandOutput: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  showFileChangeDiffs: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  timestampFormat: Schema.Literals(["locale", "12-hour", "24-hour"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customCopilotModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customClaudeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customCursorModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customOpencodeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customGeminiCliModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customAmpModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customKiloModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  providerLogoAppearance: AppProviderLogoAppearanceSchema.pipe(
    Schema.withConstructorDefault(() => Option.some("original")),
  ),
  grayscaleProviderLogos: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  accentColor: Schema.String.check(Schema.isMaxLength(16)).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_ACCENT_COLOR)),
  ),
  providerAccentColors: Schema.Record(Schema.String, Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some({} as Record<string, string>)),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});

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

function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    customCodexModels: normalizeCustomModelSlugs(settings.customCodexModels, "codex"),
    customCopilotModels: normalizeCustomModelSlugs(settings.customCopilotModels, "copilot"),
    customClaudeModels: normalizeCustomModelSlugs(settings.customClaudeModels, "claudeCode"),
    customCursorModels: normalizeCustomModelSlugs(settings.customCursorModels, "cursor"),
    customOpencodeModels: normalizeCustomModelSlugs(settings.customOpencodeModels, "opencode"),
    customGeminiCliModels: normalizeCustomModelSlugs(settings.customGeminiCliModels, "geminiCli"),
    customAmpModels: normalizeCustomModelSlugs(settings.customAmpModels, "amp"),
    customKiloModels: normalizeCustomModelSlugs(settings.customKiloModels, "kilo"),
    accentColor: normalizeAccentColor(settings.accentColor),
    providerAccentColors: Object.fromEntries(
      Object.entries(settings.providerAccentColors)
        .filter(([, v]) => isValidAccentColor(v))
        .map(([k, v]) => [k, normalizeAccentColor(v)]),
    ),
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
  if (normalizedSelectedModel && !seen.has(normalizedSelectedModel)) {
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
  customModels: readonly string[],
  selectedModel: string | null | undefined,
): string {
  const options = getAppModelOptions(provider, customModels, selectedModel);
  const trimmedSelectedModel = selectedModel?.trim();
  if (trimmedSelectedModel) {
    const direct = options.find((option) => option.slug === trimmedSelectedModel);
    if (direct) {
      return direct.slug;
    }

    const byName = options.find(
      (option) => option.name.toLowerCase() === trimmedSelectedModel.toLowerCase(),
    );
    if (byName) {
      return byName.slug;
    }
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (!normalizedSelectedModel) {
    return getDefaultModel(provider);
  }

  return (
    options.find((option) => option.slug === normalizedSelectedModel)?.slug ??
    getDefaultModel(provider)
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

let listeners: Array<() => void> = [];
let cachedRawSettings: string | null = null;
let cachedSnapshot: AppSettings = DEFAULT_APP_SETTINGS;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function migratePersistedAppSettings(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const settings = { ...(value as Record<string, unknown>) };
  if (settings.providerLogoAppearance === undefined && settings.grayscaleProviderLogos === true) {
    settings.providerLogoAppearance = "grayscale";
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

function persistSettings(next: AppSettings): void {
  if (typeof window === "undefined") return;

  const raw = JSON.stringify(next);
  try {
    if (raw !== cachedRawSettings) {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, raw);
    }
  } catch {
    // Best-effort persistence only.
  }

  cachedRawSettings = raw;
  cachedSnapshot = next;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_SETTINGS_STORAGE_KEY) {
      emitChange();
    }
  };

  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => ({
        ...prev,
        ...patch,
      }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
