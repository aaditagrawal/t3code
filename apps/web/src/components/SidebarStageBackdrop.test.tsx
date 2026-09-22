import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarArtworkVariant,
  resolveSidebarStageBackdropVariant,
  StageBackdropArt,
} from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("resolves stage artwork only when enabled", () => {
    expect(resolveSidebarStageBackdropVariant("Dev")).toBe("dev");
    expect(resolveSidebarStageBackdropVariant("Nightly")).toBe("nightly");
    expect(resolveSidebarStageBackdropVariant("Dev", false)).toBeNull();
    expect(resolveSidebarStageBackdropVariant("Alpha")).toBeNull();
  });

  it("resolves supported environment pill labels", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Dev")).toBe("Dev");
    expect(resolveEnvironmentIdentificationPillLabel("nightly")).toBe("Nightly");
    expect(resolveEnvironmentIdentificationPillLabel("Latest")).toBe("Latest");
    expect(resolveEnvironmentIdentificationPillLabel("Alpha")).toBe("Alpha");
    expect(resolveEnvironmentIdentificationPillLabel("unknown")).toBeNull();
  });

  it("can show Nightly artwork without changing the environment stage", () => {
    expect(resolveSidebarArtworkVariant("Alpha", "nightly-artwork")).toBe("nightly");
    expect(resolveSidebarArtworkVariant("Latest", "nightly-artwork")).toBe("nightly");
    expect(resolveSidebarArtworkVariant("Alpha", "artwork")).toBeNull();
    expect(resolveSidebarArtworkVariant("Nightly", "artwork")).toBe("nightly");
    expect(resolveSidebarArtworkVariant("Nightly", "pill")).toBeNull();
    expect(resolveSidebarArtworkVariant("Nightly", "none")).toBeNull();
  });

  it.each(["nightly", "dev"] as const)(
    "uses unique SVG definition ids when %s artwork is rendered more than once",
    (variant) => {
      const markup = renderToStaticMarkup(
        <>
          <StageBackdropArt variant={variant} />
          <StageBackdropArt variant={variant} />
        </>,
      );
      const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});
