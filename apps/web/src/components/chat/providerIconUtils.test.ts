import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { OhMyPiIcon, OpenAI } from "../Icons";
import { PROVIDER_OPTIONS } from "../../session-logic";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("Oh My Pi provider presentation", () => {
  it("uses the Oh My Pi mark instead of the Codex fallback", () => {
    const icon = PROVIDER_ICON_BY_PROVIDER[ProviderDriverKind.make("ohMyPi")];

    expect(icon).toBe(OhMyPiIcon);
    expect(icon).not.toBe(OpenAI);
  });

  it("advertises Oh My Pi as an available provider", () => {
    expect(PROVIDER_OPTIONS).toContainEqual({
      value: "ohMyPi",
      label: "Oh My Pi",
      available: true,
    });
  });
});
