// Imported by repo-relative path rather than as `@t3tools/shared/branding`
// because `app.config.ts` imports this module too, and Expo reads the config
// through a CommonJS loader that cannot resolve that package's `import`-only
// export map. Keeping one module means the config and the runtime linking
// prefixes can never disagree about which schemes this app answers to.
import { URL_SCHEME, URL_SCHEME_DEV } from "../../../../packages/shared/src/branding.ts";

/**
 * Custom URL scheme registered by the `preview` build variant. Production and
 * development schemes are shared with the desktop build; the preview variant is
 * mobile-only, so its scheme is derived here.
 */
export const PREVIEW_URL_SCHEME = `${URL_SCHEME}-preview`;

/**
 * Every scheme any variant of this app registers, in the order `app.config.ts`
 * declares the variants.
 *
 * Deep links must be accepted regardless of which variant is installed: a link
 * minted by one build is routinely opened on another (QR pairing, share sheet,
 * widget taps), and this linking config is compiled into all of them.
 */
export const APP_URL_SCHEMES: readonly string[] = [URL_SCHEME, URL_SCHEME_DEV, PREVIEW_URL_SCHEME];
