import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
  DEFAULT_TIMESTAMP_FORMAT,
  getProviderStartOptions,
} from "./appSettings";
import {
  getAppModelOptions,
  getAppSettingsSnapshot,
  getCustomModelOptionsByProvider,
  getCustomModelsByProvider,
  getCustomModelsForProvider,
  getDefaultCustomModelsForProvider,
  MODEL_PROVIDER_SETTINGS,
  normalizeCustomModelSlugs,
  patchCustomModels,
  patchGitTextGenerationModelOverrides,
  resolveAppModelSelection,
  resolveGitTextGenerationModelSelection,
} from "./appSettings";

/** Empty custom models for all providers — test helper */
const EMPTY_CUSTOM_MODELS = {
  codex: [] as readonly string[],
  copilot: [] as readonly string[],
  claudeAgent: [] as readonly string[],
  cursor: [] as readonly string[],
  opencode: [] as readonly string[],
  geminiCli: [] as readonly string[],
  amp: [] as readonly string[],
  kilo: [] as readonly string[],
} as const;

const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  const localStorage = createLocalStorageMock();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
    },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });

  it("normalizes provider-specific aliases for claude and cursor", () => {
    expect(normalizeCustomModelSlugs(["sonnet"], "claudeAgent")).toEqual([]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "claudeAgent")).toEqual([
      "claude/custom-sonnet",
    ]);
    expect(normalizeCustomModelSlugs(["composer"], "cursor")).toEqual([]);
    expect(normalizeCustomModelSlugs(["cursor/custom-model"], "cursor")).toEqual([
      "cursor/custom-model",
    ]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });

  it("keeps a saved custom provider model available as an exact slug option", () => {
    const options = getAppModelOptions("claudeAgent", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(
      resolveAppModelSelection(
        "codex",
        { ...EMPTY_CUSTOM_MODELS, codex: ["galapagos-alpha"] },
        "galapagos-alpha",
      ),
    ).toBe("galapagos-alpha");
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", EMPTY_CUSTOM_MODELS, "")).toBe("gpt-5.4");
  });

  it("resolves display names through the shared resolver", () => {
    expect(resolveAppModelSelection("codex", EMPTY_CUSTOM_MODELS, "GPT-5.3 Codex")).toBe(
      "gpt-5.3-codex",
    );
  });

  it("resolves aliases through the shared resolver", () => {
    expect(resolveAppModelSelection("claudeAgent", EMPTY_CUSTOM_MODELS, "sonnet")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("resolves transient selected custom models included in app model options", () => {
    expect(resolveAppModelSelection("codex", EMPTY_CUSTOM_MODELS, "custom/selected-model")).toBe(
      "custom/selected-model",
    );
  });
});

describe("resolveGitTextGenerationModelSelection", () => {
  it("prefers a provider-specific override over the active thread model", () => {
    const settings = {
      ...getAppSettingsSnapshot(),
      ...patchGitTextGenerationModelOverrides({}, "codex", "gpt-5.4-mini"),
    };

    expect(resolveGitTextGenerationModelSelection("codex", settings, "gpt-5.4")).toBe(
      "gpt-5.4-mini",
    );
  });

  it("falls back to the active thread model when no override is configured", () => {
    const settings = getAppSettingsSnapshot();

    expect(resolveGitTextGenerationModelSelection("cursor", settings, "opus-4.6-thinking")).toBe(
      "opus-4.6-thinking",
    );
  });

  it("uses the provider git default when neither an override nor thread model exists", () => {
    const settings = getAppSettingsSnapshot();

    expect(resolveGitTextGenerationModelSelection("codex", settings, null)).toBe("gpt-5.4-mini");
  });
});

describe("timestamp format defaults", () => {
  it("defaults timestamp format to locale", () => {
    expect(DEFAULT_TIMESTAMP_FORMAT).toBe("locale");
  });

  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeAgent", ["claude/custom-opus"]);
    const cursorOptions = getAppModelOptions("cursor", ["cursor/custom-model"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
    expect(cursorOptions.some((option) => option.slug === "cursor/custom-model")).toBe(true);
  });
});

describe("getAppSettingsSnapshot", () => {
  it("defaults provider logos to color", () => {
    expect(getAppSettingsSnapshot().providerLogoAppearance).toBe("original");
  });

  it("hydrates a persisted provider logo appearance preference", () => {
    const persistedSettings = {
      ...getAppSettingsSnapshot(),
      providerLogoAppearance: "accent",
    };
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(persistedSettings));

    expect(getAppSettingsSnapshot().providerLogoAppearance).toBe("accent");
  });

  it("migrates the legacy grayscale provider logo preference", () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        grayscaleProviderLogos: true,
      }),
    );

    expect(getAppSettingsSnapshot().providerLogoAppearance).toBe("grayscale");
  });
});

describe("sidebar sort defaults", () => {
  it("defaults project sorting to updated_at", () => {
    expect(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER).toBe("updated_at");
  });

  it("defaults thread sorting to updated_at", () => {
    expect(DEFAULT_SIDEBAR_THREAD_SORT_ORDER).toBe("updated_at");
  });
});

describe("provider-specific custom models", () => {
  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeAgent", ["claude/custom-opus"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
  });
});

describe("getProviderStartOptions", () => {
  it("returns only populated provider overrides", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "/usr/local/bin/claude",
        codexBinaryPath: "",
        codexHomePath: "/Users/you/.codex",
      }),
    ).toEqual({
      claudeAgent: {
        binaryPath: "/usr/local/bin/claude",
      },
      codex: {
        homePath: "/Users/you/.codex",
      },
    });
  });

  it("returns undefined when no provider overrides are configured", () => {
    expect(
      getProviderStartOptions({
        claudeBinaryPath: "",
        codexBinaryPath: "",
        codexHomePath: "",
      }),
    ).toBeUndefined();
  });
});

describe("provider-indexed custom model settings", () => {
  const settings = {
    customCodexModels: ["custom/codex-model"],
    customClaudeModels: ["claude/custom-opus"],
    customCopilotModels: [],
    customCursorModels: [],
    customOpencodeModels: [],
    customGeminiCliModels: [],
    customAmpModels: [],
    customKiloModels: [],
  } as const;

  it("exports one provider config per provider", () => {
    expect(MODEL_PROVIDER_SETTINGS.map((config) => config.provider)).toEqual([
      "codex",
      "copilot",
      "claudeAgent",
      "cursor",
      "opencode",
      "geminiCli",
      "amp",
      "kilo",
    ]);
  });

  it("reads custom models for each provider", () => {
    expect(getCustomModelsForProvider(settings, "codex")).toEqual(["custom/codex-model"]);
    expect(getCustomModelsForProvider(settings, "claudeAgent")).toEqual(["claude/custom-opus"]);
  });

  it("reads default custom models for each provider", () => {
    const defaults = {
      customCodexModels: ["default/codex-model"],
      customClaudeModels: ["claude/default-opus"],
      customCopilotModels: [],
      customCursorModels: [],
      customOpencodeModels: [],
      customGeminiCliModels: [],
      customAmpModels: [],
      customKiloModels: [],
    } as const;

    expect(getDefaultCustomModelsForProvider(defaults, "codex")).toEqual(["default/codex-model"]);
    expect(getDefaultCustomModelsForProvider(defaults, "claudeAgent")).toEqual([
      "claude/default-opus",
    ]);
  });

  it("patches custom models for codex", () => {
    expect(patchCustomModels("codex", ["custom/codex-model"])).toEqual({
      customCodexModels: ["custom/codex-model"],
    });
  });

  it("patches custom models for claude", () => {
    expect(patchCustomModels("claudeAgent", ["claude/custom-opus"])).toEqual({
      customClaudeModels: ["claude/custom-opus"],
    });
  });

  it("builds a complete provider-indexed custom model record", () => {
    expect(getCustomModelsByProvider(settings)).toEqual({
      codex: ["custom/codex-model"],
      copilot: [],
      claudeAgent: ["claude/custom-opus"],
      cursor: [],
      opencode: [],
      geminiCli: [],
      amp: [],
      kilo: [],
    });
  });

  it("builds provider-indexed model options including custom models", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider(settings);

    expect(
      modelOptionsByProvider.codex.some((option) => option.slug === "custom/codex-model"),
    ).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude/custom-opus"),
    ).toBe(true);
  });

  it("normalizes and deduplicates custom model options per provider", () => {
    const modelOptionsByProvider = getCustomModelOptionsByProvider({
      customCodexModels: ["  custom/codex-model ", "gpt-5.4", "custom/codex-model"],
      customClaudeModels: [" sonnet ", "claude/custom-opus", "claude/custom-opus"],
      customCopilotModels: [],
      customCursorModels: [],
      customOpencodeModels: [],
      customGeminiCliModels: [],
      customAmpModels: [],
      customKiloModels: [],
    });

    expect(
      modelOptionsByProvider.codex.filter((option) => option.slug === "custom/codex-model"),
    ).toHaveLength(1);
    expect(modelOptionsByProvider.codex.some((option) => option.slug === "gpt-5.4")).toBe(true);
    expect(
      modelOptionsByProvider.claudeAgent.filter((option) => option.slug === "claude/custom-opus"),
    ).toHaveLength(1);
    expect(
      modelOptionsByProvider.claudeAgent.some((option) => option.slug === "claude-sonnet-4-6"),
    ).toBe(true);
  });
});

describe("AppSettingsSchema", () => {
  it("fills decoding defaults for persisted settings that predate newer keys", () => {
    const decode = Schema.decodeUnknownSync(Schema.fromJsonString(AppSettingsSchema));

    expect(
      decode(
        JSON.stringify({
          codexBinaryPath: "/usr/local/bin/codex",
          confirmThreadDelete: false,
        }),
      ),
    ).toMatchObject({
      claudeBinaryPath: "",
      codexBinaryPath: "/usr/local/bin/codex",
      codexHomePath: "",
      defaultThreadEnvMode: "local",
      confirmThreadDelete: false,
      enableAssistantStreaming: false,
      sidebarProjectSortOrder: DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
      sidebarThreadSortOrder: DEFAULT_SIDEBAR_THREAD_SORT_ORDER,
      timestampFormat: DEFAULT_TIMESTAMP_FORMAT,
      customCodexModels: [],
      customClaudeModels: [],
    });
  });
});

// Note: upstream's resolveAppModelSelectionState tests removed — the fork
// uses resolveGitTextGenerationModelSelection with per-provider overrides
// instead of a single textGenerationModelSelection field.  Equivalent
// coverage lives in the resolveGitTextGenerationModelSelection tests above.
