import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProviderDriverKind } from "@t3tools/contracts";

import {
  applyStandardAcpModelSelection,
  firstAdvertisedAuthMethod,
  normalizeStandardAcpModel,
} from "./StandardAcpCliSupport.ts";

describe("standard ACP CLI support", () => {
  it("selects advertised auth while excluding interactive setup methods", () => {
    const selected = firstAdvertisedAuthMethod(
      {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [
          { id: "hermes-setup", name: "Setup" },
          { id: "openrouter", name: "OpenRouter" },
        ],
      },
      new Set(["hermes-setup"]),
    );
    expect(selected).toBe("openrouter");
  });

  it("preserves provider-qualified model ids owned by the ACP agent", () => {
    expect(
      normalizeStandardAcpModel("  anthropic:claude-sonnet  ", ProviderDriverKind.make("hermes")),
    ).toBe("anthropic:claude-sonnet");
  });

  it.effect("switches models only when the requested model changes", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const runtime = {
        setSessionModel: (modelId: string) =>
          Effect.sync(() => {
            calls.push(modelId);
            return {};
          }),
      };
      const selected = yield* applyStandardAcpModelSelection({
        runtime,
        currentModelId: "old",
        requestedModelId: "new",
        mapError: String,
      });
      const unchanged = yield* applyStandardAcpModelSelection({
        runtime,
        currentModelId: "new",
        requestedModelId: "new",
        mapError: String,
      });
      expect(selected).toBe("new");
      expect(unchanged).toBe("new");
      expect(calls).toEqual(["new"]);
    }),
  );
});
