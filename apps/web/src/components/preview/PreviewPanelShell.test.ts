import { describe, expect, it } from "vite-plus/test";

import { getPreviewPanelMaxWidth } from "./PreviewPanelShell";

describe("getPreviewPanelMaxWidth", () => {
  it("allows the panel to use 70% of the available chat+preview row without a pixel ceiling", () => {
    expect(getPreviewPanelMaxWidth(6_000)).toBe(4_200);
  });

  it("rounds fractional CSS pixels down", () => {
    expect(getPreviewPanelMaxWidth(2_001)).toBe(1_400);
  });

  it("leaves chat room when the available row is narrower than the viewport", () => {
    // e.g. 6000px viewport minus a 2000px left sidebar → 4000px row
    expect(getPreviewPanelMaxWidth(4_000)).toBe(2_800);
  });
});
