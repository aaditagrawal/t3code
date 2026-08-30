import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  buildLegacyClientSettingsMigrationPatch,
  buildLegacyServerSettingsMigrationPatch,
  mergeEnvironmentSettings,
  resolveEnvironmentIdentificationMode,
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

describe("resolveEnvironmentIdentificationMode", () => {
  it("keeps identification hidden until client settings hydrate", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        sidebarArtworkOverride: null,
        settingsHydrated: false,
      }),
    ).toBe("none");
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "pill",
        sidebarArtworkOverride: null,
        settingsHydrated: true,
      }),
    ).toBe("pill");
  });

  it("applies the backward-compatible Nightly artwork override", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        sidebarArtworkOverride: "nightly",
        settingsHydrated: true,
      }),
    ).toBe("nightly-artwork");
  });

  it("uses a pill instead of artwork with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        sidebarArtworkOverride: null,
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("pill");
  });

  it("respects none with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "none",
        sidebarArtworkOverride: null,
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("none");
  });

  it("keeps artwork when the palette theme opts into it", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        sidebarArtworkOverride: null,
        settingsHydrated: true,
        paletteThemeActive: true,
        paletteThemeAllowsArtwork: true,
      }),
    ).toBe("artwork");
  });
});

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });
});
