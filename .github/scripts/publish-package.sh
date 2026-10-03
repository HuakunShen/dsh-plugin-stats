#!/usr/bin/env bash
#
# Publishes one workspace package to npm, from a tarball packed by pnpm.
#
#   usage: publish-package.sh <package-dir> [dist-tag]
#
# Why a tarball instead of `npm publish` in the package directory: pnpm is what
# rewrites the `workspace:*` protocol into the real versions of the sibling
# packages, so the manifest npm serves is clean. npm is still the client that
# publishes, which is the part that carries the OIDC claim and produces the
# provenance attestation.
#
# Idempotent: a version that already exists on the registry is a no-op, so a
# re-run of a release workflow never fails on "version already published".
#
# Requires: pnpm, node, npm, and (in CI) an OIDC-capable npm with
# `--provenance` available.
set -euo pipefail

DIR="${1:?usage: publish-package.sh <package-dir> [dist-tag]}"
DIST_TAG="${2:-latest}"
OUT="${RUNNER_TEMP:-/tmp}/dsh-publish"

NAME=$(cd "$DIR" && node -p "require('./package.json').name")
VERSION=$(cd "$DIR" && node -p "require('./package.json').version")

echo "package: $NAME@$VERSION ($DIR, dist-tag: $DIST_TAG)"

if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
  echo "$NAME@$VERSION is already published, skipping"
  exit 0
fi

rm -rf "$OUT"
mkdir -p "$OUT"
pnpm --dir "$DIR" pack --pack-destination "$OUT"

# Scoped names lose their leading @ and have / flattened in the filename.
FLAT=$(printf '%s' "$NAME" | sed 's|^@||; s|/|-|g')
TARBALL="$OUT/$FLAT-$VERSION.tgz"
if [ ! -f "$TARBALL" ]; then
  echo "expected tarball not found: $TARBALL" >&2
  ls -l "$OUT" >&2
  exit 1
fi

echo "contents of $(basename "$TARBALL"):"
tar -tzf "$TARBALL" | sed 's|^package/|  |'

npm publish "$TARBALL" --access public --provenance --tag "$DIST_TAG"
