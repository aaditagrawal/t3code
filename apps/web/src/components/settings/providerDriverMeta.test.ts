import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { OhMyPiIcon } from "../Icons";
import { deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { getDriverOption } from "./providerDriverMeta";

describe("Oh My Pi provider metadata", () => {
  it("uses the Oh My Pi identity and omp binary placeholder", () => {
    const option = getDriverOption(ProviderDriverKind.make("ohMyPi"));

    expect(option).toMatchObject({
      value: "ohMyPi",
      label: "Oh My Pi",
      icon: OhMyPiIcon,
      badgeLabel: "Fork Extension",
    });

    expect(deriveProviderSettingsFields(option!)).toContainEqual(
      expect.objectContaining({
        key: "binaryPath",
        placeholder: "omp",
      }),
    );
  });
});
