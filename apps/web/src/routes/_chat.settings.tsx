import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  type ProviderKind,
} from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";

import {
  APP_PROVIDER_LOGO_APPEARANCE_OPTIONS,
  getAppModelOptions,
  getCustomModelsForProvider,
  MAX_CUSTOM_MODEL_LENGTH,
  patchCustomModels,
  patchGitTextGenerationModelOverrides,
  useAppSettings,
} from "../appSettings";
import { ACCENT_COLOR_PRESETS, DEFAULT_ACCENT_COLOR, normalizeAccentColor } from "../accentColor";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { APP_VERSION } from "../branding";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  {
    provider: "copilot",
    title: "GitHub Copilot",
    description: "Save additional Copilot model slugs for the picker and `/model` command.",
    placeholder: "your-copilot-model-slug",
    example: "gpt-5.1-codex-max",
  },
  {
    provider: "claudeAgent",
    title: "Claude Code",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
  {
    provider: "cursor",
    title: "Cursor",
    description: "Save additional Cursor model slugs for the picker and `/model` command.",
    placeholder: "your-cursor-model-slug",
    example: "openai/gpt-oss-120b",
  },
  {
    provider: "opencode",
    title: "OpenCode",
    description: "Save additional OpenCode model slugs for the picker and `/model` command.",
    placeholder: "your-opencode-model-slug",
    example: "openai/gpt-5#high",
  },
  {
    provider: "geminiCli",
    title: "Gemini CLI",
    description: "Save additional Gemini CLI model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-3.1-pro",
  },
  {
    provider: "amp",
    title: "AMPcode",
    description: "Save additional AMPcode model slugs for the picker and /model command.",
    placeholder: "your-amp-model-slug",
    example: "smart",
  },
  {
    provider: "kilo",
    title: "Kilo",
    description: "Save additional Kilo model slugs for the picker and /model command.",
    placeholder: "your-kilo-model-slug",
    example: "openai/gpt-5#high",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;
const GIT_TEXT_GENERATION_INHERIT_VALUE = "__inherit__";

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  return getCustomModelsForProvider(defaults, provider);
}

// ---------------------------------------------------------------------------
// Log syntax highlighting
// ---------------------------------------------------------------------------

const LOG_TOKEN_PATTERN =
  /(?<key>timestamp|level|fiber|message|cause|span\.\w+)=(?<value>"(?:[^"\\]|\\.)*"|[^\s]+)/g;

const LOG_LEVEL_COLORS: Record<string, string> = {
  Info: "text-blue-400",
  Warning: "text-amber-400",
  Error: "text-red-400",
  Debug: "text-zinc-500",
  Fatal: "text-red-500 font-semibold",
};

function highlightLogLine(line: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(LOG_TOKEN_PATTERN)) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push(line.slice(lastIndex, start));
    }

    const key = match.groups?.key ?? "";
    const value = match.groups?.value ?? "";

    if (key === "timestamp") {
      parts.push(
        <span key={start} className="text-zinc-500">
          {key}={value}
        </span>,
      );
    } else if (key === "level") {
      const levelClass = LOG_LEVEL_COLORS[value] ?? "text-muted-foreground";
      parts.push(
        <span key={start} className={levelClass}>
          {key}={value}
        </span>,
      );
    } else if (key === "fiber") {
      parts.push(
        <span key={start} className="text-violet-400/70">
          {key}={value}
        </span>,
      );
    } else if (key === "message" || key === "cause") {
      parts.push(
        <span key={start}>
          <span className="text-zinc-500">{key}=</span>
          <span className="text-foreground">{value}</span>
        </span>,
      );
    } else {
      parts.push(
        <span key={start} className="text-zinc-500">
          {key}={value}
        </span>,
      );
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}

function HighlightedLogContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, lineIndex) => (
        // eslint-disable-next-line react/no-array-index-key -- static log lines never reorder
        <span key={lineIndex}>
          {highlightLogLine(line)}
          {lineIndex < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </>
  );
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    copilot: "",
    claudeAgent: "",
    cursor: "",
    opencode: "",
    geminiCli: "",
    amp: "",
    kilo: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});

  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const [logDir, setLogDir] = useState<string | null>(null);
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [selectedLogFile, setSelectedLogFile] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const logViewerRef = useRef<HTMLPreElement>(null);

  const loadLogFile = useCallback(async (filename: string) => {
    setIsLoadingLogs(true);
    try {
      const api = ensureNativeApi();
      const result = await api.logs.read(filename);
      setLogContent(result.content);
      requestAnimationFrame(() => {
        if (logViewerRef.current) {
          logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
        }
      });
    } catch {
      setLogContent("Failed to read log file.");
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  const hasDesktopBridge = isElectron && !!window.desktopBridge;

  useEffect(() => {
    if (!hasDesktopBridge) return;
    const bridge = window.desktopBridge!;
    void bridge
      .getUpdateState()
      .then(setUpdateState)
      .catch(() => {});
    const unsubscribe = bridge.onUpdateState(setUpdateState);
    return unsubscribe;
  }, [hasDesktopBridge]);

  useEffect(() => {
    const api = ensureNativeApi();
    void api.logs
      .getDir()
      .then((result) => setLogDir(result.dir))
      .catch(() => {});
  }, []);

  const handleCheckForUpdate = useCallback(async () => {
    if (!hasDesktopBridge) return;
    setIsCheckingUpdate(true);
    try {
      const state = await window.desktopBridge!.checkForUpdate();
      setUpdateState(state);
    } catch {
      setUpdateState((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              message: "Failed to check for updates.",
              errorContext: "check",
            }
          : prev,
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [hasDesktopBridge]);

  const handleDownloadUpdate = useCallback(async () => {
    if (!hasDesktopBridge) return;
    try {
      const result = await window.desktopBridge!.downloadUpdate();
      setUpdateState(result.state);
    } catch (error) {
      setUpdateState((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              message: error instanceof Error ? error.message : "Failed to download update.",
              errorContext: "download",
            }
          : prev,
      );
    }
  }, [hasDesktopBridge]);

  const handleInstallUpdate = useCallback(async () => {
    if (!hasDesktopBridge) return;
    try {
      const result = await window.desktopBridge!.installUpdate();
      setUpdateState(result.state);
    } catch (error) {
      setUpdateState((prev) =>
        prev
          ? {
              ...prev,
              status: "error",
              message: error instanceof Error ? error.message : "Failed to install update.",
              errorContext: "install",
            }
          : prev,
      );
    }
  }, [hasDesktopBridge]);

  const codexBinaryPath = settings.codexBinaryPath;
  const codexHomePath = settings.codexHomePath;
  const accentColor = settings.accentColor;
  const [presetNameInput, setPresetNameInput] = useState<string | null>(null);
  const presetNameRef = useRef<HTMLInputElement>(null);
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModels(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModels(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Code looks across the app.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-primary/60 bg-primary/8 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setTheme(option.value)}
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-xs">{option.description}</span>
                        </span>
                        {selected ? (
                          <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Selected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                  Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
                </p>

                <div className="mt-5 space-y-3 border-t border-border/80 pt-4">
                  <div>
                    <p className="text-xs font-medium text-foreground">Accent color</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Applies to primary actions, focus rings, info highlights, and terminal blue.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {ACCENT_COLOR_PRESETS.map((preset) => {
                      const selected = accentColor === preset.value;
                      return (
                        <button
                          key={preset.value}
                          type="button"
                          className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary/60 bg-primary/8 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent"
                          }`}
                          onClick={() => updateSettings({ accentColor: preset.value })}
                        >
                          <span
                            aria-hidden="true"
                            className="size-3 rounded-full border border-black/20"
                            style={{ backgroundColor: preset.value }}
                          />
                          {preset.label}
                        </button>
                      );
                    })}
                    {settings.customAccentPresets.map((preset) => {
                      const selected = accentColor === preset.value;
                      return (
                        <div
                          key={`custom:${preset.value}:${preset.label}`}
                          className={`group inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary/60 bg-primary/8 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-2"
                            onClick={() => updateSettings({ accentColor: preset.value })}
                          >
                            <span
                              aria-hidden="true"
                              className="size-3 rounded-full border border-black/20"
                              style={{ backgroundColor: preset.value }}
                            />
                            {preset.label}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${preset.label} preset`}
                            className="ml-0.5 hidden text-muted-foreground/50 hover:text-foreground group-hover:inline"
                            onClick={() => {
                              updateSettings({
                                customAccentPresets: settings.customAccentPresets.filter(
                                  (p) => p.value !== preset.value || p.label !== preset.label,
                                ),
                              });
                            }}
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
                    <label
                      htmlFor="accent-color-picker"
                      className="text-xs font-medium text-foreground"
                    >
                      Custom
                    </label>
                    <input
                      id="accent-color-picker"
                      type="color"
                      value={accentColor}
                      className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent p-0"
                      onChange={(event) =>
                        updateSettings({ accentColor: normalizeAccentColor(event.target.value) })
                      }
                    />
                    <code className="text-xs text-muted-foreground">{accentColor}</code>
                    <span className="flex-1" />
                    {accentColor !== DEFAULT_ACCENT_COLOR ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => updateSettings({ accentColor: DEFAULT_ACCENT_COLOR })}
                      >
                        Reset
                      </Button>
                    ) : null}
                    {presetNameInput === null ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          const allPresets = [
                            ...ACCENT_COLOR_PRESETS,
                            ...settings.customAccentPresets,
                          ];
                          if (allPresets.some((p) => p.value === accentColor)) return;
                          setPresetNameInput("");
                          requestAnimationFrame(() => presetNameRef.current?.focus());
                        }}
                      >
                        Save as Preset
                      </Button>
                    ) : (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = presetNameInput.trim();
                          if (!name) return;
                          if (
                            settings.customAccentPresets.some(
                              (p) => p.label.toLowerCase() === name.toLowerCase(),
                            )
                          )
                            return;
                          updateSettings({
                            customAccentPresets: [
                              ...settings.customAccentPresets,
                              { label: name, value: accentColor },
                            ],
                          });
                          setPresetNameInput(null);
                        }}
                      >
                        <Input
                          ref={presetNameRef}
                          className="h-7 w-32 py-0 text-xs leading-7"
                          placeholder="Preset name"
                          value={presetNameInput}
                          onChange={(e) => setPresetNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setPresetNameInput(null);
                          }}
                          onBlur={() => {
                            if (!presetNameInput.trim()) setPresetNameInput(null);
                          }}
                        />
                        <Button size="xs" type="submit" disabled={!presetNameInput.trim()}>
                          Save
                        </Button>
                      </form>
                    )}
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-foreground">
                      Provider logo appearance
                    </span>
                    <Select
                      items={APP_PROVIDER_LOGO_APPEARANCE_OPTIONS.map((option) => ({
                        label: option.label,
                        value: option.value,
                      }))}
                      value={settings.providerLogoAppearance}
                      onValueChange={(value) => {
                        if (!value) return;
                        updateSettings({ providerLogoAppearance: value });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {APP_PROVIDER_LOGO_APPEARANCE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <span className="text-xs text-muted-foreground">
                      {APP_PROVIDER_LOGO_APPEARANCE_OPTIONS.find(
                        (option) => option.value === settings.providerLogoAppearance,
                      )?.description ?? "Use each provider's native logo colors."}
                    </span>
                  </label>

                  {settings.providerLogoAppearance !== defaults.providerLogoAppearance ? (
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() =>
                          updateSettings({
                            providerLogoAppearance: defaults.providerLogoAppearance,
                          })
                        }
                      >
                        Restore default
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Timestamp format</p>
                    <p className="text-xs text-muted-foreground">
                      System default follows your browser or OS time format. <code>12-hour</code>{" "}
                      and <code>24-hour</code> force the hour cycle.
                    </p>
                  </div>
                  <Select
                    value={settings.timestampFormat}
                    onValueChange={(value) => {
                      if (value !== "locale" && value !== "12-hour" && value !== "24-hour") return;
                      updateSettings({
                        timestampFormat: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-40" aria-label="Timestamp format">
                      <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      <SelectItem value="locale">{TIMESTAMP_FORMAT_LABELS.locale}</SelectItem>
                      <SelectItem value="12-hour">{TIMESTAMP_FORMAT_LABELS["12-hour"]}</SelectItem>
                      <SelectItem value="24-hour">{TIMESTAMP_FORMAT_LABELS["24-hour"]}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                {settings.timestampFormat !== defaults.timestampFormat ? (
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSettings({
                          timestampFormat: defaults.timestampFormat,
                        })
                      }
                    >
                      Restore default
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Codex App Server</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  These overrides apply to new sessions and let you use a non-default Codex install.
                </p>
              </div>

              <div className="space-y-4">
                <label htmlFor="codex-binary-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">Codex binary path</span>
                  <Input
                    id="codex-binary-path"
                    value={codexBinaryPath}
                    onChange={(event) => updateSettings({ codexBinaryPath: event.target.value })}
                    placeholder="codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Leave blank to use <code>codex</code> from your PATH.
                  </span>
                </label>

                <label htmlFor="codex-home-path" className="block space-y-1">
                  <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                  <Input
                    id="codex-home-path"
                    value={codexHomePath}
                    onChange={(event) => updateSettings({ codexHomePath: event.target.value })}
                    placeholder="/Users/you/.codex"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">
                    Optional custom Codex home/config directory.
                  </span>
                </label>

                <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p>Binary source</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                      {codexBinaryPath || "PATH"}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="self-start"
                    onClick={() =>
                      updateSettings({
                        codexBinaryPath: defaults.codexBinaryPath,
                        codexHomePath: defaults.codexHomePath,
                      })
                    }
                  >
                    Reset codex overrides
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Git</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure provider-aware model overrides for auto-generated commit messages, PR
                  text, and branch names.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const overrideModel = settings.gitTextGenerationModelByProvider[provider] ?? null;
                  const modelOptions = getAppModelOptions(provider, customModels, overrideModel);
                  const providerFallbackModel =
                    DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider];
                  const providerFallbackLabel =
                    modelOptions.find((option) => option.slug === providerFallbackModel)?.name ??
                    providerFallbackModel;
                  return (
                    <div
                      key={`git-${provider}`}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Leave this unset to use the active thread model first, then{" "}
                          {providerFallbackLabel}.
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground">Git model override</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Overrides only git text generation for this provider.
                          </p>
                        </div>
                        <Select
                          value={overrideModel ?? GIT_TEXT_GENERATION_INHERIT_VALUE}
                          onValueChange={(value) =>
                            updateSettings(
                              patchGitTextGenerationModelOverrides(
                                settings.gitTextGenerationModelByProvider,
                                provider,
                                value === GIT_TEXT_GENERATION_INHERIT_VALUE ? null : value,
                              ),
                            )
                          }
                        >
                          <SelectTrigger
                            className="w-full shrink-0 sm:w-72"
                            aria-label={`${providerSettings.title} git text generation model`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup align="end">
                            <SelectItem value={GIT_TEXT_GENERATION_INHERIT_VALUE}>
                              Use active thread model
                            </SelectItem>
                            {modelOptions.map((option) => (
                              <SelectItem key={`${provider}-${option.slug}`} value={option.slug}>
                                {option.name}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModels(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {slug}
                                  </code>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>

                        <div className="border-t border-border/80 pt-3">
                          <p className="text-xs font-medium text-foreground">
                            Accent color override
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Custom color for this provider's usage bar. Leave unset to use the
                            global accent color.
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              type="color"
                              aria-label={`${providerSettings.title} accent color override`}
                              value={settings.providerAccentColors[provider] ?? accentColor}
                              className="size-5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
                              onChange={(event) => {
                                const color = normalizeAccentColor(event.target.value);
                                updateSettings({
                                  providerAccentColors: {
                                    ...settings.providerAccentColors,
                                    [provider]: color,
                                  },
                                });
                              }}
                            />
                            <code className="text-xs text-muted-foreground">
                              {settings.providerAccentColors[provider] ?? "global"}
                            </code>
                            {settings.providerAccentColors[provider] ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  const next = { ...settings.providerAccentColors };
                                  delete next[provider];
                                  updateSettings({ providerAccentColors: next });
                                }}
                              >
                                Reset to global
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Threads</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose the default workspace mode for newly created draft threads.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Default to New worktree</p>
                  <p className="text-xs text-muted-foreground">
                    New threads start in New worktree mode instead of Local.
                  </p>
                </div>
                <Switch
                  checked={settings.defaultThreadEnvMode === "worktree"}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      defaultThreadEnvMode: checked ? "worktree" : "local",
                    })
                  }
                  aria-label="Default new threads to New worktree mode"
                />
              </div>

              {settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress. Cursor turns always
                    stream so tool calls and assistant text stay interleaved.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Display</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control which elements are visible in the chat timeline.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Show command output</p>
                    <p className="text-xs text-muted-foreground">
                      Display stdout/stderr inline after executed commands.
                    </p>
                  </div>
                  <Switch
                    checked={settings.showCommandOutput}
                    onCheckedChange={(checked) =>
                      updateSettings({ showCommandOutput: Boolean(checked) })
                    }
                    aria-label="Show command output"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Show file change diffs</p>
                    <p className="text-xs text-muted-foreground">
                      Render file diffs in the side panel after completed turns.
                    </p>
                  </div>
                  <Switch
                    checked={settings.showFileChangeDiffs}
                    onCheckedChange={(checked) =>
                      updateSettings({ showFileChangeDiffs: Boolean(checked) })
                    }
                    aria-label="Show file change diffs"
                  />
                </div>

                {settings.showCommandOutput !== defaults.showCommandOutput ||
                settings.showFileChangeDiffs !== defaults.showFileChangeDiffs ? (
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSettings({
                          showCommandOutput: defaults.showCommandOutput,
                          showFileChangeDiffs: defaults.showFileChangeDiffs,
                        })
                      }
                    >
                      Restore defaults
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Logs</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Application log files for debugging.
                </p>
              </div>

              <div className="space-y-3">
                {logDir ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                    <code className="min-w-0 truncate text-xs text-muted-foreground select-all">
                      {logDir}
                    </code>
                    {hasDesktopBridge ? (
                      <Button
                        size="xs"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => void window.desktopBridge!.openLogDir()}
                      >
                        Show in File Manager
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <Button
                  size="xs"
                  variant="outline"
                  disabled={isLoadingLogs}
                  onClick={async () => {
                    if (isLogViewerOpen) {
                      setIsLogViewerOpen(false);
                      return;
                    }
                    setIsLoadingLogs(true);
                    try {
                      const api = ensureNativeApi();
                      const result = await api.logs.list();
                      const files = result.files;
                      setLogFiles(files);
                      if (files.length > 0 && !selectedLogFile) {
                        setSelectedLogFile(files[0]!);
                        await loadLogFile(files[0]!);
                      }
                      setIsLogViewerOpen(true);
                    } catch {
                      setLogContent("Failed to load log files.");
                      setIsLogViewerOpen(true);
                    } finally {
                      setIsLoadingLogs(false);
                    }
                  }}
                >
                  {isLoadingLogs
                    ? "Loading..."
                    : isLogViewerOpen
                      ? "Hide Log Viewer"
                      : "View in App"}
                </Button>

                {isLogViewerOpen ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Select
                        value={selectedLogFile ?? ""}
                        onValueChange={(value) => {
                          if (!value) return;
                          setSelectedLogFile(value);
                          void loadLogFile(value);
                        }}
                      >
                        <SelectTrigger className="h-7 w-60 text-xs">
                          <SelectValue placeholder="Select a log file" />
                        </SelectTrigger>
                        <SelectPopup>
                          {logFiles.map((file) => (
                            <SelectItem key={file} value={file}>
                              {file}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!selectedLogFile || isLoadingLogs}
                        onClick={() => {
                          if (selectedLogFile) void loadLogFile(selectedLogFile);
                        }}
                      >
                        Refresh
                      </Button>
                    </div>
                    <pre
                      ref={logViewerRef}
                      className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground"
                    >
                      {logContent ? (
                        <HighlightedLogContent content={logContent} />
                      ) : (
                        "No log content."
                      )}
                    </pre>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">About</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Application version and environment information.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Version</p>
                    <p className="text-xs text-muted-foreground">
                      {updateState?.status === "up-to-date"
                        ? "You're on the latest version."
                        : updateState?.status === "checking"
                          ? "Checking for updates..."
                          : updateState?.status === "available"
                            ? `Version ${updateState.availableVersion ?? "unknown"} is available.`
                            : updateState?.status === "downloading"
                              ? `Downloading update${typeof updateState.downloadPercent === "number" ? ` (${Math.floor(updateState.downloadPercent)}%)` : ""}...`
                              : updateState?.status === "downloaded"
                                ? `Version ${updateState.downloadedVersion ?? updateState.availableVersion ?? "unknown"} is ready to install.`
                                : updateState?.status === "error"
                                  ? (updateState.message ?? "Update check failed.")
                                  : "Current version of the application."}
                    </p>
                    {updateState?.checkedAt ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        Last checked: {new Date(updateState.checkedAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
                    {hasDesktopBridge ? (
                      <>
                        {updateState?.status === "available" ? (
                          <Button size="xs" onClick={handleDownloadUpdate}>
                            Download
                          </Button>
                        ) : null}
                        {updateState?.status === "downloaded" ? (
                          <Button size="xs" onClick={handleInstallUpdate}>
                            Restart & Install
                          </Button>
                        ) : null}
                        {updateState?.status === "error" &&
                        updateState.errorContext === "download" &&
                        updateState.availableVersion ? (
                          <Button size="xs" variant="outline" onClick={handleDownloadUpdate}>
                            Retry Download
                          </Button>
                        ) : null}
                        {updateState?.status === "error" &&
                        updateState.errorContext === "install" &&
                        updateState.downloadedVersion ? (
                          <Button size="xs" variant="outline" onClick={handleInstallUpdate}>
                            Retry Install
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            isCheckingUpdate ||
                            updateState?.status === "checking" ||
                            updateState?.status === "downloading"
                          }
                          onClick={handleCheckForUpdate}
                        >
                          {isCheckingUpdate || updateState?.status === "checking"
                            ? "Checking..."
                            : "Check for Updates"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                {updateState?.status === "downloading" &&
                typeof updateState.downloadPercent === "number" ? (
                  <div className="px-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${updateState.downloadPercent}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
