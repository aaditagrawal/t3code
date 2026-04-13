// @ts-nocheck
// FILE: useChatCodeFont.ts
// Purpose: Applies the optional chat-only code font family CSS variable from app settings.
// Layer: Web chat presentation hook
// Exports: useChatCodeFont

import { useEffect } from "react";

export function useChatCodeFont() {
  const chatCodeFontFamily = "";

  useEffect(() => {
    if (chatCodeFontFamily.trim()) {
      document.documentElement.style.setProperty(
        "--font-chat-code-family",
        chatCodeFontFamily.trim(),
      );
    } else {
      document.documentElement.style.removeProperty("--font-chat-code-family");
    }
  }, [chatCodeFontFamily]);
}
