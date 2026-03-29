import { describe, expect, it } from "vitest";
import {
  buildLegacyClientSettingsMigrationPatch,
  buildLegacyServerSettingsMigrationPatch,
} from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });
});

describe("buildLegacyServerSettingsMigrationPatch", () => {
  it("migrates Copilot path, config, and custom model settings", () => {
    expect(
      buildLegacyServerSettingsMigrationPatch({
        copilotCliPath: "/usr/local/bin/copilot",
        copilotConfigDir: "/Users/mav/.config/copilot",
        customCopilotModels: ["copilot/custom-gpt"],
      }),
    ).toEqual({
      providers: {
        copilot: {
          binaryPath: "/usr/local/bin/copilot",
          configDir: "/Users/mav/.config/copilot",
          customModels: ["copilot/custom-gpt"],
        },
      },
    });
  });
});
