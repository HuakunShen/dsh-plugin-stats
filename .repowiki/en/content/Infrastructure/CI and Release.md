# CI and Release

**Updated: 2026-10-03** — initial wiki build. Sources: [.github/workflows](../../../.github/workflows), [PUBLISHING.md](../../../PUBLISHING.md).

## CI ([ci.yml](../../../.github/workflows/ci.yml))

Runs on every push to `main` (except docs-only changes: `paths-ignore` for `**/*.md` and `LICENSE`) and every PR. Runner pinned to **`ubuntu-24.04`** — the `ubuntu-latest` label migrates to Ubuntu 26 on Oct 19 and a release pipeline should not change OS under a tag (commit `728c568`); move to 26 deliberately instead. `pnpm/action-setup@v6` (v4 targets Node 20, deprecated on runners; v6 runs on node24) reads the pnpm version from the root `packageManager` pin:

1. `pnpm install --frozen-lockfile` (Node 24) — esbuild's postinstall is allow-listed via `pnpm.onlyBuiltDependencies` in the root [package.json](../../../package.json) so a fresh install runs it without the ignored-scripts warning
2. `pnpm -r typecheck` — `tsc --noEmit` per package (`strict` + `noUncheckedIndexedAccess`)
3. **No-any gate** — grep over `packages/*/src` + `packages/*/test` for `: any` / `as any` / `<any>`; any hit fails CI
4. `pnpm -r test` — 45 vitest cases across core / pricing / plugin
5. `pnpm --filter dsh-plugin-stats build` — tsdown single-file bundles
6. Publish-shape verification — the published plugin inlines everything, so it must declare **no runtime dependencies**; CI fails if a `workspace:` protocol would leak into the manifest

## Release ([publish.yml](../../../.github/workflows/publish.yml))

Tag-driven: pushing `plugin-v*` (or manual `workflow_dispatch` with a dist-tag `latest`/`next`) publishes exactly one artifact — `dsh-plugin-stats`:

1. installs and runs the whole workspace's `typecheck` + `test` (the bundle inlines the library packages, so their gates guard the release too),
2. builds the bundle,
3. fails if tag version and `package.json` disagree,
4. skips if that exact version already exists (idempotent),
5. `pnpm pack` — rewrites `workspace:*` to plain versions, prints the file list,
6. `npm publish --access public --provenance` — npm trusted publishing via the GitHub Actions **OIDC** claim (`id-token: write`, `environment: npm`); no token stored anywhere. The OIDC claim is also what mints the public SLSA provenance attestation.

`@dsh-stats/core` and `@dsh-stats/pricing` are workspace-internal (`private`, never published). If ever worth publishing standalone: remove `"private": true` and re-add their tags to `publish.yml`.

**Provenance is a CI property** (commit `61ebc56`): the first version of a new npm name can't carry a trusted-publisher setting, so it is bootstrapped by hand (per PUBLISHING.md) and has no attestation; every workflow release after that does.

## Released so far

| Version | Tag | Date | Notes |
|---|---|---|---|
| 0.1.0 | `plugin-v0.1.0` | 2026-10-03 | manual bootstrap publish |
| 0.1.1 | `plugin-v0.1.1` | 2026-10-03 | workflow publish with provenance |

## Release procedure

```sh
cd packages/plugin
npm version patch --no-git-tag-version   # or edit package.json
cd ../..
git commit -am "chore: release dsh-plugin-stats X.Y.Z"
git tag plugin-vX.Y.Z
git push origin main --tags
```

Verify: `npm view dsh-plugin-stats@<version> dist.attestations` (expect SLSA URL) and `dependencies` (expect none).

## Related pages

- [Architecture](../Architecture/Architecture.md) · [Plugin Package](../Packages/Plugin%20Package.md)
- [System Overview](../System%20Overview.md)
