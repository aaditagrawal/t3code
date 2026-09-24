import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeModeChoicesForSupportedModes, selectableChoices } from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  it("hides prompt-injected and workflow-trigger choices, keeping declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("runtimeModeChoicesForSupportedModes", () => {
  it("offers Droid medium access when the provider advertises it", () => {
    expect(
      runtimeModeChoicesForSupportedModes([
        "approval-required",
        "auto-accept-edits",
        "medium-access",
        "full-access",
      ]).map((choice) => choice.mode),
    ).toEqual(["approval-required", "auto-accept-edits", "medium-access", "full-access"]);
    expect(
      runtimeModeChoicesForSupportedModes(undefined).some(
        (choice) => choice.mode === "medium-access",
      ),
    ).toBe(false);
  });

  it("keeps controls usable when forward-compatible decoding removes every advertised mode", () => {
    expect(runtimeModeChoicesForSupportedModes([])).toHaveLength(4);
  });
});
