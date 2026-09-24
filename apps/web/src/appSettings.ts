import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DEFAULT_ACCENT_COLOR, isValidAccentColor, normalizeAccentColor } from "./accentColor";

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
  type AppProviderLogoAppearance,
  AppProviderLogoAppearanceSchema,
  type TimestampFormat,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
} from "./appearance";

const MAX_CUSTOM_MODEL_COUNT = 32;
const MAX_CUSTOM_MODEL_LENGTH_VALUE = 256;

/** Preserve custom model settings while importing the legacy local-storage snapshot. */
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
  customPrimeAgentModels: Schema.Array(Schema.String).pipe(withDefaults(() => [])),
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
    customPrimeAgentModels: normalizeCustomModelSlugsLocal(settings.customPrimeAgentModels),
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
