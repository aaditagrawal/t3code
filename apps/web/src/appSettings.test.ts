import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAppSettingsSnapshot,
  getAppModelOptions,
  getSlashModelOptions,
  normalizeCustomModelSlugs,
  resolveAppServiceTier,
  shouldShowFastTierIcon,
  resolveAppModelSelection,
} from "./appSettings";

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
    expect(normalizeCustomModelSlugs(["sonnet"], "claudeCode")).toEqual([]);
    expect(normalizeCustomModelSlugs(["claude/custom-sonnet"], "claudeCode")).toEqual([
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
    const options = getAppModelOptions("claudeCode", ["claude/custom-opus"], "claude/custom-opus");

    expect(options.some((option) => option.slug === "claude/custom-opus" && option.isCustom)).toBe(
      true,
    );
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("getSlashModelOptions", () => {
  it("includes saved custom model slugs for /model command suggestions", () => {
    const options = getSlashModelOptions(
      "codex",
      ["custom/internal-model"],
      "",
      "gpt-5.3-codex",
    );

    expect(options.some((option) => option.slug === "custom/internal-model")).toBe(true);
  });

  it("filters slash-model suggestions across built-in and custom model names", () => {
    const options = getSlashModelOptions(
      "codex",
      ["openai/gpt-oss-120b"],
      "oss",
      "gpt-5.3-codex",
    );

    expect(options.map((option) => option.slug)).toEqual(["openai/gpt-oss-120b"]);
  });

  it("includes provider-specific custom slugs in non-codex model lists", () => {
    const claudeOptions = getAppModelOptions("claudeCode", ["claude/custom-opus"]);
    const cursorOptions = getAppModelOptions("cursor", ["cursor/custom-model"]);

    expect(claudeOptions.some((option) => option.slug === "claude/custom-opus")).toBe(true);
    expect(cursorOptions.some((option) => option.slug === "cursor/custom-model")).toBe(true);
  });
});

describe("resolveAppServiceTier", () => {
  it("maps automatic to no override", () => {
    expect(resolveAppServiceTier("auto")).toBeNull();
  });

  it("preserves explicit service tier overrides", () => {
    expect(resolveAppServiceTier("fast")).toBe("fast");
    expect(resolveAppServiceTier("flex")).toBe("flex");
  });
});

describe("getAppSettingsSnapshot", () => {
  it("defaults provider logos to color", () => {
    expect(getAppSettingsSnapshot().grayscaleProviderLogos).toBe(false);
  });

  it("hydrates a persisted grayscale provider logo preference", () => {
    const persistedSettings = {
      ...getAppSettingsSnapshot(),
      grayscaleProviderLogos: true,
    };
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify(persistedSettings),
    );

    expect(getAppSettingsSnapshot().grayscaleProviderLogos).toBe(true);
  });
});

describe("shouldShowFastTierIcon", () => {
  it("shows the fast-tier icon only for gpt-5.4 on fast tier", () => {
    expect(shouldShowFastTierIcon("gpt-5.4", "fast")).toBe(true);
    expect(shouldShowFastTierIcon("gpt-5.4", "auto")).toBe(false);
    expect(shouldShowFastTierIcon("gpt-5.3-codex", "fast")).toBe(false);
  });
});
