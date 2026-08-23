import { type OhMyPiSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import {
  applyStandardAcpConfigOptionModelSelection,
  currentStandardAcpConfigOptionModelFromSetup,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("ohMyPi");

export function ohMyPiLaunchCommand(settings: OhMyPiSettings): {
  readonly command: string;
  readonly args: readonly ["acp"];
} {
  return { command: settings.binaryPath || "omp", args: ["acp"] };
}

export function makeOhMyPiAdapter(
  settings: OhMyPiSettings,
  options?: StandardAcpAdapterLiveOptions,
) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("ohMyPi"),
      label: "Oh My Pi",
      makeRuntime: (input) => {
        const launch = ohMyPiLaunchCommand(settings);
        return makeStandardAcpCliRuntime({
          ...input,
          ...launch,
          ...(options?.environment ? { environment: options.environment } : {}),
        });
      },
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: currentStandardAcpConfigOptionModelFromSetup,
      applyModelSelection: applyStandardAcpConfigOptionModelSelection,
      modelSelectionMethod: "session/set_config_option",
      formElicitation: true,
    },
    options,
  );
}
