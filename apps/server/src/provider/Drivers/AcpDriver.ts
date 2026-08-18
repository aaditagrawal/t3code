import { AcpSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { makeAcpAdapter } from "../Layers/AcpAdapter.ts";
import { makeStandardAcpCliDriver, type StandardAcpCliDriverEnv } from "./StandardAcpCliDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("acp");
const decodeSettings = Schema.decodeSync(AcpSettings);

export type AcpDriverEnv = StandardAcpCliDriverEnv;

export const AcpDriver = makeStandardAcpCliDriver({
  driverKind: DRIVER_KIND,
  displayName: "ACP Agent",
  defaultBinary: "acp-agent",
  settingsSchema: AcpSettings,
  defaultSettings: () => decodeSettings({}),
  makeAdapter: makeAcpAdapter,
  setupHint:
    "Configure the executable, arguments, credentials, and model required by the ACP agent.",
  missingCommandMessage: "The configured ACP agent executable is not installed or not on PATH.",
});
