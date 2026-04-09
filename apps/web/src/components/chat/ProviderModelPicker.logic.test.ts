import { describe, expect, it } from "vitest";

import { resolveModelOptionsByProvider } from "../../providerModelOptions";

const EMPTY_CUSTOM_MODELS = {
  customCodexModels: [],
  customCopilotModels: [],
  customClaudeModels: [],
  customCursorModels: [],
  customOpencodeModels: [],
  customGeminiCliModels: [],
  customAmpModels: [],
  customKiloModels: [],
} as const;

describe("resolveModelOptionsByProvider", () => {
  it("keeps built-in model catalogs when the server has no snapshot for a provider", () => {
    const modelOptions = resolveModelOptionsByProvider(EMPTY_CUSTOM_MODELS);

    expect(modelOptions.copilot.length).toBeGreaterThan(0);
    expect(modelOptions.cursor.length).toBeGreaterThan(0);
    expect(modelOptions.opencode.length).toBeGreaterThan(0);
    expect(modelOptions.geminiCli.length).toBeGreaterThan(0);
    expect(modelOptions.amp.length).toBeGreaterThan(0);
    expect(modelOptions.kilo.length).toBeGreaterThan(0);
    expect(modelOptions.copilot.some((option) => option.slug === "claude-sonnet-4.6")).toBe(true);
    expect(modelOptions.cursor.some((option) => option.slug === "gpt-5.3-codex")).toBe(true);
    expect(modelOptions.opencode.some((option) => option.slug === "openai/gpt-5")).toBe(true);
    expect(modelOptions.geminiCli.some((option) => option.slug === "gemini-2.5-pro")).toBe(true);
    expect(modelOptions.amp.some((option) => option.slug === "smart")).toBe(true);
    expect(modelOptions.kilo.some((option) => option.slug === "openai/gpt-5")).toBe(true);
  });

  it("merges discovered provider models on top of the built-in fallback list", () => {
    const modelOptions = resolveModelOptionsByProvider({
      ...EMPTY_CUSTOM_MODELS,
      discovered: {
        opencode: [
          { slug: "openai/gpt-5", name: "OpenAI / GPT-5", connected: true },
          { slug: "anthropic/sonnet", name: "Anthropic / Sonnet", connected: false },
        ],
        kilo: [{ slug: "openai/gpt-5", name: "OpenAI / GPT-5", connected: true }],
        copilot: [{ slug: "gpt-5.4", name: "GPT-5.4", pricingTier: "1x" }],
      },
    });

    expect(modelOptions.opencode[0]).toEqual({
      slug: "anthropic/sonnet",
      name: "Anthropic / Sonnet",
      connected: false,
    });
    expect(modelOptions.opencode).toContainEqual({
      slug: "openai/gpt-5",
      name: "OpenAI / GPT-5",
      connected: true,
      isCustom: false,
    });
    expect(modelOptions.kilo).toContainEqual({
      slug: "openai/gpt-5",
      name: "OpenAI / GPT-5",
      connected: true,
      isCustom: false,
    });
    expect(modelOptions.copilot.find((option) => option.slug === "gpt-5.4")?.pricingTier).toBe(
      "1x",
    );
  });
});
