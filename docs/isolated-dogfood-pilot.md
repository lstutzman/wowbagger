# Run an isolated consumer dogfood pilot

Use this flow when a coding-agent harness must run a Wowbagger pilot in a
disposable Git worktree. The worktree must exist before the agent starts. An
agent session rooted in another checkout might be unable to run Git in a sibling
worktree even when ordinary file commands work there.

## 1. Prepare the worktree outside the agent session

Run these commands from a normal shell in the consumer repository. Choose the
consumer's actual base ref. Do not assume that it is `main` or `staging`.

```sh
BASE_REF=origin/staging
PILOT_BRANCH=dogfood/wowbagger-pilot
PILOT_ROOT="$(dirname "$(git rev-parse --show-toplevel)")/wowbagger-pilot"

git fetch origin
git worktree add -b "$PILOT_BRANCH" "$PILOT_ROOT" "$BASE_REF"
git -C "$PILOT_ROOT" rev-parse --show-toplevel
git -C "$PILOT_ROOT" status --short
git -C "$PILOT_ROOT" rev-parse HEAD
```

If the pilot worktree already exists, select it instead of adding another one:

```sh
git worktree list --porcelain
PILOT_ROOT=/absolute/path/to/the/existing/pilot-worktree
git -C "$PILOT_ROOT" rev-parse --show-toplevel
git -C "$PILOT_ROOT" status --short
git -C "$PILOT_ROOT" rev-parse HEAD
```

Stop if any Git command fails. Fix the worktree from the normal shell. Do not
install Wowbagger or mutate a ledger yet.

## 2. Launch a new session from the worktree

Do not continue an agent session that started in another checkout. Start a new
session with the pilot worktree as its process directory and project root:

```sh
cd "$PILOT_ROOT"
claude
```

Use the equivalent launch command for another harness. The invariant is the
same: the harness process starts inside `PILOT_ROOT`; it does not navigate to a
sibling worktree after launch.

Give the new session this resume instruction:

> Resume the Wowbagger dogfood pilot from this worktree. Before installation or
> any ledger mutation, prove that this session can use Git here. Run
> `test "$(git rev-parse --show-toplevel)" = "$(pwd -P)"`, `git status --short`, and
> `git rev-parse HEAD`. Stop if any command fails. Treat a failure before this
> preflight passes as a harness or setup finding, not as a Wowbagger product
> defect. After the preflight passes, install through the selected release
> channel and record Wowbagger product friction separately.

## 3. Keep setup findings separate

Record two finding classes in the pilot report:

- **Harness/setup finding:** The agent cannot access Git in its session-root
  worktree, or the worktree, branch, base ref, or launch directory is wrong.
- **Wowbagger product finding:** Installed Wowbagger behavior is wrong or harder
  than the documented workflow after the Git preflight passes.

Do not file a failed sibling-worktree Git command as a Wowbagger core defect.
The known recovery is to stop and relaunch with the worktree as the session
root. File each later product defect as its own Wowbagger ledger item.

## 4. Clean up after the pilot

First preserve the pilot commits and ledger evidence through the approved
consumer workflow. Then run these commands from the original consumer checkout:

```sh
git worktree remove "$PILOT_ROOT"
git branch -d "$PILOT_BRANCH"
```

Both commands refuse unsafe cleanup by default. Do not use force while pilot
commits or evidence remain unmerged.
