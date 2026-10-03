# Publishing

One package ships from this repository:

| Package | Tag | Contents |
|---|---|---|
| `dsh-plugin-stats` | `plugin-v0.1.0` | the Harness bundle: Host half, Web panel, CLI |

`dsh-plugin-stats` is **self-contained**: `@dsh-stats/core`, `@dsh-stats/pricing`, `zod`, and
`@deepseek-ai/schemastery` are inlined into `dist/host.mjs` and `dist/client.js` at build time, so the
published plugin declares **no runtime dependencies** — nothing to resolve at install time.

The two library packages are workspace-internal: marked `"private": true`, never published. They reach the
published manifest only inside `devDependencies`, and harmlessly so — `pnpm pack` rewrites the
`workspace:*` protocol into plain versions, and a consumer never installs a dependency's devDependencies.
If they are ever worth publishing on their own: remove `"private": true` from their manifests and add their
tags back to `publish.yml`.

## One-time setup

### 1. Publish the name once, by hand

A package that does not exist yet has no settings page, so it cannot carry a trusted publisher. The first
version is therefore published from your own machine (this is how the other plugin lines were bootstrapped
— their `0.1.0` carries no attestation, every later version does):

```sh
npm login                       # interactive; no token is stored in the repo.
pnpm install
pnpm --filter dsh-plugin-stats build

# Pack through pnpm so the `workspace:*` protocol is rewritten to real
# versions, then let npm publish the tarball.
pnpm --dir packages/plugin pack --pack-destination /tmp/dsh-publish
npm publish /tmp/dsh-publish/dsh-plugin-stats-0.1.0.tgz --access public
```

That first publish has no provenance attestation. Every release after it does.

### 2. Point the trusted publisher at this repo

On npmjs.com, for **dsh-plugin-stats** — Settings → Trusted Publisher → GitHub Actions — fill in exactly:

| Field | Value |
|---|---|
| Organization or user | `HuakunShen` |
| Repository | `dsh-plugin-stats` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed actions | **Allow npm publish** |

The environment field is not optional here: the workflow declares `environment: npm`, and a trusted
publisher configured with a blank environment will reject the OIDC claim.

Leaving "Allow npm publish" unchecked only permits `npm stage publish`, which this workflow does not use.

## Releasing

Bump `version` in `packages/plugin/package.json`, commit, then push the matching tag:

```sh
cd packages/plugin
npm version patch --no-git-tag-version     # or edit package.json by hand
cd ../..
git commit -am "chore: release dsh-plugin-stats 0.1.1"
git tag plugin-v0.1.1
git push origin main --tags
```

The workflow then:

1. installs and runs the whole workspace's `typecheck` + `test` — the bundle inlines the library packages,
   so their gates guard this release too,
2. builds the bundle,
3. fails if the tag's version and `package.json` disagree,
4. skips the publish if that exact version already exists,
5. packs with `pnpm pack` — which rewrites the `workspace:*` protocol into plain versions, so the published
   manifest is clean — printing the tarball's file list into the log, and
6. publishes that tarball with npm, `--access public --provenance` (npm is what carries the OIDC claim and
   produces the attestation).

A release can also be triggered by hand from **Actions → publish → Run workflow**, choosing the dist-tag
(`latest` / `next`); the version gate does not apply there and the idempotency check decides whether
anything ships.

## Verifying a published artifact

```sh
npm view dsh-plugin-stats@<version> dist.attestations   # expect a SLSA provenance URL
npm view dsh-plugin-stats@<version> dependencies        # expect: no dependencies
cd packages/plugin && npm pack --dry-run                # inspect the file list locally
```
