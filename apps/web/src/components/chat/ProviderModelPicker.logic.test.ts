import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS_BY_PROVIDER } from "@t3tools/contracts";

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
    for (const provider of ["copilot", "cursor", "opencode", "geminiCli", "amp", "kilo"] as const) {
      expect(
        modelOptions[provider].some(
          (option) => option.slug === MODEL_OPTIONS_BY_PROVIDER[provider][0]?.slug,
        ),
      ).toBe(true);
    }
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
