# Upgrading the fork

T3 Code Fork keeps its state in `~/.t3code-fork`. The upstream app uses `~/.t3`. The fork also uses a separate desktop profile, application ID, URL scheme, and default port so both installations can run together.

On the first start with the default home, the fork checks for an older fork database in `~/.t3/userdata`. It imports compatible fork data once. A database written only by upstream is not imported. An incompatible or unreadable database is left in place and the server logs the reason.

The import copies the database, settings, secrets, and attachments. It does not move the original files. Existing git worktrees keep their original locations; the new home links to the old worktrees directory. **Do not delete `~/.t3` after upgrading** while those worktrees are still in use.

An existing destination database or import marker prevents another import. Custom state directories are not imported automatically. You can continue using a chosen directory with `T3CODE_HOME` or `--base-dir`; the database must have a migration history compatible with the running build.

The desktop app also copies the first available legacy profile into its new profile directory, skipping caches and process locks. Mobile builds install under a new application ID and need to be paired again.

The installed CLI is `t3f`. The default server port is `3873`. Existing custom ports continue to work.
