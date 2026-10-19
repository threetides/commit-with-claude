# Changelog

## 0.1.0

Initial release.

- Sparkle button in the Source Control title bar generates a commit message from staged changes, or from unstaged and untracked changes when nothing is staged.
- Uses the locally installed Claude Code CLI and its existing login. No API key.
- Activity bar panel with a commit style selector and a model selector that mirrors Claude Code's own model picker. "Default" follows whatever model Claude Code is set to.
- Six styles: Conventional Commits, Conventional with required scope, Angular, Gitmoji, Classic 50/72, One-liner. Each style is a JSON schema plus a renderer, so the layout never drifts.
- Lockfiles, minified bundles, source maps, snapshots and files marked generated in `.gitattributes` are summarised instead of pasted into the prompt.
- Recent commit subjects are shown to the model so scopes and vocabulary match the repository.
