#!/bin/sh
# Install the T3 Code gateway plugin into the active Hermes profile.
#
# Symlinks this directory into "$HERMES_HOME/plugins/hermes-t3-gateway" (the
# documented user-plugin path, hermes_cli/plugins.py:10) and enables it.
# Safe to re-run: an existing correct symlink is left alone, and enabling an
# already-enabled plugin is a no-op in Hermes.

set -eu

PLUGIN_NAME="hermes-t3-gateway"
SOURCE_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
HERMES_HOME_DIR=${HERMES_HOME:-"$HOME/.hermes"}
PLUGINS_DIR="$HERMES_HOME_DIR/plugins"
TARGET="$PLUGINS_DIR/$PLUGIN_NAME"

if ! command -v hermes >/dev/null 2>&1; then
	cat >&2 <<EOF
✗ \`hermes\` was not found on PATH.

  This script installs a plugin into an existing Hermes Agent install; it
  cannot create one. Install Hermes Agent first, then make sure its CLI is on
  PATH (a default install puts it in ~/.local/bin):

    export PATH="\$HOME/.local/bin:\$PATH"

  Then re-run: $0
EOF
	exit 1
fi

mkdir -p "$PLUGINS_DIR"

if [ -L "$TARGET" ]; then
	CURRENT=$(readlink "$TARGET")
	if [ "$CURRENT" = "$SOURCE_DIR" ]; then
		echo "• Already linked: $TARGET -> $SOURCE_DIR"
	else
		echo "• Relinking $TARGET (was -> $CURRENT)"
		rm -f "$TARGET"
		ln -s "$SOURCE_DIR" "$TARGET"
	fi
elif [ -e "$TARGET" ]; then
	cat >&2 <<EOF
✗ $TARGET already exists and is not a symlink.

  Refusing to replace it — it may be a real plugin install with local changes.
  Inspect it, then remove or rename it and re-run this script:

    ls -la "$TARGET"
EOF
	exit 1
else
	ln -s "$SOURCE_DIR" "$TARGET"
	echo "• Linked $TARGET -> $SOURCE_DIR"
fi

echo "• Enabling $PLUGIN_NAME"
# --no-allow-tool-override: this plugin registers a platform adapter and two
# observer hooks. It never replaces a built-in tool, and passing the flag keeps
# the run non-interactive instead of stopping on the consent prompt.
hermes plugins enable "$PLUGIN_NAME" --no-allow-tool-override

cat <<EOF

✓ $PLUGIN_NAME is installed and enabled.

Next steps:

  1. In T3 Code, add or open a Hermes provider instance, expand "Hermes
     companion", create a one-time enrollment, and copy the generated command.
     Paste and run it:

       hermes t3 connect --url <t3-url> --token <one-time-token>

  2. Restart the gateway so it picks up the new connection:

       hermes gateway restart

  Verify anytime with: hermes t3 status
EOF
