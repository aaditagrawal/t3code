import { type FxSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  makeStandardAcpAdapter,
  type StandardAcpAdapterLiveOptions,
} from "./StandardAcpAdapter.ts";

const PROVIDER = ProviderDriverKind.make("fx");

export function makeFxAdapter(settings: FxSettings, options?: StandardAcpAdapterLiveOptions) {
  return makeStandardAcpAdapter(
    {
      provider: PROVIDER,
      defaultInstanceId: ProviderInstanceId.make("fx"),
      label: "Fx",
      makeRuntime: (input) =>
        makeStandardAcpCliRuntime({
          ...input,
          command: settings.binaryPath || "fx",
          args: ["acp"],
          ...(options?.environment ? { environment: options.environment } : {}),
        }),
      normalizeModel: (model) => normalizeStandardAcpModel(model, PROVIDER),
      currentModelFromSetup: (setup) => {
        const modelOption = setup.configOptions?.find(
          (option) => option.category === "model" || option.id === "model",
        );
        return modelOption?.type === "select" ? modelOption.currentValue : undefined;
      },
      applyModelSelection: (input) => {
        if (
          input.requestedModelId === undefined ||
          input.requestedModelId === input.currentModelId
        ) {
          return Effect.succeed(input.currentModelId);
        }
        return input.runtime
          .setModel(input.requestedModelId)
          .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
      },
    },
    options,
  );
}
