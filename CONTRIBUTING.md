# Contributing

## The one rule: `dist/` goes into the commit

This repository can be started straight from GitHub:

```bash
npx -y git+https://github.com/m8rzel/kicktipp-agent.git
```

So that nothing is compiled on the user's machine, the build output is committed and
`package.json` deliberately has **no** `prepare` script. With a `prepare` script, npm would
install every dev dependency and run TypeScript on each cold start. That is slower, and a
failing build only shows up as a server that does not start, with the reason buried in the
npx output.

The price: whoever changes `src/` has to ship `dist/` with it. Otherwise everyone who runs the
server through `npx` keeps running the old code, without any error.

Before every commit:

```bash
npm test
npm run build        # wipes dist/ and compiles it fresh
git add -A           # do not forget dist/
```

Before every push, check that source and build match:

```bash
npm run verify:dist  # rebuilds, exits 1 if dist/ differs from the commit
```

The same applies after merging from upstream (`christianheidorn/kicktipp-agent`): upstream does
not commit `dist/`, so rebuild and commit it after every merge.

## Release

Tags of this fork carry a `-fork.N` suffix on the upstream version: `v1.2.0-fork.1`,
`v1.2.0-fork.2`, then `v1.3.0-fork.1` after an upstream release. Upstream uses plain `vX.Y.Z`
tags. Those commits have no `dist/`, so they cannot be used as an `npx` pin, and a fork tag
with the same name would clash on the next `git fetch upstream`.

1. If the version changes: `npm version <major|minor|patch> --no-git-tag-version`. Without the
   flag, npm commits and tags on its own, before review, on the branch instead of `main`.
2. `npm test` and `npm run verify:dist`.
3. Commit, PR against `main`, merge.
4. Tag the merge commit on `main` and push the tag:
   `git tag v1.2.0-fork.2 && git push origin v1.2.0-fork.2`.
5. Raise the tag in the MCP config entries (`…kicktipp-agent.git#v1.2.0-fork.2`), restart the
   client.

The tag is not cosmetic. Without a pin, every `npx` start pulls the current `main`, so a push
would silently change other people's running install.
