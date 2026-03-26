import { useCallback, useMemo } from "react";
import { Option, Schema } from "effect";
import type { ProviderStartOptions } from "@t3tools/contracts";
import { DEFAULT_ACCENT_COLOR, isValidAccentColor, normalizeAccentColor } from "./accentColor";
import { useLocalStorage } from "./hooks/useLocalStorage";

// Domain modules
import {
  AppProviderLogoAppearanceSchema,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
} from "./appearance";
import { normalizeCustomModelSlugs } from "./customModels";
import { normalizeGitTextGenerationModelByProvider } from "./gitTextGeneration";

// Re-export everything from domain modules for backwards compatibility
export {
  APP_PROVIDER_LOGO_APPEARANCE_OPTIONS,
  type AppProviderLogoAppearance,
  AppProviderLogoAppearanceSchema,
  TIMESTAMP_FORMAT_OPTIONS,
  type TimestampFormat,
  DEFAULT_TIMESTAMP_FORMAT,
  SidebarProjectSortOrder,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  SidebarThreadSortOrder,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
} from "./appearance";

export {
  MAX_CUSTOM_MODEL_LENGTH,
  type CustomModelSettingsKey,
  type ProviderCustomModelConfig,
  type ProviderCustomModelSettings,
  MODEL_PROVIDER_SETTINGS,
  type AppModelOption,
  normalizeCustomModelSlugs,
  getCustomModelsForProvider,
  patchCustomModels,
  getDefaultCustomModelsForProvider,
  getCustomModelsByProvider,
  getAppModelOptions,
  resolveAppModelSelection,
  getCustomModelOptionsByProvider,
  getSlashModelOptions,
} from "./customModels";

export {
  getGitTextGenerationModelOverride,
  patchGitTextGenerationModelOverrides,
  resolveGitTextGenerationModelSelection,
} from "./gitTextGeneration";

const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

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

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});

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
