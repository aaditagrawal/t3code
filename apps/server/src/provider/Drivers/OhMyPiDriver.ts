import { OhMyPiSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { makeOhMyPiAdapter } from "../Layers/OhMyPiAdapter.ts";
import { makeStandardAcpCliDriver, type StandardAcpCliDriverEnv } from "./StandardAcpCliDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("ohMyPi");
const decodeSettings = Schema.decodeSync(OhMyPiSettings);

export type OhMyPiDriverEnv = StandardAcpCliDriverEnv;

export const makeOhMyPiProbeArgs = Effect.fn("makeOhMyPiProbeArgs")(function* (
  args: ReadonlyArray<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const sessionDir = yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-oh-my-pi-probe-",
  });
  return [...args, "--session-dir", sessionDir];
});

export const OhMyPiDriver = makeStandardAcpCliDriver({
  driverKind: DRIVER_KIND,
  displayName: "Oh My Pi",
  defaultBinary: "omp",
  launchArgs: ["acp"],
  settingsSchema: OhMyPiSettings,
  defaultSettings: () => decodeSettings({}),
  makeAdapter: makeOhMyPiAdapter,
  makeProbeArgs: makeOhMyPiProbeArgs,
  setupHint:
    "Install `@oh-my-pi/pi-coding-agent`, then run `omp` and use `/login` to authenticate.",
  missingCommandMessage: "Oh My Pi CLI (`omp`) is not installed or not on PATH.",
});
