# Security

## What this extension does with your code

Commit with Claude runs the `claude` CLI that is already installed and signed in on your machine. Your diff, your branch name, and your recent commit subjects are passed to that process on standard input. Nothing is sent anywhere by the extension itself; whatever leaves your machine goes through your own Claude Code session, under Anthropic's terms for that account.

The extension stores no credentials and makes no network requests.

## Reporting a vulnerability

If you find a security issue, please do not open a public issue. Use GitHub's private vulnerability reporting on this repository, or email the maintainer at the address on the publisher profile. You'll get a reply within a few days.
