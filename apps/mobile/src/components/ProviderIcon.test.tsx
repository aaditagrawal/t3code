import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ View: "View" }));

vi.mock("react-native-svg", () => ({
  Circle: "Circle",
  Path: "Path",
  Rect: "Rect",
  Svg: "Svg",
}));

vi.mock("expo-image", () => ({
  Image: "Image",
}));

vi.mock("../features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));

import { ProviderIcon } from "./ProviderIcon";

describe("ProviderIcon", () => {
  it("renders the Oh My Pi mark instead of the Codex fallback", () => {
    const icon = ProviderIcon({ provider: "ohMyPi", size: 24 });

    expect(icon.type).toBe("Svg");
    expect(icon.props).toMatchObject({
      width: 24,
      height: 24,
      viewBox: "0 0 120 90",
    });
    expect(icon.props.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Rect",
          props: expect.objectContaining({ fill: "#f97316" }),
        }),
      ]),
    );
  });

  it.each([
    ["amp", "0 0 24 24"],
    ["copilot", "0 0 256 208"],
    ["droid", "0 0 508 508"],
    ["geminiCli", "0 0 296 298"],
    ["kilo", "0 0 24 24"],
  ] as const)("renders the %s mark instead of the Codex fallback", (provider, viewBox) => {
    const icon = ProviderIcon({ provider, size: 16 });

    expect(icon.props).toMatchObject({ viewBox });
  });
});
