import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface GeminiCliAdapterShape extends Omit<
  ProviderAdapterShape<ProviderAdapterError>,
  "provider"
> {
  readonly provider: "geminiCli";
}

export class GeminiCliAdapter extends Context.Service<GeminiCliAdapter, GeminiCliAdapterShape>()(
  "t3/provider/Services/GeminiCliAdapter",
) {}
