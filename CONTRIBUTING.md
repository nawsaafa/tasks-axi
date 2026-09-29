# Contributing

Thanks for wanting to contribute.
tasks-axi is part of the `*-axi` family.
One rule up front:

**Human-authored pull requests targeting `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes).**
We require this to reduce the maintainer's burden of reviewing and merging contributions.

`no-mistakes` puts a local git proxy in front of your real remote.
Pushing through it runs an AI-driven review/test/lint pipeline in an isolated worktree, forwards the push upstream only after every check passes, and opens a clean PR automatically.

A GitHub Actions check (`Require no-mistakes`) runs on PRs targeting `main` and fails if the body is missing the deterministic signature that no-mistakes writes **or** the structured pipeline attestation bound to the PR's current head.
The attestation comment (`<!-- no-mistakes-pipeline-attestation:v1 ... -->`) is only emitted by no-mistakes >= 1.46.0, so an older client produces a body that carries the signature alone and the check stays red no matter how often you re-push - upgrade the client, then push again so the body is rewritten for the current head.
The release and dependency bots are exempt so their automation keeps working, but regular contributor PRs without both markers will not be reviewed or merged.

## Workflow

1. Fork the repo, then clone the canonical fork or set your local `origin` back to it (`git@github.com:nawsaafa/tasks-axi.git`).
2. Create a branch and make your change with tests (`test/` mirrors `src/`).
3. Initialize or refresh the gate with your fork as the push target: `no-mistakes init --fork-url git@github.com:<you>/tasks-axi.git`.
4. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...) - release-please reads them to cut releases.
5. Push through the gate instead of pushing to `origin`:

   ```sh
   git push no-mistakes
   ```

6. Run `no-mistakes` to attach to the pipeline, watch findings, and auto-fix or review as needed.
7. Once the pipeline passes, it pushes the branch to your fork and opens the PR against the canonical fork (`nawsaafa/tasks-axi`) for you.

See the [no-mistakes quick start](https://kunchenguid.github.io/no-mistakes/start-here/quick-start/) for the full first-run walkthrough.

## Repo Conventions

- Node 20+, ESM-only TypeScript compiled with `strict`.
- Run the full gate before pushing: `pnpm build && pnpm lint && pnpm test && pnpm run build:skill -- --check`.
- The CLI layer only talks to the `Store` interface; backends slot in behind it without touching command code.
- Do not hand-edit `CHANGELOG.md` or `.release-please-manifest.json` - release-please owns them.
- Do not hand-edit `skills/tasks-axi/SKILL.md` - it is generated from `src/skill.ts`. After changing the generator or shared description, run `pnpm run build:skill` and commit the result; CI fails if it is stale.

## Release and Packaging

Version bookkeeping is release-please's, driven by Conventional Commits on `main`.
The canonical fork's current release tags (`v0.3.0` and `v0.3.1`) were cut by separately authorized manual GitHub releases rather than by release-please. Historical release-please tags are component-prefixed (`tasks-axi-v0.1.1` through `tasks-axi-v0.2.5`), but its configuration is now anchored at the published `v0.3.1` target and disables the component tag so future tags are bare (for example, `v0.3.2`).
`v0.3.0` is published but not installable - it resolves to commit `743be9e`, whose `package.json` has no `prepare` script, so a Git-source install builds nothing, packs an empty `dist`, and leaves the declared bin missing. Documented commands point at the immutable, installable `github:nawsaafa/tasks-axi#v0.3.1`. Its `0.3.1` version string is not source provenance because `main` reports the same version; use the peeled tag and the target/tree/archive hashes in the published GitHub release. The accepted manual-release gap means `CHANGELOG.md` intentionally has no `v0.3.1` entry; its release notes are on GitHub.
The release workflow does GitHub version/release bookkeeping only: it opens the release PR and cuts the tag and GitHub release. This fork is never published to npm, so no release path may install, build for, or invoke a registry publish.

The packed tarball intentionally ships runtime JavaScript only.
Keep `package.json` `files` limited to `dist/**/*.js`, `skills/tasks-axi`, `LICENSE`, and `README.md`; TypeScript declarations and source maps stay local for development.

`prepare` and `prepack` both run `npm run build`, so `npm pack` rebuilds `dist` first and a canonical Git source install (`npx -y github:nawsaafa/tasks-axi#v0.3.1`) builds the CLI on the consumer side. `prepare` is the load-bearing half: npm runs it when packing a Git dependency, which is why a ref without it (`v0.3.0`) installs nothing runnable. Never run `npm publish` from this fork.
From a fresh clone, install dependencies with `pnpm install --frozen-lockfile` before a local pack, since that build step needs `node_modules` (this matches how CI installs).
Then verify the package with `npm pack --dry-run` and keep the CLI bin as `dist/bin/tasks-axi.js` so npm preserves it without warnings.

## Questions

Open an issue, or talk to me on [Discord](https://discord.gg/Wsy2NpnZDu).
