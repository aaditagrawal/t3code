import { ProviderDriverKind, ProviderInstanceId, type HermesSettings } from "@t3tools/contracts";

import {
  applyStandardAcpModelSelection,
  currentStandardAcpModelFromSetup,
  firstAdvertisedAuthMethod,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("hermes");
const SETUP_AUTH_METHODS = new Set(["hermes-setup"]);

export function makeHermesAdapter(
  settings: HermesSettings,
  options?: StandardAcpAdapterLiveOptions,
) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("hermes"),
      label: "Hermes Agent",
      makeRuntime: (input) =>
        makeStandardAcpCliRuntime({
          ...input,
          command: settings.binaryPath || "hermes-acp",
          ...(options?.environment ? { environment: options.environment } : {}),
          resolveAuthMethodId: (initializeResult) =>
            firstAdvertisedAuthMethod(initializeResult, SETUP_AUTH_METHODS),
        }),
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: currentStandardAcpModelFromSetup,
      applyModelSelection: applyStandardAcpModelSelection,
    },
    options,
  );
}
