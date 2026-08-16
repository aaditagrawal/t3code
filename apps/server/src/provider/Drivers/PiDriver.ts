import { PiSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { makePiAdapter } from "../Layers/PiAdapter.ts";
import { makeStandardAcpCliDriver, type StandardAcpCliDriverEnv } from "./StandardAcpCliDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("pi");
const decodeSettings = Schema.decodeSync(PiSettings);

export type PiDriverEnv = StandardAcpCliDriverEnv;

export const PiDriver = makeStandardAcpCliDriver({
  driverKind: DRIVER_KIND,
  displayName: "Pi",
  defaultBinary: "pi-acp",
  settingsSchema: PiSettings,
  defaultSettings: () => decodeSettings({}),
  makeAdapter: makePiAdapter,
  setupHint:
    "Install both `pi-acp` and `@earendil-works/pi-coding-agent`, then authenticate with `pi`.",
  missingCommandMessage: "Pi ACP (`pi-acp`) is not installed or not on PATH.",
});
