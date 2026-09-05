import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { ProviderDriverKind } from "@t3tools/contracts";
import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { CopilotSettings } from "./Drivers/CopilotSettings.ts";
import { makePendingCopilotProvider } from "./Layers/CopilotProvider.ts";
import { buildInitialStandardAcpCliProviderSnapshot } from "./Layers/StandardAcpCliProvider.ts";

const capabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "high", label: "High" }],
    },
  ],
} as const;
const namedModel = { slug: "custom-preview", name: "Custom preview", capabilities };
const customModels = ["legacy-model", namedModel];

const decodeCopilotSettings = Schema.decodeUnknownSync(CopilotSettings);
const driverCases: Array<{
  kind: string;
  defaults: unknown;
  decode: (input: unknown) => unknown;
  encode: (input: unknown) => unknown;
}> = [];
for (const driver of BUILT_IN_DRIVERS) {
  driverCases.push({
    kind: driver.driverKind,
    defaults: driver.defaultConfig(),
    decode: Schema.decodeUnknownSync(driver.configSchema),
    encode: Schema.encodeUnknownSync(driver.configSchema),
  });
}

describe("built-in driver custom model settings", () => {
  it.each(driverCases)(
    "$kind accepts the model editor's structured entries alongside legacy strings",
    ({ defaults, decode, encode }) => {
      const decoded = decode(Object.assign({}, defaults, { customModels }));
      expect(decoded).toMatchObject({ customModels });
      expect(encode(decoded)).toMatchObject({
        customModels,
      });
    },
  );

  it("preserves custom names and capabilities in the Copilot model snapshot", () => {
    const settings = decodeCopilotSettings({ customModels });
    const models = makePendingCopilotProvider(settings).models;
    expect(models).toContainEqual({ ...namedModel, isCustom: true });
    expect(models.find((model) => model.slug === "legacy-model")?.name).toBe("legacy-model");
  });

  it.effect("preserves custom names and capabilities in the shared ACP model snapshot", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialStandardAcpCliProviderSnapshot({
        provider: ProviderDriverKind.make("acp"),
        displayName: "ACP Agent",
        command: "unused",
        enabled: false,
        customModels,
        environment: {},
        setupHint: "Configure ACP",
        missingCommandMessage: "Unavailable",
      });
      expect(snapshot.models).toContainEqual({ ...namedModel, isCustom: true });
      expect(snapshot.models.find((model) => model.slug === "legacy-model")?.name).toBe(
        "legacy-model",
      );
    }),
  );
});
