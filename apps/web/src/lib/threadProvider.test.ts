import { describe, expect, it } from "vitest";
import { inferProviderForThreadModel, resolveThreadProvider } from "./threadProvider";

describe("inferProviderForThreadModel", () => {
  it("prefers the active session provider when present", () => {
    expect(
      inferProviderForThreadModel({
        model: "gpt-5.3-codex",
        sessionProviderName: "claudeAgent",
      }),
    ).toBe("claudeAgent");
  });

  it("infers cursor threads from composer models", () => {
    expect(
      inferProviderForThreadModel({
        model: "composer-1.5",
        sessionProviderName: null,
      }),
    ).toBe("cursor");
  });

  it("infers opencode threads from slash-delimited models", () => {
    expect(
      inferProviderForThreadModel({
        model: "openai/gpt-5.1",
        sessionProviderName: null,
      }),
    ).toBe("opencode");
  });
});

describe("resolveThreadProvider", () => {
  it("falls back to the thread model when the session is closed", () => {
    expect(
      resolveThreadProvider({
        model: "composer",
        session: null,
      }),
    ).toBe("cursor");
  });
});
