import { describe, expect, it } from "vitest";
import {
  CURSOR_MODEL_FAMILY_OPTIONS,
  CURSOR_REASONING_OPTIONS,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  MODEL_OPTIONS_BY_PROVIDER,
  CODEX_REASONING_EFFORT_OPTIONS,
  type ModelCapabilities,
} from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  getDefaultContextWindow,
  getDefaultModel,
  getDefaultReasoningEffort,
  getCursorModelFamilyOptions,
  getModelCapabilities,
  getModelOptions,
  getDefaultEffort,
  getReasoningEffortOptions,
  hasContextWindowOption,
  hasEffortLevel,
  isClaudeUltrathinkPrompt,
  normalizeClaudeModelOptions,
  normalizeClaudeModelOptionsWithCapabilities,
  normalizeCodexModelOptions,
  normalizeCodexModelOptionsWithCapabilities,
  normalizeModelSlug,
  parseCursorModelSelection,
  resolveApiModelId,
  resolveContextWindow,
  resolveCursorPickerModelSlug,
  resolveCursorModelFromSelection,
  resolveEffort,
  resolveReasoningEffortForProvider,
  resolveSelectableModel,
  resolveModelSlug,
  resolveModelSlugForProvider,
  inferProviderForModel,
  trimOrNull,
} from "./model";

const codexCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const claudeCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [
    { value: "200k", label: "200k" },
    { value: "1m", label: "1M", isDefault: true },
  ],
  promptInjectedEffortLevels: ["ultrathink"],
};

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("gpt-5-codex")).toBe("gpt-5.4");
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
    expect(normalizeModelSlug("sonnet", "claudeAgent")).toBe("claude-sonnet-4-6");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });

  it("preserves non-aliased model slugs", () => {
    expect(normalizeModelSlug("gpt-5.2")).toBe("gpt-5.2");
    expect(normalizeModelSlug("gpt-5.2-codex")).toBe("gpt-5.2-codex");
  });

  it("uses provider-specific aliases", () => {
    expect(normalizeModelSlug("sonnet", "claudeAgent")).toBe("claude-sonnet-4-6");
    expect(normalizeModelSlug("opus-4.6", "claudeAgent")).toBe("claude-opus-4-6");
    expect(normalizeModelSlug("claude-haiku-4-5-20251001", "claudeAgent")).toBe("claude-haiku-4-5");
    expect(normalizeModelSlug("composer", "cursor")).toBe("composer-1.5");
    expect(normalizeModelSlug("gpt-5.3-codex-spark", "cursor")).toBe("gpt-5.3-codex-spark-preview");
    expect(normalizeModelSlug("gpt-5.4", "cursor")).toBe("gpt-5.4-medium");
    expect(normalizeModelSlug("gpt-5.2-codex", "cursor")).toBe("gpt-5.2-codex");
    expect(normalizeModelSlug("gemini-3.1", "cursor")).toBe("gemini-3.1-pro");
    expect(normalizeModelSlug("claude-4.6-sonnet-thinking", "cursor")).toBe("sonnet-4.6-thinking");
    expect(normalizeModelSlug("claude-4.5-sonnet-thinking", "cursor")).toBe("sonnet-4.5-thinking");
  });

  it("does not leak prototype properties as aliases", () => {
    expect(normalizeModelSlug("toString")).toBe("toString");
    expect(normalizeModelSlug("constructor")).toBe("constructor");
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "codex")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);

    expect(resolveModelSlugForProvider("claudeAgent", undefined)).toBe(
      DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    );
    expect(resolveModelSlugForProvider("claudeAgent", "sonnet")).toBe("claude-sonnet-4-6");
    // Unknown slugs are preserved (may be custom models)
    expect(resolveModelSlugForProvider("claudeAgent", "gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(resolveModelSlugForProvider("cursor", undefined)).toBe(DEFAULT_MODEL_BY_PROVIDER.cursor);
    expect(resolveModelSlugForProvider("cursor", "composer")).toBe("composer-1.5");
    expect(resolveModelSlugForProvider("cursor", "gpt-5.3-codex-high-fast")).toBe(
      "gpt-5.3-codex-high-fast",
    );
    // Unknown slugs are preserved (may be custom models)
    expect(resolveModelSlugForProvider("cursor", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("keeps codex defaults for backward compatibility", () => {
    expect(getDefaultModel()).toBe(DEFAULT_MODEL);
    expect(getModelOptions("claudeAgent")).toEqual(MODEL_OPTIONS_BY_PROVIDER.claudeAgent);
    expect(getModelOptions("cursor")).toEqual(MODEL_OPTIONS_BY_PROVIDER.cursor);
    expect(getCursorModelFamilyOptions()).toEqual(CURSOR_MODEL_FAMILY_OPTIONS);
  });

  it("preserves normalized unknown models", () => {
    expect(resolveModelSlug("custom/internal-model", "codex")).toBe("custom/internal-model");
  });
});

describe("cursor model selection", () => {
  it("includes the expected cursor reasoning levels and families", () => {
    expect(CURSOR_REASONING_OPTIONS).toEqual(["low", "normal", "high", "xhigh"]);
    expect(getCursorModelFamilyOptions().map((option) => option.slug)).toContain("gpt-5.3-codex");
    expect(getCursorModelFamilyOptions().map((option) => option.slug)).toContain("gpt-5.2-codex");
    expect(getCursorModelFamilyOptions().map((option) => option.slug)).toContain("gpt-5.4-medium");
    expect(getCursorModelFamilyOptions().map((option) => option.slug)).toContain("opus-4.6");
    expect(getCursorModelFamilyOptions().map((option) => option.slug)).toContain("sonnet-4.5");
  });

  it("parses codex reasoning and fast mode variants", () => {
    expect(parseCursorModelSelection("gpt-5.3-codex-high-fast")).toEqual({
      family: "gpt-5.3-codex",
      reasoning: "high",
      fast: true,
      thinking: false,
    });
    expect(parseCursorModelSelection("gpt-5.2-codex")).toEqual({
      family: "gpt-5.2-codex",
      reasoning: "normal",
      fast: false,
      thinking: false,
    });
  });

  it("parses newer cursor codex reasoning variants", () => {
    expect(parseCursorModelSelection("gpt-5.2-codex-high-fast")).toEqual({
      family: "gpt-5.2-codex",
      reasoning: "high",
      fast: true,
      thinking: false,
    });
    expect(
      resolveCursorModelFromSelection({
        family: "gpt-5.2-codex",
        reasoning: "xhigh",
        fast: true,
      }),
    ).toBe("gpt-5.2-codex-xhigh-fast");
  });

  it("parses and resolves thinking variants", () => {
    expect(parseCursorModelSelection("sonnet-4.6-thinking")).toEqual({
      family: "sonnet-4.6",
      reasoning: "normal",
      fast: false,
      thinking: true,
    });
    expect(
      resolveCursorModelFromSelection({
        family: "sonnet-4.6",
        thinking: true,
      }),
    ).toBe("sonnet-4.6-thinking");
    expect(parseCursorModelSelection("sonnet-4.5-thinking")).toEqual({
      family: "sonnet-4.5",
      reasoning: "normal",
      fast: false,
      thinking: true,
    });
  });

  it("resolves codex family selections into concrete model ids", () => {
    expect(
      resolveCursorModelFromSelection({
        family: "gpt-5.3-codex",
        reasoning: "xhigh",
        fast: true,
      }),
    ).toBe("gpt-5.3-codex-xhigh-fast");
  });

  it("collapses trait-backed cursor variants to a single picker option", () => {
    expect(resolveCursorPickerModelSlug("gpt-5.2-codex-high-fast")).toBe("gpt-5.2-codex");
    expect(resolveCursorPickerModelSlug("opus-4.6-thinking")).toBe("opus-4.6");
    expect(resolveCursorPickerModelSlug("sonnet-4.5-thinking")).toBe("sonnet-4.5");
    expect(resolveCursorPickerModelSlug("gpt-5.4-high-fast")).toBe("gpt-5.4-high-fast");
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ];
    expect(resolveSelectableModel("codex", "gpt-5.3-codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("codex", "gpt-5.3 codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("claudeAgent", "sonnet", options)).toBe("claude-sonnet-4-6");
  });
});

describe("capability helpers", () => {
  it("reads default efforts", () => {
    expect(getDefaultEffort(codexCaps)).toBe("high");
    expect(getDefaultEffort(claudeCaps)).toBe("high");
  });

  it("returns claude effort options for Opus 4.6", () => {
    const values = getReasoningEffortOptions("claudeAgent", "claude-opus-4-6");
    expect(values).toEqual(["low", "medium", "high", "max", "ultrathink"]);
  });

  it("returns claude effort options for Sonnet 4.6", () => {
    const values = getReasoningEffortOptions("claudeAgent", "claude-sonnet-4-6");
    expect(values).toEqual(["low", "medium", "high", "ultrathink"]);
  });

  it("returns no claude effort options for Haiku 4.5", () => {
    expect(getReasoningEffortOptions("claudeAgent", "claude-haiku-4-5")).toEqual([]);
  });

  it("returns no reasoning options for cursor", () => {
    expect(getReasoningEffortOptions("cursor")).toEqual([]);
  });
});

describe("inferProviderForModel", () => {
  it("detects known provider model slugs", () => {
    expect(inferProviderForModel("gpt-5.3-codex")).toBe("codex");
    expect(inferProviderForModel("claude-sonnet-4-6")).toBe("claudeAgent");
    expect(inferProviderForModel("sonnet")).toBe("claudeAgent");
  });

  it("co-locates labels with effort values", () => {
    const levels = getModelCapabilities("claudeAgent", "claude-opus-4-6").reasoningEffortLevels;
    const high = levels.find((l) => l.value === "high");
    expect(high).toEqual({ value: "high", label: "High", isDefault: true });
    const xhigh = getModelCapabilities("codex", "gpt-5.4").reasoningEffortLevels.find(
      (l) => l.value === "xhigh",
    );
    expect(xhigh).toEqual({ value: "xhigh", label: "Extra High" });
    expect(getDefaultReasoningEffort("cursor")).toBe(DEFAULT_REASONING_EFFORT_BY_PROVIDER.cursor);
  });
});

describe("getDefaultEffort", () => {
  it("returns the default effort from capabilities", () => {
    expect(getDefaultEffort(getModelCapabilities("codex", "gpt-5.4"))).toBe("high");
    expect(getDefaultEffort(getModelCapabilities("claudeAgent", "claude-opus-4-6"))).toBe("high");
    expect(getDefaultEffort(getModelCapabilities("claudeAgent", "claude-haiku-4-5"))).toBeNull();
  });
});

describe("hasEffortLevel", () => {
  it("validates effort against model capabilities", () => {
    const opusCaps = getModelCapabilities("claudeAgent", "claude-opus-4-6");
    expect(hasEffortLevel(opusCaps, "max")).toBe(true);
    expect(hasEffortLevel(opusCaps, "xhigh")).toBe(false);

    const codexCaps = getModelCapabilities("codex", "gpt-5.4");
    expect(hasEffortLevel(codexCaps, "xhigh")).toBe(true);
    expect(hasEffortLevel(codexCaps, "max")).toBe(false);
  });
});

describe("resolveEffort", () => {
  it("returns the explicit value when supported and not prompt-injected", () => {
    expect(resolveEffort(codexCaps, "xhigh")).toBe("xhigh");
    expect(resolveEffort(codexCaps, "high")).toBe("high");
    expect(resolveEffort(claudeCaps, "medium")).toBe("medium");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveEffort(codexCaps, "bogus")).toBe("high");
    expect(resolveEffort(claudeCaps, "bogus")).toBe("high");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveEffort(codexCaps, undefined)).toBe("high");
    expect(resolveEffort(codexCaps, null)).toBe("high");
    expect(resolveEffort(codexCaps, "")).toBe("high");
    expect(resolveEffort(codexCaps, "  ")).toBe("high");
  });

  it("excludes prompt-injected efforts and falls back to default", () => {
    expect(resolveEffort(claudeCaps, "ultrathink")).toBe("high");
  });

  it("returns undefined for models with no effort levels", () => {
    const noCaps: ModelCapabilities = {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    };
    expect(resolveEffort(noCaps, undefined)).toBeUndefined();
    expect(resolveEffort(noCaps, "high")).toBeUndefined();
  });
});

describe("misc helpers", () => {
  it("detects ultrathink prompts", () => {
    expect(isClaudeUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(isClaudeUltrathinkPrompt("Investigate")).toBe(false);
  });

  it("prefixes ultrathink prompts once", () => {
    expect(applyClaudePromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(applyClaudePromptEffortPrefix("Ultrathink:\nInvestigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
  });

  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("context window helpers", () => {
  it("reads default context window", () => {
    expect(getDefaultContextWindow(claudeCaps)).toBe("1m");
  });

  it("returns null for models without context window options", () => {
    expect(getDefaultContextWindow(codexCaps)).toBeNull();
  });

  it("checks context window support", () => {
    expect(hasContextWindowOption(claudeCaps, "1m")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "200k")).toBe(true);
    expect(hasContextWindowOption(claudeCaps, "bogus")).toBe(false);
    expect(hasContextWindowOption(codexCaps, "1m")).toBe(false);
  });
});

describe("resolveContextWindow", () => {
  it("returns the explicit value when supported", () => {
    expect(resolveContextWindow(claudeCaps, "200k")).toBe("200k");
    expect(resolveContextWindow(claudeCaps, "1m")).toBe("1m");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveContextWindow(claudeCaps, "bogus")).toBe("1m");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveContextWindow(claudeCaps, undefined)).toBe("1m");
    expect(resolveContextWindow(claudeCaps, null)).toBe("1m");
    expect(resolveContextWindow(claudeCaps, "")).toBe("1m");
  });

  it("returns undefined for models with no context window options", () => {
    expect(resolveContextWindow(codexCaps, undefined)).toBeUndefined();
    expect(resolveContextWindow(codexCaps, "1m")).toBeUndefined();
  });
});

describe("resolveApiModelId", () => {
  it("appends [1m] suffix for 1m context window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: { contextWindow: "1m" },
      }),
    ).toBe("claude-opus-4-6[1m]");
  });

  it("returns the model as-is for 200k context window", () => {
    expect(
      resolveApiModelId({
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: { contextWindow: "200k" },
      }),
    ).toBe("claude-opus-4-6");
  });

  it("returns the model as-is when no context window is set", () => {
    expect(resolveApiModelId({ provider: "claudeAgent", model: "claude-opus-4-6" })).toBe(
      "claude-opus-4-6",
    );
    expect(
      resolveApiModelId({ provider: "claudeAgent", model: "claude-opus-4-6", options: {} }),
    ).toBe("claude-opus-4-6");
  });

  it("returns the model as-is for Codex selections", () => {
    expect(resolveApiModelId({ provider: "codex", model: "gpt-5.4" })).toBe("gpt-5.4");
  });
});

describe("normalize*ModelOptionsWithCapabilities", () => {
  it("preserves explicit false codex fast mode", () => {
    expect(
      normalizeCodexModelOptionsWithCapabilities(codexCaps, {
        reasoningEffort: "high",
        fastMode: false,
      }),
    ).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("preserves the default Claude context window explicitly", () => {
    expect(
      normalizeClaudeModelOptionsWithCapabilities(
        {
          ...claudeCaps,
          contextWindowOptions: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        },
        {
          effort: "high",
          contextWindow: "200k",
        },
      ),
    ).toEqual({
      effort: "high",
      contextWindow: "200k",
    });
  });

  it("omits unsupported Claude context window options", () => {
    expect(
      normalizeClaudeModelOptionsWithCapabilities(
        {
          ...claudeCaps,
          reasoningEffortLevels: [],
          supportsThinkingToggle: true,
          contextWindowOptions: [],
        },
        {
          thinking: true,
          contextWindow: "1m",
        },
      ),
    ).toEqual({
      thinking: true,
    });
  });
});
