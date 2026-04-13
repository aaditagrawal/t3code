// @ts-nocheck
import { useEffect } from "react";

export function useUIFont() {
  const uiFontFamily = "";

  useEffect(() => {
    if (uiFontFamily.trim()) {
      document.documentElement.style.setProperty("--font-ui-family", uiFontFamily.trim());
    } else {
      document.documentElement.style.removeProperty("--font-ui-family");
    }
  }, [uiFontFamily]);
}
