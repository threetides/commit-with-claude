import * as vscode from "vscode";
import type { BodyMode } from "./styles";

export interface Config {
  style: string;
  model: string;
  effort: string;
  bodyMode: BodyMode;
  language: string;
  extraInstructions: string;
  recentCommitExamples: number;
  ignoreGlobs: string[];
  maxFileDiffChars: number;
  maxTotalDiffChars: number;
  claudePath: string;
  timeoutSeconds: number;
  debug: boolean;
}

export const SECTION = "claudeCommit";

export function readConfig(scope?: vscode.ConfigurationScope): Config {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  return {
    style: c.get<string>("style", "conventional"),
    model: c.get<string>("model", "").trim(),
    effort: c.get<string>("effort", "low"),
    bodyMode: c.get<BodyMode>("bodyMode", "auto"),
    language: c.get<string>("language", "English").trim() || "English",
    extraInstructions: c.get<string>("extraInstructions", "").trim(),
    recentCommitExamples: c.get<number>("recentCommitExamples", 12),
    ignoreGlobs: c.get<string[]>("ignoreGlobs", []),
    maxFileDiffChars: c.get<number>("maxFileDiffChars", 12000),
    maxTotalDiffChars: c.get<number>("maxTotalDiffChars", 80000),
    claudePath: c.get<string>("claudePath", "").trim(),
    timeoutSeconds: c.get<number>("timeoutSeconds", 90),
    debug: c.get<boolean>("debug", false),
  };
}

/** Where a setting's effective value comes from, so the panel can explain overrides. */
export function settingSource(key: string): "workspace" | "user" | "default" {
  const info = vscode.workspace.getConfiguration(SECTION).inspect(key);
  if (info?.workspaceFolderValue !== undefined || info?.workspaceValue !== undefined) return "workspace";
  if (info?.globalValue !== undefined) return "user";
  return "default";
}

/** Writes to the workspace if the workspace already overrides the key, otherwise to user settings. */
export async function updateSetting(key: string, value: unknown): Promise<"workspace" | "user"> {
  const c = vscode.workspace.getConfiguration(SECTION);
  const info = c.inspect(key);
  const appScoped = key === "model" || key === "claudePath";
  if (!appScoped && (info?.workspaceValue !== undefined || info?.workspaceFolderValue !== undefined)) {
    await c.update(key, value, vscode.ConfigurationTarget.Workspace);
    return "workspace";
  }
  await c.update(key, value, vscode.ConfigurationTarget.Global);
  return "user";
}
