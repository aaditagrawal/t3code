# CI quality gates

- `.github/workflows/ci.yml` runs `vp check`, `vpr typecheck`, and `vp run test` on pull requests and pushes to `main`.
- `.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), Windows (`x64`), and an installable Android APK from a single `v*.*.*` tag and publishes one GitHub release.
- The release workflow auto-enables persistent signing when platform credentials are present. macOS passkey builds additionally require `APPLE_TEAM_ID` and the `MACOS_PROVISIONING_PROFILE` secret; Windows uses Azure Trusted Signing. Android uses the configured release keystore or, when all Android signing secrets are absent, an ephemeral CI key that produces an installable APK but cannot upgrade APKs signed by another release.
- See [Release Checklist](./release.md) for the full release/signing setup checklist.
