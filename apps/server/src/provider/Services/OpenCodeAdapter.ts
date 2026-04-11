import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface OpenCodeAdapterShape extends Omit<
  ProviderAdapterShape<ProviderAdapterError>,
  "provider"
> {
  readonly provider: "opencode";
}

export class OpenCodeAdapter extends Context.Service<OpenCodeAdapter, OpenCodeAdapterShape>()(
  "t3/provider/Services/OpenCodeAdapter",
) {}
