# Publishing

Three packages ship from this repository, each with its own tag and its own
[trusted publisher](https://docs.npmjs.com/trusted-publishers) entry on npm:

| Package | Tag | Contents |
|---|---|---|
| `dsh-plugin-stats` | `plugin-v0.1.0` | the Harness bundle: Host half, Web panel, CLI |
| `@dsh-stats/core` | `core-v0.1.0` | portable stats core (TypeScript source) |
| `@dsh-stats/pricing` | `pricing-v0.1.0` | models.dev price lookup (TypeScript source) |

`dsh-plugin-stats` is **self-contained**: `@dsh-stats/core`, `@dsh-stats/pricing`,
`zod`, and `@deepseek-ai/schemastery` are inlined into `dist/host.mjs` and
`dist/client.js` at build time, so the published plugin declares no runtime
dependencies and nothing to resolve at install time. The two library packages are
published separately for reuse, and they ship **source, not compiled output** — see
their READMEs for what that means for a consumer.

## One-time setup

### 1. Publish each name once, by hand

A package that does not exist yet has no settings page, so it cannot carry a
trusted publisher. Its first version is therefore published from your own
machine (this is how the other plugin lines were bootstrapped — their `0.1.0`
carries no attestation, every later version does):

```sh
npm login                       # interactive; no token is stored in the repo.
pnpm install
pnpm --filter dsh-plugin-stats build

# Pack through pnpm so the `workspace:*` protocol is rewritten to real
# versions, then let npm publish the tarball.
for dir in core pricing plugin; do
  pnpm --dir "packages/$dir" pack --pack-destination /tmp/dsh-publish
done

npm publish /tmp/dsh-publish/dsh-stats-core-0.1.0.tgz     --access public
npm publish /tmp/dsh-publish/dsh-stats-pricing-0.1.0.tgz  --access public
npm publish /tmp/dsh-publish/dsh-plugin-stats-0.1.0.tgz   --access public
```

That first publish has no provenance attestation. Every release after it does.

### 2. Point each package's trusted publisher at this repo

On npmjs.com, for **each of the three packages** — Settings → Trusted Publisher →
GitHub Actions — fill in exactly:

| Field | Value |
|---|---|
| Organization or user | `HuakunShen` |
| Repository | `dsh-plugin-stats` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed actions | **Allow npm publish** |

The environment field is not optional here: the workflow declares
`environment: npm`, and a trusted publisher configured with a blank environment
will reject the OIDC claim.

Leaving "Allow npm publish" unchecked only permits `npm stage publish`, which
this workflow does not use.

## Releasing

Bump `version` in the package's `package.json`, commit, then push the matching tag:

```sh
cd packages/plugin
npm version patch --no-git-tag-version     # or edit package.json by hand
cd ../..
git commit -am "chore: release dsh-plugin-stats 0.1.1"
git tag plugin-v0.1.1
git push origin main --tags
```

The workflow then:

1. installs and runs that package's `typecheck` + `test`,
2. builds the bundle (plugin only),
3. fails if the tag's version and `package.json` disagree,
4. runs `npm pack --dry-run` so the shipped file list is in the log,
5. skips the publish if that exact version already exists,
6. packs with `pnpm pack` — which rewrites the `workspace:*` protocol into real
   versions, so the published manifest is clean, and
7. publishes that tarball with npm, `--access public --provenance` (npm is what
   carries the OIDC claim and produces the attestation).

Any package can also be published by hand from **Actions → publish → Run
workflow**, choosing the package and the dist-tag (`latest` / `next`).

## Verifying a published artifact

```sh
npm view dsh-plugin-stats@<version> dist.attestations   # expect a SLSA provenance URL
npm view dsh-plugin-stats@<version> dependencies        # expect: no dependencies
npm pack --dry-run                                       # inspect the file list locally
```
