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

User skills are immediate subdirectories of `~/.omp/agent/skills`, each with a
`SKILL.md` file containing a description in its YAML frontmatter. Use `$` in the
composer to add a skill. Skills also appear in the `/` menu unless you turn off
**Settings → General → Show skills in slash menu**. See
[commands and skills](./composer.md#commands-and-skills).

To use a different agent directory, set `PI_CODING_AGENT_DIR` on the provider
instance. T3 Code reads `skills/` and `config.yml` (or `config.yaml`) directly
under that directory. `PI_CONFIG_DIR` changes the directory name under the
provider's home (default `.omp`). A named `OMP_PROFILE` or `PI_PROFILE` selects
`~/.omp/profiles/<name>/agent` and takes precedence over `PI_CODING_AGENT_DIR`.
`OMP_PROFILE` takes precedence over `PI_PROFILE`; an empty value selects the
default profile.

Discovery respects `skills.enabled`, `skills.enablePiUser`,
`skills.customDirectories`, `skills.ignoredSkills`, `skills.includeSkills`, and
`disabledExtensions` entries such as `skill:review` in the agent configuration.
Use absolute paths or `~/` paths for custom directories so discovery does not
depend on the server working directory. Custom directories take precedence over
native skills with the same name.
Skills with `enabled: false` in their frontmatter are omitted.

Slash commands advertised by `omp` over ACP are listed with other provider
commands. Those commands must start the message to run.

## Approvals

Oh My Pi follows the shared [permission modes](./permission-modes.md).
**Always allow this session** remembers the matching command or tool input for
the rest of that thread. Other actions still require approval.

## Not Pi

Pi remains its own provider: install `@earendil-works/pi-coding-agent` with
`pi-acp`, then authenticate with `pi`. Oh My Pi stays on `omp acp`.
