import { ProviderDriverKind, ProviderInstanceId, type AcpSettings } from "@t3tools/contracts";

import {
  applyStandardAcpModelSelection,
  currentStandardAcpModelFromSetup,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
  parseStandardAcpCliArguments,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("acp");

export function makeAcpAdapter(settings: AcpSettings, options?: StandardAcpAdapterLiveOptions) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("acp"),
      label: "ACP Agent",
      makeRuntime: (input) =>
        makeStandardAcpCliRuntime({
          ...input,
          command: settings.binaryPath || "acp-agent",
          args: parseStandardAcpCliArguments(settings.arguments),
          ...(options?.environment ? { environment: options.environment } : {}),
        }),
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: currentStandardAcpModelFromSetup,
      applyModelSelection: applyStandardAcpModelSelection,
    },
    options,
  );
}
