// FILE: taskCompletion.tsx
// Purpose: Bridges thread completion and attention-needed events to in-app toasts and OS notifications.
// Layer: Notification runtime
// Exports: TaskCompletionNotifications and browser permission helpers
//
// NOTE: The full runtime implementation depends on store APIs (threads, threadsHydrated),
// desktop bridge notifications, and app settings (enableSystemTaskCompletionNotifications,
// enableTaskCompletionToasts) that are not yet available in this codebase. The component
// is stubbed to return null until those APIs land.

import { isElectron } from "../env";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported"
  | "insecure";

function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

// Browsers require secure contexts and a user gesture before asking for permission.
export function readBrowserNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof window === "undefined") {
    return "unsupported";
  }
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }
  if (!window.isSecureContext) {
    return "insecure";
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  const current = readBrowserNotificationPermissionState();
  if (current === "unsupported" || current === "insecure" || current === "denied") {
    return current;
  }
  if (current === "granted") {
    return current;
  }
  return Notification.requestPermission();
}

// Stubbed: the full component requires store.threads, store.threadsHydrated, desktop
// bridge notifications, and notification settings that are not yet wired in this fork.
export function TaskCompletionNotifications() {
  return null;
}

export function buildNotificationSettingsSupportText(
  permissionState: BrowserNotificationPermissionState,
): string {
  if (isElectron) {
    return "Desktop app notifications use your operating system notification center.";
  }
  switch (permissionState) {
    case "granted":
      return "Browser notifications are enabled for this app.";
    case "denied":
      return "Browser notifications are blocked. Re-enable them in your browser site settings.";
    case "insecure":
      return "Browser notifications need a secure context. Localhost works; plain HTTP does not.";
    case "unsupported":
      return "This browser does not support desktop notifications.";
    case "default":
      return "Allow browser notifications to get alerts when chats or terminal agents finish or need input in the background.";
  }
}
