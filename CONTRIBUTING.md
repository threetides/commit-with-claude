# Contributing

Thanks for taking a look. This is a small project and small, focused pull requests are the easiest to review.

## Setup

```bash
bun install
bun run build     # compile with tsc
bun test          # unit tests for styles and glob matching
```

Press F5 in VS Code to launch an Extension Development Host with the extension loaded. Open any Git repository in that window, make a change, and click the sparkle in the Source Control title bar.

To try the packaged extension exactly as users get it:

```bash
bun run install-local
```

## Where things live

| File | Purpose |
|---|---|
| `src/extension.ts` | Activation, the generate command, repository selection |
| `src/styles.ts` | Commit styles: schema, prompt rules, renderer. No VS Code dependency, unit tested |
| `src/prompt.ts` | Builds the system and user prompts from a style and a diff |
| `src/diff.ts` | Collects the diff, summarises noise, applies size limits |
| `src/cli.ts` | Finds and runs the `claude` CLI, parses its JSON output |
| `src/catalog.ts` | Reads Claude Code's model catalog cache |
| `src/panel.ts` | The activity bar webview |

## Adding a style

1. Add a `CommitStyle` in `src/styles.ts`: schema, `instructions`, `help`, and `render`.
2. Add it to the `STYLES` array and to the `commitWithClaude.style` enum in `package.json`, with an `enumDescriptions` entry.
3. Add a render test in `test/styles.test.ts`. Real model output is the best fixture.
4. Add a row to the styles table in `README.md`.

Keep the renderer deterministic. The model fills fields, the renderer owns casing, punctuation, wrapping, and line structure. That is what makes output consistent, so resist the urge to let free-form text through.

## Guidelines

- No runtime dependencies. The extension ships as plain compiled JavaScript.
- Anything the model receives is built in `prompt.ts`. Don't scatter prompt text through other modules.
- Log through the output channel, never `console.log`.
- Conventional Commits for commit messages, naturally.

## Releasing

Maintainers: bump `version` in `package.json`, move the "Unreleased" changelog section under the new version, commit, then tag `vX.Y.Z` and push the tag. The release workflow builds the VSIX, attaches it to a GitHub release, and publishes to the Marketplace and Open VSX when the `VSCE_PAT` and `OVSX_PAT` repository secrets are set.
