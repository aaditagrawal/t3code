import { describe, expect, it } from "vite-plus/test";

import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import { getBuiltInClaudeModelsForVersion, getClaudeModelCapabilities } from "./ClaudeProvider.js";

describe("ClaudeProvider", () => {
  it("gates Claude Sonnet 5 on the minimum Claude Code version", () => {
    expect(
      getBuiltInClaudeModelsForVersion("2.1.196").map(
        (model: { readonly slug: string }) => model.slug,
      ),
    ).not.toContain("claude-sonnet-5");
    expect(
      getBuiltInClaudeModelsForVersion("2.1.197").map(
        (model: { readonly slug: string }) => model.slug,
      ),
    ).toContain("claude-sonnet-5");
  });

  it("exposes reasoning and a context window selector for Claude Sonnet 5", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: getClaudeModelCapabilities("claude-sonnet-5"),
    });

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(["effort", "contextWindow"]);
    expect(
      descriptors.some(
        (descriptor) =>
          descriptor.type === "select" &&
          descriptor.options.some((option) => option.id === "ultracode"),
      ),
    ).toBe(true);
    expect(
      descriptors.find(
        (descriptor) => descriptor.type === "select" && descriptor.id === "contextWindow",
      ),
    ).toMatchObject({
      type: "select",
      id: "contextWindow",
      currentValue: "200k",
    });
  });
});
