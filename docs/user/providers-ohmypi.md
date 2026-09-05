# Oh My Pi

T3 Code runs [Oh My Pi](https://github.com/can1357/oh-my-pi) (`omp`) as a
Standard ACP agent over stdio. It is a separate provider from [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
(`pi-acp`). This fork does not merge the two.

[Provider setup](./install.md#providers) covers enabling the instance, a custom
binary path, and environment variables.

## Install and sign in

Install `omp` on the environment that runs your project, then enable **Oh My Pi**
in **Settings > Providers**.

```bash
bun install -g @oh-my-pi/pi-coding-agent
```

Other installers are listed in the [Oh My Pi README](https://github.com/can1357/oh-my-pi#install),
including `curl -fsSL https://omp.sh/install | sh` and Homebrew
`can1357/tap/omp`.

Run `omp` and use `/login` to authenticate. T3 Code launches `omp acp`. Set
**Binary path** to `omp` or a full path to that executable; do not add the `acp`
subcommand.

After changing login or configuration, use **Refresh provider status** in web or
desktop provider settings, or **Refresh models** in mobile thread settings.

## Skills and slash commands

User skills are directories with a `SKILL.md` file. T3 Code reads them from:

- `~/.omp/agent/skills` (Oh My Pi's usual user skills directory)
- `~/.omp/skills`

If both define the same name, the `agent/skills` copy is listed. Use `$` in the
composer to add a skill. Skills also appear in the `/` menu unless you turn off
**Settings → General → Show skills in slash menu**. See
[commands and skills](./composer.md#commands-and-skills).

To use a different Oh My Pi home, set `PI_CODING_AGENT_DIR` on the provider
instance. T3 Code then reads `agent/skills` and `skills` under that directory.
`PI_CONFIG_DIR` changes the directory name under your home (default `.omp`).
`OMP_PROFILE` or `PI_PROFILE` selects `~/.omp/profiles/<name>` when
`PI_CODING_AGENT_DIR` is unset.

Slash commands advertised by `omp` over ACP are listed with other provider
commands. Those commands must start the message to run.

## Approvals

Oh My Pi follows the shared [permission modes](./permission-modes.md).
**Always allow this session** remembers the matching command or tool input for
the rest of that thread. Other actions still require approval.

## Not Pi

Pi remains its own provider: install `@earendil-works/pi-coding-agent` with
`pi-acp`, then authenticate with `pi`. Oh My Pi stays on `omp acp`.
