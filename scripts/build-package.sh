#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PACKAGE_NAME="iina-betterspeed.iinaplugin"
OUTPUT_DIR="$REPO_ROOT/dist"
VERSION=$(plutil -extract version raw -expect string "$REPO_ROOT/Info.json")
OUTPUT_FILE="$OUTPUT_DIR/iina-betterspeed-$VERSION.iinaplgz"
TEMP_DIR=$(mktemp -d)
PACKAGE_DIR="$TEMP_DIR/$PACKAGE_NAME"

cleanup() {
  rm -rf "$TEMP_DIR"
}

trap cleanup EXIT INT TERM

mkdir -p "$PACKAGE_DIR" "$OUTPUT_DIR"
cp -X "$REPO_ROOT/Info.json" "$PACKAGE_DIR/"
cp -X "$REPO_ROOT/main.js" "$PACKAGE_DIR/"
cp -X "$REPO_ROOT/preferences.html" "$PACKAGE_DIR/"
xattr -cr "$PACKAGE_DIR"
rm -f "$OUTPUT_FILE"

(
  cd "$TEMP_DIR"
  COPYFILE_DISABLE=1 zip -rqX "$OUTPUT_FILE" "$PACKAGE_NAME"
)

printf 'Built %s\n' "$OUTPUT_FILE"
