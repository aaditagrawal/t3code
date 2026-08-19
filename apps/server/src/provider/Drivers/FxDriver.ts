import { FxSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { makeFxAdapter } from "../Layers/FxAdapter.ts";
import { makeStandardAcpCliDriver, type StandardAcpCliDriverEnv } from "./StandardAcpCliDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("fx");
const decodeSettings = Schema.decodeSync(FxSettings);

export type FxDriverEnv = StandardAcpCliDriverEnv;

export const FxDriver = makeStandardAcpCliDriver({
  driverKind: DRIVER_KIND,
  displayName: "Fx",
  defaultBinary: "fx",
  launchArgs: ["acp"],
  settingsSchema: FxSettings,
  defaultSettings: () => decodeSettings({}),
  makeAdapter: makeFxAdapter,
  setupHint: "Install Fx from https://fx.sh and authenticate with `fx login` or `fx setup`.",
  missingCommandMessage: "Fx CLI (`fx`) is not installed or not on PATH.",
});
