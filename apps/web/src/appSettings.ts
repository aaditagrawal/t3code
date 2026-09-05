import { readCustomModelSlugs } from "@t3tools/shared/model";
import { useCallback, useMemo } from "react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import type { ProviderKind } from "./providerKind";
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

const MAX_CUSTOM_MODEL_COUNT = 32;
const MAX_CUSTOM_MODEL_LENGTH_VALUE = 256;
export const MAX_CUSTOM_MODEL_LENGTH = MAX_CUSTOM_MODEL_LENGTH_VALUE;

/**
 * Lightweight, fork-local custom-model normalizer used while the legacy
 * AppSettings shape is still alive in the web client. The new instance-keyed
 * pipeline lives in `modelSelection.ts`; this helper just trims, dedupes and
 * caps the legacy per-driver string arrays so we can keep round-tripping them
 * through `withUnifiedCompatSettings` / `toUnifiedPatch` without touching the
 * removed contracts surface.
 */
function normalizeCustomModelSlugsLocal(
  models: Iterable<string | null | undefined>,
): ReadonlyArray<string> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of models) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > MAX_CUSTOM_MODEL_LENGTH_VALUE) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_CUSTOM_MODEL_COUNT) break;
  }
  return out;
}

function normalizeGitTextGenerationModelByProviderLocal(
  overrides: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    next[k === "claudeCode" ? "claudeAgent" : k] = trimmed;
  }
  return next;
}

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
} as const satisfies Partial<Record<ProviderKind, keyof AppSettings>>;
const MIRRORED_CLIENT_KEYS = new Set<keyof AppSettings>([
  "confirmThreadDelete",
  "diffWordWrap",
  "diffIgnoreWhitespace",
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
  diffIgnoreWhitespace: Schema.Boolean.pipe(withDefaults(() => true)),
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
    customCodexModels: normalizeCustomModelSlugsLocal(settings.customCodexModels),
    customCopilotModels: normalizeCustomModelSlugsLocal(settings.customCopilotModels),
    customClaudeModels: normalizeCustomModelSlugsLocal(settings.customClaudeModels),
    customCursorModels: normalizeCustomModelSlugsLocal(settings.customCursorModels),
    customOpencodeModels: normalizeCustomModelSlugsLocal(settings.customOpencodeModels),
    customGeminiCliModels: normalizeCustomModelSlugsLocal(settings.customGeminiCliModels),
    customAmpModels: normalizeCustomModelSlugsLocal(settings.customAmpModels),
    customKiloModels: normalizeCustomModelSlugsLocal(settings.customKiloModels),
    gitTextGenerationModelByProvider: normalizeGitTextGenerationModelByProviderLocal(
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
    | "diffIgnoreWhitespace"
    | "enableLegacyTokenStreaming"
    | "providers"
    | "sidebarProjectSortOrder"
    | "sidebarThreadSortOrder"
    | "timestampFormat"
    | "wordWrap"
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
    diffWordWrap: unifiedSettings.wordWrap,
    diffIgnoreWhitespace: unifiedSettings.diffIgnoreWhitespace,
    enableAssistantStreaming: unifiedSettings.enableLegacyTokenStreaming,
    sidebarProjectSortOrder: unifiedSettings.sidebarProjectSortOrder,
    sidebarThreadSortOrder: unifiedSettings.sidebarThreadSortOrder,
    timestampFormat: unifiedSettings.timestampFormat,
    customCodexModels: readCustomModelSlugs(unifiedSettings.providers.codex.customModels),
    customCopilotModels: readCustomModelSlugs(unifiedSettings.providers.copilot.customModels),
    customClaudeModels: readCustomModelSlugs(unifiedSettings.providers.claudeAgent.customModels),
    customCursorModels: readCustomModelSlugs(unifiedSettings.providers.cursor.customModels),
    customOpencodeModels: readCustomModelSlugs(unifiedSettings.providers.opencode.customModels),
    customGeminiCliModels: readCustomModelSlugs(unifiedSettings.providers.geminiCli.customModels),
    customAmpModels: readCustomModelSlugs(unifiedSettings.providers.amp.customModels),
    customKiloModels: readCustomModelSlugs(unifiedSettings.providers.kilo.customModels),
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
    [
      keyof typeof APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS,
      (typeof APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS)[keyof typeof APP_SETTINGS_PROVIDER_CUSTOM_MODEL_KEYS],
    ]
  >;
  for (const [provider, settingsKey] of providerModelEntries) {
    const models = patch[settingsKey];
    if (!Array.isArray(models)) {
      continue;
    }
    providersPatch[provider] = {
      ...providersPatch[provider],
      customModels: normalizeCustomModelSlugsLocal(models),
    };
  }
  return {
    ...(patch.confirmThreadDelete !== undefined
      ? { confirmThreadDelete: patch.confirmThreadDelete }
      : {}),
    ...(patch.diffWordWrap !== undefined ? { wordWrap: patch.diffWordWrap } : {}),
    ...(patch.diffIgnoreWhitespace !== undefined
      ? { diffIgnoreWhitespace: patch.diffIgnoreWhitespace }
      : {}),
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
      ? { enableLegacyTokenStreaming: patch.enableAssistantStreaming }
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
      wordWrap: unifiedSettings.wordWrap,
      diffIgnoreWhitespace: unifiedSettings.diffIgnoreWhitespace,
      enableLegacyTokenStreaming: unifiedSettings.enableLegacyTokenStreaming,
      providers: unifiedSettings.providers,
      sidebarProjectSortOrder: unifiedSettings.sidebarProjectSortOrder,
      sidebarThreadSortOrder: unifiedSettings.sidebarThreadSortOrder,
      timestampFormat: unifiedSettings.timestampFormat,
    }),
    [unifiedSettings],
  );
  const updateUnifiedSettings = useUpdateSettings();
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
    const patched = { ...settings };
    for (const key of ["gitTextGenerationModelByProvider", "providerAccentColors"] as const) {
      const val = patched[key];
      if (val && typeof val === "object" && "claudeCode" in val) {
        const record = { ...val } as Record<string, string>;
        if (typeof record.claudeAgent !== "string" && typeof record.claudeCode === "string") {
          record.claudeAgent = record.claudeCode;
        }
        delete record.claudeCode;
        Object.assign(patched, { [key]: record });
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
    updateUnifiedSettings({
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    });
    setLocalSettings(AppSettingsSchema.make(stripMirroredKeys(DEFAULT_APP_SETTINGS)));
  }, [setLocalSettings, updateUnifiedSettings]);

  return {
    settings: migratedSettings,
    updateSettings,
    resetSettings,
    defaults,
  } as const;
}
