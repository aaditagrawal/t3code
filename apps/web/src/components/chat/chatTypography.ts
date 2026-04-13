// FILE: chatTypography.ts
// Purpose: Centralizes transcript typography tokens shared by chat message renderers.
// Layer: Web chat presentation constants
// Exports: transcript measurement helpers and inline styles for chat text

import type { CSSProperties } from "react";
const DEFAULT_CHAT_FONT_SIZE_PX = 14;
const MIN_CHAT_FONT_SIZE_PX = 10;
const MAX_CHAT_FONT_SIZE_PX = 24;
function normalizeChatFontSizePx(size: number | undefined): number {
  if (size === undefined) return DEFAULT_CHAT_FONT_SIZE_PX;
  return Math.max(MIN_CHAT_FONT_SIZE_PX, Math.min(MAX_CHAT_FONT_SIZE_PX, Math.round(size)));
}

const CHAT_TRANSCRIPT_USER_CHAR_WIDTH_RATIO = 0.6;
const CHAT_TRANSCRIPT_ASSISTANT_CHAR_WIDTH_RATIO = 0.52;

export function getChatTranscriptLineHeightPx(chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX): number {
  return normalizeChatFontSizePx(chatFontSizePx) + 8;
}

export function getChatTranscriptUserCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return normalizeChatFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_USER_CHAR_WIDTH_RATIO;
}

export function getChatTranscriptAssistantCharWidthPx(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): number {
  return normalizeChatFontSizePx(chatFontSizePx) * CHAT_TRANSCRIPT_ASSISTANT_CHAR_WIDTH_RATIO;
}

export function getChatTranscriptTextStyle(
  chatFontSizePx = DEFAULT_CHAT_FONT_SIZE_PX,
): CSSProperties {
  const normalizedChatFontSizePx = normalizeChatFontSizePx(chatFontSizePx);
  return {
    fontSize: `${normalizedChatFontSizePx}px`,
    lineHeight: `${getChatTranscriptLineHeightPx(normalizedChatFontSizePx)}px`,
  };
}
