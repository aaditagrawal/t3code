# Prime Agent

Enable **Prime Agent** in **Settings > Providers** after installing and configuring the Prime Intellect CLI on the computer running your project. Set **Binary path** to `prime-agent` or its full executable path. T3 Code adds the ACP launch arguments automatically.

Add the model slugs you want to use under the provider's custom models. Prime Agent does not supply a model catalogue through this integration. The selected model and project directory are fixed when the session starts; choose a new thread to change models.

Prime Agent reads its own credentials. A ready status confirms that the executable runs, but does not verify authentication. Provider instance environment variables are passed to the CLI. **Config directory** selects a different agent directory through `PRIME_AGENT_CODING_AGENT_DIR`; leave it blank to use the CLI default.

This integration supports streamed replies, tool activity, permissions, and cancellation. It does not restore a provider conversation after a session restart or support conversation rewind. A restart opens a fresh provider session. Choose another provider for generated commit messages, pull request content, branch names, and thread titles.

Updates are managed through the Prime Agent CLI; T3 Code does not offer an in-app update action for this provider.
