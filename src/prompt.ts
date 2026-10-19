import type { DiffResult } from "./diff";
import { describeSchema, type BodyMode, type CommitStyle } from "./styles";

export interface PromptInput {
  style: CommitStyle;
  bodyMode: BodyMode;
  language: string;
  extraInstructions: string;
  repoName: string;
  branch?: string;
  recentSubjects: string[];
  diff: DiffResult;
}

export function buildSystemPrompt(input: PromptInput): string {
  const { style, bodyMode, language, extraInstructions } = input;
  const bodyRule =
    bodyMode === "never"
      ? "Never include a body: return an empty array for any body field."
      : bodyMode === "always"
        ? "Always include at least one body item."
        : "Include body items only when the subject alone does not explain the change. Small, obvious changes get an empty body.";

  const lines = [
    `You write git commit messages in the "${style.label}" style.`,
    "You will receive a git diff. Reply with ONLY a JSON object, no prose, no markdown, no code fences.",
    "",
    "JSON fields:",
    describeSchema(style.schema),
    "",
    "Rules:",
    `- Write in ${language}.`,
    "- Describe what the change does and why, from the perspective of someone reading history later. Do not narrate the diff or list file names unless the file itself is the point.",
    "- Imperative mood throughout: \"add\", \"fix\", \"remove\", never \"added\" or \"adds\".",
    "- Never mention that the message was generated, never add commentary or notes outside the fields.",
    `- ${bodyRule}`,
    ...style.instructions.map((s) => `- ${s}`),
    ...(extraInstructions ? [`- ${extraInstructions}`] : []),
  ];
  return lines.join("\n");
}

export function buildUserPrompt(input: PromptInput): string {
  const { repoName, branch, recentSubjects, diff } = input;
  const parts: string[] = [`Repository: ${repoName}`];
  if (branch) parts.push(`Branch: ${branch}`);
  parts.push(`Changes: ${diff.staged ? "staged" : "unstaged and untracked (nothing is staged)"}`);
  if (recentSubjects.length) {
    parts.push("", "Recent commit subjects in this repository (match their vocabulary and scope names where it fits, but follow the required style):");
    parts.push(...recentSubjects.map((s) => `- ${s}`));
  }
  parts.push("", "Diff:", diff.text);
  return parts.join("\n");
}
