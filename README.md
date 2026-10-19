# Claude Commit

Consistent, style-locked commit messages from the Claude Code you are already signed in to.

A sparkle button in the Source Control title bar reads your changes, asks Claude Code for a message in the style you chose, and drops the result into the commit box. No API key, no second subscription.

## Why another one

Most commit message extensions have two problems: the output format drifts from one message to the next, and you can't pick the model. Claude Commit fixes both.

- **Styles are enforced, not suggested.** Each style is a JSON schema the model has to fill plus a renderer that lays the fields out. The model decides content, the code decides format. `feat(scope): subject` is always lowercase, bullets always use `-`, the 50/72 style never exceeds 50 characters in the subject.
- **The model list is Claude Code's own.** The dropdown is read from the local model catalog Claude Code keeps for its `/model` picker. "Default" uses whatever Claude Code is set to right now, so the two never disagree.
- **It's fast.** The CLI is run with no tools, no MCP servers and a purpose-built system prompt. That cuts the prompt roughly 7x and the round trip roughly 2.5x compared to a default invocation, and removes thinking tokens entirely.

## Requirements

- VS Code 1.100 or newer
- [Claude Code](https://claude.com/claude-code) installed and logged in. Run `claude` once in a terminal if you haven't.

## Use

1. Make changes. Stage them if you want; unstaged and untracked files are used when nothing is staged.
2. Click the sparkle in the Source Control title bar, or run **Claude Commit: Generate Commit Message**.
3. Read the message, edit if you like, commit.

Open the **Claude Commit** panel in the activity bar to pick a style and a model. Both choices are saved in your user settings, so they follow you across projects. If a repository sets `claudeCommit.style` in its workspace settings, the panel shows that and edits the workspace value instead.

## Styles

| Style | Looks like |
|---|---|
| Conventional Commits | `feat(navbar): add tooltips to theme toggles` + bullet body |
| Conventional, scope required | Same, scope always present |
| Angular | Strict type list, prose body explaining why and what changed |
| Gitmoji | `✨ Add tooltips to theme toggles` + bullet body |
| Classic 50/72 | Capitalised subject ≤ 50 chars, prose body wrapped at 72 |
| One-liner | A single capitalised subject line |

## What the model sees

- The diff of your staged changes, or unstaged plus untracked changes if nothing is staged.
- Lockfiles, minified bundles, source maps, snapshots and files marked `linguist-generated` or `-diff` in `.gitattributes` are replaced by a one-line summary with line counts. Add your own patterns with `claudeCommit.ignoreGlobs`.
- Your last 12 commit subjects, so scopes and vocabulary match what the repository already uses.
- The branch name.

Nothing is sent anywhere except through your own Claude Code CLI session.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `claudeCommit.style` | `conventional` | Commit style. Set per workspace to enforce a convention. |
| `claudeCommit.model` | `""` (Default) | Model id, or empty to follow Claude Code's current model. |
| `claudeCommit.effort` | `low` | Effort level. Low was indistinguishable in quality for this task. |
| `claudeCommit.bodyMode` | `auto` | `auto`, `always` or `never` include a body. |
| `claudeCommit.language` | `English` | Language of the message. |
| `claudeCommit.extraInstructions` | `""` | Extra rules appended to the prompt. |
| `claudeCommit.recentCommitExamples` | `12` | Recent subjects shown to the model. 0 disables. |
| `claudeCommit.ignoreGlobs` | `[]` | Additional files to summarise instead of include. |
| `claudeCommit.maxFileDiffChars` | `12000` | Per-file diff cap. |
| `claudeCommit.maxTotalDiffChars` | `80000` | Total diff cap. |
| `claudeCommit.claudePath` | `""` | Path to `claude` if auto-detection fails. |
| `claudeCommit.timeoutSeconds` | `90` | Give up after this long. |
| `claudeCommit.debug` | `false` | Log prompts and raw replies to the output channel. |

## How it works

```
claude -p --output-format json --no-session-persistence \
       --tools "" --strict-mcp-config --disable-slash-commands \
       --effort low --system-prompt "<style rules + schema>" [--model <id>]
```

The prompt goes in on stdin. The reply is parsed as JSON and validated against the style's schema. If it doesn't validate, one retry is made with Claude Code's `--json-schema` flag, which guarantees the shape at the cost of an extra round trip. The validated object is rendered to text by the style and placed in the commit box.

The model list comes from `~/.claude/cache/model-catalog/`, which Claude Code refreshes itself. That file is an internal detail of Claude Code and could change; if it can't be read, the dropdown falls back to the aliases the CLI documents (opus, sonnet, haiku).

## Development

```bash
bun install
bun run build        # tsc
bun test             # unit tests for styles and glob matching
bun run package      # builds claude-commit-<version>.vsix
bun run install-local
```

Press F5 in VS Code to launch an Extension Development Host.

## License

MIT
