import { useCallback, useMemo } from "react";
import { Effect, Schema } from "effect";
import {
  DEFAULT_SERVER_SETTINGS,
  type ProviderStartOptions,
  type ProviderKind,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { DEFAULT_ACCENT_COLOR, isValidAccentColor, normalizeAccentColor } from "./accentColor";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useSettings, useUpdateSettings } from "./hooks/useSettings";

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
const APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS = {
  codex: "customCodexModels",
  copilot: "customCopilotModels",
  claudeAgent: "customClaudeModels",
  cursor: "customCursorModels",
  opencode: "customOpencodeModels",
  geminiCli: "customGeminiCliModels",
  amp: "customAmpModels",
  kilo: "customKiloModels",
} as const satisfies Record<ProviderKind, keyof AppSettings>;
const MIRRORED_CLIENT_KEYS = new Set<keyof AppSettings>([
  "confirmThreadDelete",
  "diffWordWrap",
  "sidebarProjectSortOrder",
  "sidebarThreadSortOrder",
  "timestampFormat",
]);
const MIRRORED_SERVER_KEYS = new Set<keyof AppSettings>([
  "claudeBinaryPath",
  "codexBinaryPath",
  "codexHomePath",
  "copilotCliPath",
  "copilotConfigDir",
  "defaultThreadEnvMode",
  "enableAssistantStreaming",
  "customCodexModels",
  "customCopilotModels",
  "customClaudeModels",
  "customCursorModels",
  "customOpencodeModels",
  "customGeminiCliModels",
  "customAmpModels",
  "customKiloModels",
]);

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(Effect.succeed(fallback())),
      Schema.withDecodingDefault(Effect.succeed(fallback())),
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

const DEFAULT_APP_SETTINGS = AppSettingsSchema.make({});

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
      AppSettingsSchema.make(migratePersistedAppSettings(parsed) as Record<string, unknown>),
    );
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function withUnifiedCompatSettings(
  localSettings: AppSettings,
  unifiedSettings: Pick<
    UnifiedSettings,
    | "confirmThreadDelete"
    | "defaultThreadEnvMode"
    | "diffWordWrap"
    | "enableAssistantStreaming"
    | "providers"
    | "sidebarProjectSortOrder"
    | "sidebarThreadSortOrder"
    | "timestampFormat"
  >,
): AppSettings {
  return normalizeAppSettings({
    ...localSettings,
    claudeBinaryPath: unifiedSettings.providers.claudeAgent.binaryPath,
    codexBinaryPath: unifiedSettings.providers.codex.binaryPath,
    codexHomePath: unifiedSettings.providers.codex.homePath,
    copilotCliPath: unifiedSettings.providers.copilot.binaryPath,
    copilotConfigDir: unifiedSettings.providers.copilot.configDir,
    defaultThreadEnvMode: unifiedSettings.defaultThreadEnvMode,
    confirmThreadDelete: unifiedSettings.confirmThreadDelete,
    diffWordWrap: unifiedSettings.diffWordWrap,
    enableAssistantStreaming: unifiedSettings.enableAssistantStreaming,
    sidebarProjectSortOrder: unifiedSettings.sidebarProjectSortOrder,
    sidebarThreadSortOrder: unifiedSettings.sidebarThreadSortOrder,
    timestampFormat: unifiedSettings.timestampFormat,
    customCodexModels: [...unifiedSettings.providers.codex.customModels],
    customCopilotModels: [...unifiedSettings.providers.copilot.customModels],
    customClaudeModels: [...unifiedSettings.providers.claudeAgent.customModels],
    customCursorModels: [...unifiedSettings.providers.cursor.customModels],
    customOpencodeModels: [...unifiedSettings.providers.opencode.customModels],
    customGeminiCliModels: [...unifiedSettings.providers.geminiCli.customModels],
    customAmpModels: [...unifiedSettings.providers.amp.customModels],
    customKiloModels: [...unifiedSettings.providers.kilo.customModels],
  });
}

function toUnifiedPatch(patch: Partial<AppSettings>): Partial<UnifiedSettings> {
  const providersPatch: Partial<
    Record<
      ProviderKind,
      {
        binaryPath?: string;
        homePath?: string;
        configDir?: string;
        customModels?: ReadonlyArray<string>;
      }
    >
  > = {};
  if (patch.codexBinaryPath !== undefined || patch.codexHomePath !== undefined) {
    providersPatch.codex = {
      ...(patch.codexBinaryPath !== undefined ? { binaryPath: patch.codexBinaryPath } : {}),
      ...(patch.codexHomePath !== undefined ? { homePath: patch.codexHomePath } : {}),
    };
  }
  if (patch.claudeBinaryPath !== undefined) {
    providersPatch.claudeAgent = {
      binaryPath: patch.claudeBinaryPath,
    };
  }
  if (patch.copilotCliPath !== undefined || patch.copilotConfigDir !== undefined) {
    providersPatch.copilot = {
      ...(patch.copilotCliPath !== undefined ? { binaryPath: patch.copilotCliPath } : {}),
      ...(patch.copilotConfigDir !== undefined ? { configDir: patch.copilotConfigDir } : {}),
    };
  }
  const providerModelEntries = Object.entries(APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS) as Array<
    [ProviderKind, (typeof APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS)[ProviderKind]]
  >;
  for (const [provider, settingsKey] of providerModelEntries) {
    const models = patch[settingsKey];
    if (!Array.isArray(models)) {
      continue;
    }
    providersPatch[provider] = {
      ...(providersPatch[provider] ?? {}),
      customModels: normalizeCustomModelSlugs(models, provider),
    };
  }
  return {
    ...(patch.confirmThreadDelete !== undefined
      ? { confirmThreadDelete: patch.confirmThreadDelete }
      : {}),
    ...(patch.diffWordWrap !== undefined ? { diffWordWrap: patch.diffWordWrap } : {}),
    ...(patch.sidebarProjectSortOrder !== undefined
      ? { sidebarProjectSortOrder: patch.sidebarProjectSortOrder }
      : {}),
    ...(patch.sidebarThreadSortOrder !== undefined
      ? { sidebarThreadSortOrder: patch.sidebarThreadSortOrder }
      : {}),
    ...(patch.timestampFormat !== undefined ? { timestampFormat: patch.timestampFormat } : {}),
    ...(patch.defaultThreadEnvMode !== undefined
      ? { defaultThreadEnvMode: patch.defaultThreadEnvMode }
      : {}),
    ...(patch.enableAssistantStreaming !== undefined
      ? { enableAssistantStreaming: patch.enableAssistantStreaming }
      : {}),
    ...(Object.keys(providersPatch).length > 0
      ? { providers: providersPatch as Partial<UnifiedSettings["providers"]> }
      : {}),
  } as Partial<UnifiedSettings>;
}

function stripMirroredKeys(patch: Partial<AppSettings>): Partial<AppSettings> {
  const nextPatch = { ...patch };
  for (const key of [...MIRRORED_CLIENT_KEYS, ...MIRRORED_SERVER_KEYS]) {
    delete nextPatch[key];
  }
  return nextPatch;
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
  const [localSettings, setLocalSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );
  const unifiedSettings = useSettings();
  const compatUnifiedSettings = useMemo(
    () => ({
      confirmThreadDelete: unifiedSettings.confirmThreadDelete,
      defaultThreadEnvMode: unifiedSettings.defaultThreadEnvMode,
      diffWordWrap: unifiedSettings.diffWordWrap,
      enableAssistantStreaming: unifiedSettings.enableAssistantStreaming,
      providers: unifiedSettings.providers,
      sidebarProjectSortOrder: unifiedSettings.sidebarProjectSortOrder,
      sidebarThreadSortOrder: unifiedSettings.sidebarThreadSortOrder,
      timestampFormat: unifiedSettings.timestampFormat,
    }),
    [unifiedSettings],
  );
  const { updateSettings: updateUnifiedSettings, resetSettings: resetUnifiedSettings } =
    useUpdateSettings();
  const settings = useMemo(
    () => withUnifiedCompatSettings(localSettings, compatUnifiedSettings),
    [compatUnifiedSettings, localSettings],
  );
  const defaults = useMemo(
    () =>
      withUnifiedCompatSettings(DEFAULT_APP_SETTINGS, {
        ...DEFAULT_SERVER_SETTINGS,
        ...DEFAULT_CLIENT_SETTINGS,
      }),
    [],
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
      const unifiedPatch = toUnifiedPatch(patch);
      if (Object.keys(unifiedPatch).length > 0) {
        updateUnifiedSettings(unifiedPatch);
      }

      const localPatch = stripMirroredKeys(patch);
      if (Object.keys(localPatch).length === 0) {
        return;
      }

      setLocalSettings((prev: AppSettings) =>
        normalizeAppSettings(AppSettingsSchema.make(stripMirroredKeys({ ...prev, ...localPatch }))),
      );
    },
    [setLocalSettings, updateUnifiedSettings],
  );

  const resetSettings = useCallback(() => {
    resetUnifiedSettings();
    setLocalSettings(AppSettingsSchema.make(stripMirroredKeys(DEFAULT_APP_SETTINGS)));
  }, [resetUnifiedSettings, setLocalSettings]);

  return {
    settings: migratedSettings,
    updateSettings,
    resetSettings,
    defaults,
  } as const;
}
