import { ProviderDriverKind, ProviderInstanceId, type PiSettings } from "@t3tools/contracts";

import {
  applyStandardAcpModelSelection,
  currentStandardAcpModelFromSetup,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("pi");

export function makePiAdapter(settings: PiSettings, options?: StandardAcpAdapterLiveOptions) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("pi"),
      label: "Pi",
      makeRuntime: (input) =>
        makeStandardAcpCliRuntime({
          ...input,
          command: settings.binaryPath || "pi-acp",
          ...(options?.environment ? { environment: options.environment } : {}),
        }),
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: currentStandardAcpModelFromSetup,
      applyModelSelection: applyStandardAcpModelSelection,
    },
    options,
  );
}
