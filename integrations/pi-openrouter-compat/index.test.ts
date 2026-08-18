import { describe, expect, it } from "vitest";

import { omitUnsafeOpenRouterMaxTokens } from "./index.ts";

const affectedModel = {
  provider: "openrouter",
  api: "openai-completions",
  contextWindow: 512_000,
  maxTokens: 512_000,
} as const;

describe("Pi OpenRouter compatibility extension", () => {
  it("omits an unsafe catalog-derived output limit", () => {
    expect(
      omitUnsafeOpenRouterMaxTokens(
        {
          model: "dots-studio/dots-3-note-preview:free",
          max_completion_tokens: 507_887,
          stream: true,
        },
        affectedModel as never,
      ),
    ).toEqual({ model: "dots-studio/dots-3-note-preview:free", stream: true });
  });

  it("omits the alternate near-context output limit field", () => {
    expect(
      omitUnsafeOpenRouterMaxTokens(
        { model: "example/model", max_tokens: 507_887, stream: true },
        affectedModel as never,
      ),
    ).toEqual({ model: "example/model", stream: true });
  });

  it.each(["max_completion_tokens", "max_tokens"])(
    "preserves an explicit %s request limit",
    (field) => {
      expect(
        omitUnsafeOpenRouterMaxTokens(
          { model: "example/model", [field]: 128, stream: true },
          affectedModel as never,
        ),
      ).toBeUndefined();
    },
  );

  it("leaves normal output limits unchanged", () => {
    expect(
      omitUnsafeOpenRouterMaxTokens({ model: "example/model", max_completion_tokens: 16_384 }, {
        ...affectedModel,
        maxTokens: 16_384,
      } as never),
    ).toBeUndefined();
  });
});
