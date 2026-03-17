#!/bin/bash

# Neuranet 3P App Unlinker
#
# Purpose:
# --------
# This script removes a previously mounted third-party (3P) application
# from the Neuranet runtime by deleting the symbolic link inside:
#
#   neuranet/backend/apps/neuranet/3p/
# ---------------------------------------------------------------------------
# Usage:
#
#   ./rmlink_from_nn.sh <symlink-name>

# Absolute path of directory where this script resides
# This is treated as the Neuranet installation root
NEURANET_ROOT="$( cd "$( dirname "$0" )" && pwd )"

# Neuranet 3rd-party runtime plugin directory
NEURANET_3P="$NEURANET_ROOT/backend/apps/neuranet/3p"

# Parent directory of Neuranet installation
# Used for resolving app names passed without paths
PARENT_DIR="$(dirname "$NEURANET_ROOT")"

# Ensure argument is passed
if [ -z "$1" ]; then
    echo "Usage: $0 [app-name | path-to-app]"
    exit 1
fi

INPUT="$1"

if [ -d "$INPUT" ]; then
    APP_NAME="$(basename "$(realpath "$INPUT")")"
elif [ -d "$PARENT_DIR/$INPUT" ]; then
    APP_NAME="$(basename "$(realpath "$PARENT_DIR/$INPUT")")"
else
    APP_NAME="$INPUT"
fi

# Symlink location inside Neuranet runtime
TARGET_LINK="$NEURANET_3P/$APP_NAME"

# Remove symlink only if it exists
if [ -L "$TARGET_LINK" ]; then
    rm "$TARGET_LINK"
    echo "Symlink removed:"
    echo "$TARGET_LINK"
else
    echo "No symlink found at:"
    echo "$TARGET_LINK"
fi