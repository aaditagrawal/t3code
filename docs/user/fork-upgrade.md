# Upgrading the fork

T3 Code Fork keeps its state in `~/.t3code-fork`. The upstream app uses `~/.t3`. The fork also uses a separate desktop profile, application ID, URL scheme, and default port so both installations can run together.

On startup with the default home, the fork looks through previous homes for a fork database, newest home first. The previous home is currently `~/.t3`. Inside a home it prefers `userdata/statev2.sqlite`, then `userdata/state.sqlite`. A database written only by upstream is left in place. An incompatible or unreadable database is left in place and the server logs the reason.

The import copies the database, settings, secrets, and attachments. It does not move the original files. Existing git worktrees keep their original locations; the new home links to the old worktrees directory. **Do not delete a previous home after upgrading** while those worktrees are still in use.

A destination database that already contains projects or threads is left alone. An empty database from opening the new home once is replaced by the older history. A completed import is recorded and is not repeated. Custom state directories are not imported automatically. You can continue using a chosen directory with `T3CODE_HOME` or `--base-dir`; the database must have a migration history compatible with the running build.

A later update that renames the home or the database file uses the same import. The previous home and the previous database filename stay on the list the new build reads, so history already imported into `~/.t3code-fork` is still found.

Settings → Existing conversations can import Codex and Claude sessions. Titles and in-use checks read the current official database, `statev2.sqlite` when it exists and otherwise `state.sqlite`.

The desktop app also copies the first available legacy profile into its new profile directory, skipping caches and process locks. Mobile builds install under a new application ID and need to be paired again.

The installed CLI is `t3f`. The default server port is `3873`. Existing custom ports continue to work.
