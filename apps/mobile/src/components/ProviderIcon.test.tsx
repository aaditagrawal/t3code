import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native-svg", () => ({
  Circle: "Circle",
  Path: "Path",
  Rect: "Rect",
  Svg: "Svg",
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
});
