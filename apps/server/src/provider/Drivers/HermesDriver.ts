import { HermesSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { makeHermesAdapter } from "../Layers/HermesAdapter.ts";
import { makeStandardAcpCliDriver, type StandardAcpCliDriverEnv } from "./StandardAcpCliDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("hermes");
const decodeSettings = Schema.decodeSync(HermesSettings);

export type HermesDriverEnv = StandardAcpCliDriverEnv;

export const HermesDriver = makeStandardAcpCliDriver({
  driverKind: DRIVER_KIND,
  displayName: "Hermes Agent",
  defaultBinary: "hermes-acp",
  settingsSchema: HermesSettings,
  defaultSettings: () => decodeSettings({}),
  makeAdapter: makeHermesAdapter,
  excludedAuthMethodIds: new Set(["hermes-setup"]),
  setupHint: "Run `hermes-acp --setup` to configure Hermes credentials.",
  missingCommandMessage: "Hermes Agent (`hermes-acp`) is not installed or not on PATH.",
  homeEnvVarName: "HERMES_HOME",
});
