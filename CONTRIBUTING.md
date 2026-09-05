# Contributing to T3 Code

First off, thank you for considering contributing to this fork! It's people like you that make the open-source community such an amazing place to learn, inspire, and create.

## Developer Setup

See the [maintainer scripts guide](docs/operations/development.md#first-checkout) for the initial checkout,
development commands, tests, and platform-specific desktop packaging prerequisites.

This fork is maintained in [aaditagrawal/t3code](https://github.com/aaditagrawal/t3code) and focuses on expanding provider support, preserving usage and limit monitoring, and improving the core orchestration and persistence layers.

## Protected Fork Features

Pull requests and upstream syncs should preserve these four fork features unless the change explicitly replaces them with equivalent or better behavior:

1. Multi-provider runtime support across Codex CLI, Claude Code, Cursor, Droid, OpenCode, Amp, Copilot, Gemini CLI, and Kilo.
2. Usage and limit monitoring, including token/context usage, provider usage events, and rate-limit UI.
3. Provider management UX for custom instances, per-instance config/environment/model state, and provider-scoped traits.
4. Provider-neutral orchestration reliability for persistence, replay/live ordering, reconnects, restarts, and projections.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to see if the problem has already been reported. When you are creating a bug report, please include as many details as possible.

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please:

- Use a clear and descriptive title.
- Provide a step-by-step description of the suggested enhancement.
- Explain why this enhancement would be useful.

### Pull Requests

We welcome pull requests! To help us review your PR effectively, please:

1.  **Keep it focused:** Try to keep PRs small and focused on a single change.
2.  **Test your changes:** Ensure that your changes don't break existing functionality. Add new tests if possible.
3.  **Document your changes:** Update documentation (like the README) if your changes introduce new features or change existing ones.
4.  **Describe your PR:** Use the pull request template to describe what changed and why.
5.  **Target the fork explicitly:** When using GitHub CLI, run `gh pr create --repo aaditagrawal/t3code --base main`.

## Development Setup

1.  Clone the repository: `git clone https://github.com/aaditagrawal/t3code.git`
2.  Install dependencies: `pnpm install --frozen-lockfile`
3.  Run the development server: `pnpm dev`

## Code Style

Please try to match the existing code style. We use `oxlint` for linting and `oxfmt` for formatting.

---

Special thanks to the original creators at [Pingdotgg](https://github.com/pingdotgg) for the solid foundation.
