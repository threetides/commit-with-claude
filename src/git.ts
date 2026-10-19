/** Minimal typings for the built-in Git extension API (vscode.git, API version 1). */
import type * as vscode from "vscode";

export interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  readonly repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: { value: string };
  readonly state: { HEAD?: { name?: string } };
}

export function getGitApi(): GitAPI | undefined {
  // Resolved lazily so this module stays importable without activating Git first.
  const vs = require("vscode") as typeof vscode;
  const ext = vs.extensions.getExtension<GitExtension>("vscode.git");
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : undefined;
  return exports?.getAPI(1);
}
