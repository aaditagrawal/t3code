/** Shared identifiers for installing the fork alongside official T3. */
export const FORK_SLUG = "t3code-fork";
export const APP_BASE_NAME = "T3 Code Fork";

/** Default server state root under the user's home directory. */
export const HOME_DIR_NAME = ".t3code-fork";
/** Standalone server default; desktop instances select an available port. */
export const DEFAULT_SERVER_PORT = 3873;

export const DESKTOP_APP_ID = "com.t3tools.t3code.fork";
export const DESKTOP_APP_ID_DEV = "com.t3tools.t3code.fork.dev";
/** Separate Electron storage also gives this fork its own single-instance lock. */
export const DESKTOP_USER_DATA_DIR_NAME = "t3code-fork";
export const DESKTOP_USER_DATA_DIR_NAME_DEV = "t3code-fork-dev";
export const URL_SCHEME = "t3code-fork";
export const URL_SCHEME_DEV = "t3code-fork-dev";
export const LINUX_DESKTOP_ENTRY_NAME = "t3code-fork";
export const LINUX_WM_CLASS = "t3code-fork";
/** Internal workspace package name; this does not rename the installed desktop app. */
export const NPM_PACKAGE_NAME = "t3";
