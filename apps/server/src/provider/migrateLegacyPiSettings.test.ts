import { describe, expect, it } from "vite-plus/test";
import { migrateLegacyPiSettings } from "./migrateLegacyPiSettings.ts";

describe("Pi runtime settings migration", () => {
  it("preserves default ACP identity and offers native Pi separately", () => {
    const result = migrateLegacyPiSettings({
      providers: { pi: { enabled: true, binaryPath: "pi-acp" } },
    });
    expect(result).toMatchObject({
      providerInstances: {
        pi: { driver: "acp", enabled: true, config: { binaryPath: "pi-acp" } },
        "pi-native": { driver: "pi", enabled: false },
      },
      providers: { pi: { binaryPath: "pi" } },
    });
    expect(migrateLegacyPiSettings(result)).toEqual(result);
  });
  it("preserves the enabled default when legacy settings omit it", () => {
    expect(migrateLegacyPiSettings({ providers: { pi: { binaryPath: "pi-acp" } } })).toMatchObject({
      providerInstances: { pi: { driver: "acp", enabled: true } },
    });
  });
  it("keeps custom executable, arguments, environment, and models on the same instance", () => {
    const instance = {
      driver: "pi",
      displayName: "Work Pi",
      enabled: true,
      environment: [{ name: "TOKEN", value: "secret", sensitive: true }],
      config: {
        binaryPath: "/work/pi-acp",
        arguments: "--profile work",
        customModels: ["work-model"],
      },
    };
    expect(migrateLegacyPiSettings({ providerInstances: { work: instance } })).toMatchObject({
      providerInstances: { work: { ...instance, driver: "acp" } },
    });
  });
  it("preserves native Pi configuration while migrating a separate legacy instance", () => {
    const native = {
      enabled: true,
      binaryPath: "/custom/native-pi",
      launchArgs: "--extension work",
      customModels: ["custom-model"],
    };
    const migrated = migrateLegacyPiSettings({
      providers: { pi: native },
      providerInstances: { legacy: { driver: "pi", config: { binaryPath: "pi-acp" } } },
    });
    expect(migrated).toMatchObject({
      providers: { pi: native },
      providerInstances: { legacy: { driver: "acp" } },
    });
    expect(migrateLegacyPiSettings(migrated)).toEqual(migrated);
  });
  it("retains native configuration when the legacy instance occupies the Pi id", () => {
    const native = {
      enabled: true,
      binaryPath: "/custom/native-pi",
      launchArgs: "--extension work",
      customModels: ["custom-model"],
    };
    expect(
      migrateLegacyPiSettings({
        providers: { pi: native },
        providerInstances: { pi: { driver: "pi", config: { binaryPath: "pi-acp" } } },
      }),
    ).toMatchObject({
      providers: { pi: native },
      providerInstances: {
        pi: { driver: "acp" },
        "pi-native": { driver: "pi", enabled: true, config: native },
      },
    });
  });
  it("does not migrate fresh or native settings", () => {
    for (const input of [
      {},
      { providers: { pi: { binaryPath: "pi" } } },
      {
        providerInstances: {
          pi: {
            driver: "pi",
            config: { binaryPath: "/custom/pi", launchArgs: "--extension work" },
          },
        },
      },
    ])
      expect(migrateLegacyPiSettings(input)).toBe(input);
  });
  it("does not overwrite an existing native instance or occupied instance id", () => {
    const input = {
      providers: { pi: { enabled: true } },
      providerInstances: { "pi-native": { driver: "acp", config: { binaryPath: "other" } } },
    };
    expect(migrateLegacyPiSettings(input)).toMatchObject({
      providerInstances: {
        "pi-native": input.providerInstances["pi-native"],
        "pi-native-2": { driver: "pi" },
      },
    });
  });
});
