const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Keep ACP instance identities stable when native Pi becomes the built-in driver. */
export function migrateLegacyPiSettings(value: unknown): unknown {
  if (!isRecord(value) || value.piNativeSettingsMigrated === true) return value;
  const providers = isRecord(value.providers) ? value.providers : {};
  const instances = isRecord(value.providerInstances) ? { ...value.providerInstances } : {};
  const nativeConfig = (config: Record<string, unknown>) =>
    Object.hasOwn(config, "launchArgs") || config.binaryPath === "pi";
  let migrated = false;
  const preserveAcp = (instance: Record<string, unknown>, config: Record<string, unknown>) => ({
    ...instance,
    driver: "acp",
    displayName: instance.displayName ?? "Pi (ACP)",
    config: { ...config, binaryPath: config.binaryPath || "pi-acp" },
  });
  for (const [id, instance] of Object.entries(instances)) {
    if (!isRecord(instance) || instance.driver !== "pi") continue;
    const config = isRecord(instance.config) ? instance.config : {};
    if (nativeConfig(config)) continue;
    instances[id] = preserveAcp(instance, config);
    migrated = true;
  }
  const legacyPi = isRecord(providers.pi) ? providers.pi : undefined;
  const legacyDefault = legacyPi !== undefined && !nativeConfig(legacyPi);
  if (legacyPi !== undefined && legacyDefault && !Object.hasOwn(instances, "pi")) {
    instances.pi = preserveAcp({ enabled: legacyPi.enabled ?? true }, legacyPi);
    migrated = true;
  }
  if (!migrated && !legacyDefault) return value;
  // The built-in Pi id is occupied by the preserved ACP instance. Give native
  // Pi a separate discoverable instance without changing existing model picks.
  if (Object.hasOwn(instances, "pi")) {
    const hasNative = Object.values(instances).some(
      (entry) => isRecord(entry) && entry.driver === "pi",
    );
    if (!hasNative) {
      let id = "pi-native";
      for (let suffix = 2; Object.hasOwn(instances, id); suffix++) id = `pi-native-${suffix}`;
      const existingNativeConfig =
        legacyPi !== undefined && nativeConfig(legacyPi) ? legacyPi : undefined;
      instances[id] = {
        driver: "pi",
        displayName: "Pi",
        enabled:
          existingNativeConfig === undefined ? false : (existingNativeConfig.enabled ?? true),
        config: existingNativeConfig ?? { binaryPath: "pi", launchArgs: "" },
      };
    }
  }
  return {
    ...value,
    piNativeSettingsMigrated: true,
    providers: legacyDefault
      ? { ...providers, pi: { enabled: false, binaryPath: "pi", launchArgs: "" } }
      : providers,
    providerInstances: instances,
  };
}
