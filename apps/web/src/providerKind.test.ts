import { describe, expect, it } from "vite-plus/test";

import { isProviderKind, PROVIDER_KINDS } from "./providerKind";

describe("ProviderKind", () => {
  it("recognizes Oh My Pi as a built-in provider kind", () => {
    expect(PROVIDER_KINDS).toContain("ohMyPi");
    expect(isProviderKind("ohMyPi")).toBe(true);
  });
});
