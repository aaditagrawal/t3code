# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Command line

```bash
curl -fsSL https://raw.githubusercontent.com/aaditagrawal/t3code/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/aaditagrawal/t3code/main/scripts/install.ps1 | iex
```

This puts `t3f` in `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `T3CODE_CHANNEL=nightly` to install the nightly train, or
`T3CODE_VERSION` to pin an exact version.

| Task                                             | Command                                                    |
| ------------------------------------------------ | ---------------------------------------------------------- |
| Start the server and open the web app            | `t3f`                                                      |
| Start the server without a browser               | `t3f serve`                                                |
| Keep it running in the background (macOS, Linux) | `t3f service install` ([details](./background-service.md)) |
| Move to the newest release                       | `t3f update`                                               |
| Remove it again                                  | `t3f uninstall`                                            |

Run `t3f --help` for the full reference.

The npm package `t3` installs the upstream distribution. This fork publishes its CLI
archives through its GitHub releases. It stores state in `~/.t3code-fork` by default.

### Intel Macs

There is no `t3f` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with Node.js 24 and `vp`
([Install vp](https://github.com/aaditagrawal/t3code#install-vp)):

```bash
git clone https://github.com/aaditagrawal/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`t3f update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download this fork from [GitHub Releases](https://github.com/aaditagrawal/t3code/releases).
The package-manager commands below install the upstream distribution:

| Platform           | Install                         |
| ------------------ | ------------------------------- |
| Windows            | `winget install T3Tools.T3Code` |
| macOS              | `brew install --cask t3-code`   |
| Arch Linux         | `yay -S t3code-bin`             |
| Arch Linux nightly | `yay -S t3code-nightly-bin`     |

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. T3 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
t3f app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `t3f app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install T3 Code from the
[App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Uses the Cursor SDK. Set `CURSOR_API_KEY` in the provider instance environment.              |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                            |
| Pi          | Install [Pi](https://pi.dev), then run `pi` once to finish its login or API-key setup.       |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when T3 Code can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Oh My Pi](./providers-ohmypi.md), and [Pi](./providers-pi.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers.

### Additional fork providers

The fork also supports Droid, Amp, Copilot, Gemini CLI, Kilo, Oh My Pi, Pi, Hermes, Fx,
and configurable ACP agents. Enable and configure each instance under **Settings → Providers**
on the machine that runs it. Keep credentials and configuration scoped to that instance.

[Oh My Pi](./providers-ohmypi.md) starts as `omp acp`; configure the executable as `omp`, without adding the subcommand.
Use the configurable ACP provider for other agents that expose stdio ACP.
