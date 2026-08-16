# Codex repository instructions

This repository was first configured for Claude Code. Codex must use the same
current instructions and skills. Do not copy Claude instructions into this file.

## Required instruction loading

Before substantive work:

1. Read `~/.claude/CLAUDE.md` completely.
2. Read the repository-root `CLAUDE.md` completely when it exists. Also read each
   more-specific `CLAUDE.md` between the repository root and the working directory.
3. Read `CONTEXT.md` and use its ubiquitous language.
4. Read `HANDOFF.md`, then read the active handoff that it names.
5. Inspect `.claude/rules/*.md`. Read rules without `paths:` frontmatter. Read each
   path-scoped rule whose patterns match files that the task can inspect or change.
6. Discover skills from `~/.claude/skills/*/SKILL.md`,
   `.claude/skills/*/SKILL.md`, and `skills/*/SKILL.md`. When the user names a skill
   or the task matches its `description:`, read that skill completely before acting.
   A project skill overrides a global skill with the same `name:`.
7. Use the `caveman` skill in every session: read it before substantive work and
   apply it for the whole session. If no skill named `caveman` is discoverable,
   say so plainly at session start instead of guessing at its content.

## Claude-to-Codex adaptation

- `.claude/` is the source of truth for shared Claude and Codex instructions.
- `skills/` contains this repository's shipped plugin skills. Codex must treat these
  skills as project skills and follow them directly.
- `.agents/skills/` is only a generated Codex runtime mirror when present. Never edit
  that mirror directly.
- Preserve each skill's workflow, safety gates, and verification intent. Replace a
  Claude-only tool, hook, subagent type, or slash command with the closest Codex
  capability. State plainly when Codex has no equivalent.
- Native Codex system and developer instructions, then explicit user instructions,
  take precedence. Otherwise use this order: nearest project `CLAUDE.md` and matching
  `.claude/rules/` files, repository-root `CLAUDE.md`, global
  `~/.claude/CLAUDE.md`, then this file.
- Do not bypass a stricter Claude safety or verification rule because Codex does not
  load or enforce it automatically.

## Project workflow

- `spec/adapter-reference.js` and `test/work-claim-reference.js` are independent
  oracles. Never import them into `src/` or change them to match an implementation.
- Treat fixtures as normative when contract prose and a fixture differ.
- Use `TMPDIR=/tmp` for every test command. The default macOS temporary path makes
  the lock socket path too long.
- Verify on the current Node runtime and Node 20 when production code changes:

  ```sh
  TMPDIR=/tmp node --test test/*.test.js
  TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
  TMPDIR=/tmp node spec/run-adapter-implementation.js
  node bin/wowbagger.js validate --ledger ledger --json
  ```

- Never use `git stash`. Worktrees share one stash stack.
- Use the `wowbagger` skill for ledger work. Claims are advisory until fenced claims
  exist. Never present a claim as exclusive coordination.

## Herdr

This repository is worked on inside Herdr. Herdr is the terminal workspace manager
for persistent panes, tabs, workspaces, and agent state. Use its features when they
fit the task.

Before any Herdr control command:

```sh
test "${HERDR_ENV:-}" = 1
```

If the check fails, do not inspect or control another Herdr session. Say that the
current process is outside Herdr.

At the start of a Herdr task, use the installed CLI as the syntax authority:

```sh
herdr --skill
herdr --help
herdr pane current --current
herdr agent list
```

Herdr usage rules:

- Use workspaces, tabs, and panes for layout. Use pane commands for shells, tests,
  servers, logs, and other ordinary processes. Use agent commands for recognized
  coding agents and their lifecycle state.
- Prefer `--current`, an explicit pane ID, or a unique agent name. Do not rely on the
  focused pane, which can belong to the user or another client.
- Parse opaque workspace, tab, and pane IDs from JSON responses. Never predict them.
- Default to a sibling pane in the current tab and the current working directory.
  Use `--no-focus` for background work. Do not create a new workspace, tab, worktree,
  or working directory unless the user requests that topology.
- Use `herdr pane run` and `herdr pane wait-output` for ordinary commands. Use
  `herdr agent start`, `prompt --wait`, `wait`, and `read` for agent work.
- Treat `blocked`, `working`, `done`, `idle`, and `unknown` as Herdr lifecycle states.
  `unknown` does not prove that work finished.
- Inspect `agent get` and `agent read` before responding to a blocked or failed wait.
- Do not close panes, tabs, workspaces, or sessions that this task did not create.
  Never run `herdr server stop` unless the user explicitly asks to stop the session.
- Herdr detects Codex automatically. Its Codex integration adds native session identity
  for restore; screen detection remains the lifecycle authority. Check it with
  `herdr integration status`. Install it with `herdr integration install codex` only
  when it is absent or stale.

Current documentation:

- <https://herdr.dev/docs/>
- <https://herdr.dev/docs/agent-automation/>
- <https://herdr.dev/docs/integrations/>
- <https://herdr.dev/docs/session-state/>
- <https://herdr.dev/docs/socket-api/>

