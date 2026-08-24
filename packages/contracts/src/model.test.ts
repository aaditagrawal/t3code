import { describe, expect, it } from "vite-plus/test";

import { PROVIDER_DISPLAY_NAMES } from "./model.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

describe("provider display names", () => {
  it("uses the product name for the Oh My Pi driver", () => {
    expect(PROVIDER_DISPLAY_NAMES[ProviderDriverKind.make("ohMyPi")]).toBe("Oh My Pi");
  });
});
