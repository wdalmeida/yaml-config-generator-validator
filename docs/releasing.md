# Releasing

`.github/workflows/release.yml` automates versioning, changelog generation, git tags, and
GitHub Releases via [release-please](https://github.com/googleapis/release-please) - nothing
here does anything until you actually merge the release PR it maintains (see below).

## Write commits as Conventional Commits from now on

release-please derives the version bump and changelog entries from commit messages on `main`.
The prefixes that matter:

- `fix: ...` → patch release (`0.1.0` → `0.1.1`)
- `feat: ...` → minor release (`0.1.0` → `0.2.0`)
- `feat!: ...` / `fix!: ...` / any `BREAKING CHANGE:` footer → major release (`0.1.0` → `1.0.0`)
- `chore:`, `docs:`, `test:`, `refactor:`, `ci:` etc. → included in the changelog under their
  own section, but don't trigger a version bump on their own

This is enforced by convention/documentation only - there's no commit-msg hook or CI check
blocking a non-conventional commit. If drift becomes a real problem, a `commitlint` check is
the natural next step, but that's out of scope for now.

## The actual flow

1. Push (or merge a PR containing) commits like `feat: add CD schema` to `main` as normal.
2. release-please notices and opens/updates a standing PR titled something like
   `chore(main): release 0.2.0`, containing the `CHANGELOG.md` entry and `package.json`
   version bump computed from every conventional commit since the last release. This PR keeps
   updating itself as more qualifying commits land - it does not represent "next commit
   waiting," it represents "everything not yet released."
3. **Merging that PR is what actually cuts the release** - release-please tags the merge
   commit (`vX.Y.Z`) and creates the GitHub Release with the changelog as its body.
4. A second job in the same workflow (`build-and-attach`) then checks out that exact tag,
   builds the app (`npm run build`), zips `dist/`, and attaches `dist.zip` to the GitHub
   Release - gated on `release_created` so it never runs on ordinary pushes, only when a
   release PR merge actually produced a new tag.

Nothing is manual here except step 3 (deciding when to actually ship by merging the PR) - the
version number, changelog, tag, release notes, and build artifact are all computed and
attached automatically.

## Tags and releases are immutable once created

A repository ruleset (**Settings → Rules → Rulesets → "Immutable release tags"**) targets
`refs/tags/v*` with `update` and `deletion` rules active: once a `vX.Y.Z` tag exists, it can't
be force-moved to point somewhere else or deleted - by anyone, including admins, *except*
through the bypass described below. This means a tag (and the Release built from it, and the
`dist.zip` attached to it) always means exactly the same commit and the same bytes forever -
the whole point of tagging a release in the first place.

Repository admins keep bypass (`actor_type: RepositoryRole`, `actor_id: 5`, `bypass_mode:
always`) as a deliberate escape hatch - e.g. if release-please ever tags the wrong commit, an
admin can still delete and recreate that tag. Everyone else is fully blocked. Created via:

```sh
gh api repos/<owner>/<repo>/rulesets -X POST --input - <<'JSON'
{
  "name": "Immutable release tags",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }
  ],
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [{ "type": "update" }, { "type": "deletion" }]
}
JSON
```

(`actor_id: 5` is GitHub's fixed ID for the repository "Admin" role - confirmed by creating
this exact ruleset and checking `current_user_can_bypass` came back `"always"`, not looked up
from a public reference table.)

## `main` requires a PR with passing checks

A second ruleset ("Require PR and passing checks on main") targets `refs/heads/main` with the
`pull_request` rule (a PR is required to merge; `required_approving_review_count: 0` since this
is a solo-maintained repo - approvals can be added later if collaborators join),
`required_status_checks` (exactly one context, `ci-ok` - see below), `deletion`, and
`non_fast_forward` (blocks force-push) rules active. Same admin bypass as the tag ruleset -
the repo owner can still push directly or merge without a green check if genuinely needed, but
nobody/nothing else can.

### Why one required context and not a list of jobs

`ci-ok` is a job in `ci.yml` that `needs:` every other job in the file, runs `if: always()`,
and fails unless each of them reports success **or skipped**. Requiring it - and nothing else -
buys two things:

- **`ci.yml`'s jobs can be skipped safely.** Each job is gated on whether a PR actually touched
  files it cares about (`tools/cmd/changed-buckets`), so a docs-only PR skips the build. The
  alternative - a workflow-level `paths:` filter - is a trap here: a workflow skipped by a path
  filter never creates its check runs at all, so a required check would sit *Pending* forever
  and the PR could never merge. Gating inside the workflow, behind a gate job that always runs,
  is what makes skipping safe. Nothing relies on GitHub's "a skipped job satisfies a required
  check" behaviour.
- **The list stops drifting.** It already had: this ruleset named `test`, `schemas`, `markdown`,
  `audit`, `actionlint`, `gitleaks` and `zizmor`, while the `helm` and `plumber` jobs added later
  were enforced by nothing at all, despite this file claiming "every job in `ci.yml`". A new job
  is now covered the moment it lands in `ci-ok`'s `needs:`, with no repo-settings change - and
  `npm run lint:ci-gate` (run by the `actionlint` job) fails the build if one is missing from it.

The consequence worth knowing: **no other workflow's checks may be made required while it has a
`paths-ignore:` filter.** `container.yml`, `codeql.yml` and `supply-chain.yml` all have one, so
each would sit Pending on any PR it filtered out. Making them required means first giving them
the same in-workflow gating `ci.yml` uses.

To update the contexts - note that `PUT` replaces the **whole** ruleset, so the rules array has
to be rewritten in place rather than sent on its own, or the `pull_request`, `deletion` and
`non_fast_forward` rules above are silently dropped:

```sh
id=$(gh api repos/:owner/:repo/rulesets --jq \
  '.[] | select(.name == "Require PR and passing checks on main") | .id')

gh api "repos/:owner/:repo/rulesets/$id" --jq '{name, target, enforcement, bypass_actors,
  conditions, rules}' |
  jq '(.rules[] | select(.type == "required_status_checks")
       | .parameters.required_status_checks) = [{context: "ci-ok"}]' |
  gh api "repos/:owner/:repo/rulesets/$id" -X PUT --input -

# Confirm: should print exactly one line, `ci-ok`.
gh api "repos/:owner/:repo/rulesets/$id" --jq '.rules[]
  | select(.type == "required_status_checks")
  | .parameters.required_status_checks[].context'
```

## Why `can_approve_pull_request_reviews` stays on repo-wide

release-please needs the repo's **Settings → Actions → General → "Allow GitHub Actions to
create and approve pull requests"** toggle on - without it, the workflow fails with "GitHub
Actions is not permitted to create or approve pull requests" (hit this for real the first time
`release.yml` ran; fixed via `gh api -X PUT .../actions/permissions/workflow -F
can_approve_pull_request_reviews=true`).

This toggle is **repository-wide** - GitHub's API has no way to scope it to one workflow. The
mitigation is that only `release.yml`'s `release` job actually declares
`permissions: pull-requests: write` in its YAML (every other job across every workflow in this
repo explicitly scopes its own `permissions:` block, and none of them include it) - so even
though the repo-wide toggle is open, no other job today can actually exercise it. **This is a
tradeoff, not a closed gap**: any future job that adds `pull-requests: write` would also gain
this capability. The fully-closed alternative is a dedicated GitHub App (fine-grained,
repo-scoped, only `contents: write` + `pull-requests: write`) used via
`actions/create-github-app-token` instead of the default `GITHUB_TOKEN`, which would let this
toggle go back to `false` - deliberately not done here (adds a private key to manage as a
secret) but worth reconsidering if this repo gains other contributors/workflows.

## The first release

`.release-please-manifest.json` starts at `"." : "0.0.0"`, matching `package.json`'s current
value - the first real version comes from whatever `feat`/`fix` commits land after adoption
(e.g. a `feat:` commit would propose `0.1.0`). If the first release should deliberately be
`1.0.0` instead, edit the version in the release PR before merging it (release-please lets
you edit the PR's `CHANGELOG.md`/version directly) rather than hard-coding an initial version
here.

## A caveat worth knowing

Same as `docs/supply-chain-security.md`: the release PR, the tag, the GitHub Release, and the
attached `dist.zip` don't exist until this repo is pushed to GitHub and a workflow run has
actually completed there. The tag-immutability ruleset above is the one exception - it's a
repository setting, not something the workflow files produce, so it's already active on the
repo regardless of whether `release.yml` has ever run.
