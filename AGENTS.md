# Project workflow

Use this workflow for every change in this repository.

## Branches

- `main` contains published releases. Do not develop directly on it.
- `develop` collects finished work for the next release.
- Create every feature, fix, or documentation change in its own branch from the latest `develop`.
- Keep each branch focused on one change.

## Finish a change

1. Update the feature branch from `develop` before integration.
2. Run the checks affected by the change. For code changes, run tests, typecheck, and lint.
3. Review the complete diff and make sure the branch contains no unrelated or private files.
4. Squash-merge the branch into `develop` with one clear commit message.
5. Push `develop`.
6. Remove the finished feature branch and its worktree.

Do not merge unfinished or failing work into `develop`.

## Tests

- Test executable behavior, code, and infrastructure only.
- Do not add regression tests that assert prompt wording, documentation, Markdown, or the presence of specific phrases.
- Prompt and documentation changes do not need tests unless executable parsing or loading behavior changes.

## Make a release

1. Start only when `develop` is complete, clean, and passing CI.
2. Update the package version and release notes on `develop` when needed. Use a version that has never appeared on npm.
3. Run the full release checks and inspect the npm tarball.
4. Squash-merge all changes from `develop` into `main` as one release commit.
5. Tag that commit as `v<version>`, push `main` and the tag, and create the GitHub release.
6. Verify the GitHub Actions release workflow and the published npm package.
7. After publication is verified, reset `develop` to the released `main` commit and push it with `--force-with-lease`.

After step 7, `main` and `develop` must point to the same commit and have no diff. New work starts from the clean `develop` branch.

Never reset `develop` before the npm release has been published and verified. Never use plain `--force`.
