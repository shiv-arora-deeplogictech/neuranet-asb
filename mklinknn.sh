#!/bin/bash

# Neuranet 3P App Linker
#
# Purpose:
# This/home/deep/TheNeuranet/neuranet/mklink_with_nn.sh script "mounts" any external application into the Neuranet runtime
# by creating a symbolic link inside:
#
#   neuranet/backend/apps/neuranet/3p/
#
# Usage:
#
#   ./mklinknn.sh <app-name>
#   ./mklinknn.sh <path-to-app> <symlink-name>
#
# Default symlink name is the source folder name.
# If a second argument is provided, it overrides this name
# and the symlink will be created using the provided alias.

# Examples:
#   ./mklinknn.sh ASB
#   ./mklinknn.sh /home/deep/apps/ASB asb
#
# Behaviour:
# ----------
# If only an app name is passed:
#   Script will search for it in:
#       Parent directory of Neuranet install
#


# Absolute path of directory where this script resides
# This is treated as the Neuranet installation root
NEURANET_ROOT="$( cd "$( dirname "$0" )" && pwd )"

# Neuranet 3rd-party applications directory (runtime plugin mount point)
NEURANET_3P="$NEURANET_ROOT/backend/apps/neuranet/3p"

# Parent directory of Neuranet installation
# External apps are expected to live here by default
PARENT_DIR="$(dirname "$NEURANET_ROOT")"

# Ensure argument is passed
if [ -z "$1" ]; then
    echo "Usage: $0 [app-name | path-to-app]"
    exit 1
fi

INPUT="$1"

if [ -d "$INPUT" ]; then
    SRC_APP="$(realpath "$INPUT")"
else
    if [ -d "$PARENT_DIR/$INPUT" ]; then
        SRC_APP="$(realpath "$PARENT_DIR/$INPUT")"
    else
        echo "Error: Application directory not found -> $INPUT"
        exit 1
    fi
fi

# Determine symlink name
if [ -n "$2" ]; then
    APP_NAME="$2"
else
    APP_NAME="$(basename "$SRC_APP")"
fi

TARGET_LINK="$NEURANET_3P/$APP_NAME"

if [ -e "$TARGET_LINK" ]; then
    echo "Target already exists: $TARGET_LINK"
    exit 1
fi

# Ensure 3p directory exists
mkdir -p "$NEURANET_3P"

# Prevent duplicate linking
if [ -L "$TARGET_LINK" ]; then
    echo "Symlink already exists:"
    echo "$TARGET_LINK"
    exit 0
fi

ln -s "$SRC_APP" "$TARGET_LINK"

echo "Symlink created:"
echo "$TARGET_LINK -> $SRC_APP"
