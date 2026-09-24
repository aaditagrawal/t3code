/** Identifiers that let this fork coexist with an upstream installation. */
export const FORK_SLUG = "t3code-fork";
export const APP_BASE_NAME = "T3 Code Fork";

/** Server state; T3CODE_HOME and --base-dir still override this default. */
export const HOME_DIR_NAME = ".t3code-fork";
/** Historical home used only to locate existing fork state for import. */
export const LEGACY_HOME_DIR_NAME = ".t3";

export const DEFAULT_SERVER_PORT = 3873;
export const DEV_BASE_SERVER_PORT = 13873;
export const DEV_BASE_WEB_PORT = 5833;

export const DESKTOP_APP_ID = "com.t3tools.t3code.fork";
export const DESKTOP_APP_ID_DEV = "com.t3tools.t3code.fork.dev";
/** Electron keys its single-instance lock on the userData directory. */
export const DESKTOP_USER_DATA_DIR_NAME = "t3code-fork";
export const DESKTOP_USER_DATA_DIR_NAME_DEV = "t3code-fork-dev";

export const URL_SCHEME = "t3code-fork";
export const URL_SCHEME_DEV = "t3code-fork-dev";
export const LINUX_DESKTOP_ENTRY_NAME = "t3code-fork";
export const LINUX_WM_CLASS = "t3code-fork";
export const CLI_BIN_NAME = "t3f";

/** Keep the workspace package identity separate from its installed CLI name. */
export const NPM_PACKAGE_NAME = "t3";
export const LEGACY_IMPORT_MARKER_FILENAME = "migrated-from-legacy-home.json";
