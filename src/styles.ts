/**
 * Commit message styles. Each style owns a JSON schema the model must fill and a
 * renderer that turns the fields into the final text. The model decides content,
 * the renderer decides layout, so the format never drifts.
 *
 * This module has no VS Code dependency so it can be unit tested with `bun test`.
 */

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: string[];
  maxLength?: number;
  minLength?: number;
  maxItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

export type BodyMode = "auto" | "always" | "never";

export interface RenderOptions {
  bodyMode: BodyMode;
}

export interface CommitStyle {
  id: string;
  label: string;
  /** Shown under the dropdown in the panel. */
  help: string;
  /** Extra rules given to the model, one per line. */
  instructions: string[];
  schema: JsonSchema;
  render(data: Record<string, unknown>, opts: RenderOptions): string;
}

// ---------- helpers ----------

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === "string" ? v.trim() : "";
}

function arr(data: Record<string, unknown>, key: string): string[] {
  const v = data[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean) : [];
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function upperFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function stripPeriod(s: string): string {
  return s.replace(/[.。]+$/u, "");
}

/** Greedy word wrap. Existing newlines are kept. */
export function wrap(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      const out: string[] = [];
      let cur = "";
      for (const w of words) {
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= width) cur += " " + w;
        else {
          out.push(cur);
          cur = w;
        }
      }
      if (cur) out.push(cur);
      return out.join("\n");
    })
    .join("\n");
}

function bodyAllowed(opts: RenderOptions): boolean {
  return opts.bodyMode !== "never";
}

function bullets(items: string[]): string {
  return items.map((b) => `- ${stripPeriod(upperFirst(b))}`).join("\n");
}

function paragraphs(items: string[], width = 72): string {
  return items.map((p) => wrap(upperFirst(p), width)).join("\n\n");
}

// ---------- shared schema pieces ----------

const CONVENTIONAL_TYPES = ["feat", "fix", "refactor", "perf", "docs", "style", "test", "build", "ci", "chore", "revert"];
const ANGULAR_TYPES = ["feat", "fix", "refactor", "perf", "docs", "test", "build", "ci"];

const scopeField = (required: boolean): JsonSchema => ({
  type: required ? "string" : ["string", "null"],
  maxLength: 30,
  description: required
    ? "Area of the codebase touched: lowercase, one or two words, e.g. navbar, auth, deps. Always present."
    : "Area of the codebase touched: lowercase, one or two words, e.g. navbar, auth, deps. null when the change is broad.",
});

const subjectField = (max: number, casing: "lower" | "upper"): JsonSchema => ({
  type: "string",
  maxLength: max,
  description: `Imperative mood ("add", not "added" or "adds"), ${casing === "lower" ? "lowercase" : "capitalised"} first letter, no trailing period, max ${max} characters.`,
});

const bulletBodyField: JsonSchema = {
  type: "array",
  maxItems: 6,
  items: { type: "string", maxLength: 120 },
  description: "Short bullet points saying what changed and why. Empty array when the subject says it all.",
};

const proseBodyField: JsonSchema = {
  type: "array",
  maxItems: 4,
  items: { type: "string", maxLength: 400 },
  description: "Paragraphs explaining the motivation and how behaviour differs from before. Empty array when the subject says it all.",
};

const breakingField: JsonSchema = {
  type: ["string", "null"],
  maxLength: 200,
  description: "Describe a breaking change for users of this code, else null.",
};

// ---------- gitmoji ----------

export const GITMOJI: Record<string, { emoji: string; meaning: string }> = {
  sparkles: { emoji: "✨", meaning: "new feature" },
  bug: { emoji: "🐛", meaning: "bug fix" },
  ambulance: { emoji: "🚑️", meaning: "critical hotfix" },
  recycle: { emoji: "♻️", meaning: "refactor" },
  zap: { emoji: "⚡️", meaning: "performance" },
  lipstick: { emoji: "💄", meaning: "UI and style files" },
  art: { emoji: "🎨", meaning: "structure or formatting of code" },
  memo: { emoji: "📝", meaning: "documentation" },
  white_check_mark: { emoji: "✅", meaning: "tests" },
  wrench: { emoji: "🔧", meaning: "configuration" },
  hammer: { emoji: "🔨", meaning: "development scripts" },
  fire: { emoji: "🔥", meaning: "remove code or files" },
  truck: { emoji: "🚚", meaning: "move or rename" },
  arrow_up: { emoji: "⬆️", meaning: "upgrade dependencies" },
  arrow_down: { emoji: "⬇️", meaning: "downgrade dependencies" },
  heavy_plus_sign: { emoji: "➕", meaning: "add a dependency" },
  heavy_minus_sign: { emoji: "➖", meaning: "remove a dependency" },
  construction_worker: { emoji: "👷", meaning: "CI" },
  green_heart: { emoji: "💚", meaning: "fix CI" },
  rocket: { emoji: "🚀", meaning: "deployment" },
  lock: { emoji: "🔒️", meaning: "security" },
  rotating_light: { emoji: "🚨", meaning: "linter warnings" },
  pencil2: { emoji: "✏️", meaning: "typos" },
  wheelchair: { emoji: "♿️", meaning: "accessibility" },
  globe_with_meridians: { emoji: "🌐", meaning: "i18n and l10n" },
  label: { emoji: "🏷️", meaning: "types" },
  boom: { emoji: "💥", meaning: "breaking change" },
  bookmark: { emoji: "🔖", meaning: "release or version tag" },
  tada: { emoji: "🎉", meaning: "begin a project" },
  construction: { emoji: "🚧", meaning: "work in progress" },
  see_no_evil: { emoji: "🙈", meaning: ".gitignore" },
  coffin: { emoji: "⚰️", meaning: "remove dead code" },
  technologist: { emoji: "🧑‍💻", meaning: "developer experience" },
};

// ---------- styles ----------

const conventionalRender =
  (requireScope: boolean) =>
  (data: Record<string, unknown>, opts: RenderOptions): string => {
    const type = str(data, "type") || "chore";
    const scope = str(data, "scope");
    const subject = stripPeriod(lowerFirst(str(data, "subject")));
    const breaking = str(data, "breaking");
    const scopePart = scope ? `(${scope})` : requireScope ? "(core)" : "";
    let out = `${type}${scopePart}${breaking ? "!" : ""}: ${subject}`;
    const body = arr(data, "body");
    if (bodyAllowed(opts) && body.length) out += "\n\n" + bullets(body);
    if (breaking) out += `\n\nBREAKING CHANGE: ${upperFirst(breaking)}`;
    return out;
  };

const conventional: CommitStyle = {
  id: "conventional",
  label: "Conventional Commits",
  help:
    "The de facto standard: a type like feat or fix, an optional scope, and a short imperative subject. " +
    "Body is bullet points. Tooling such as semantic-release and commitlint understands it.",
  instructions: [
    "Pick the single type that best describes the change. Use feat only for user-visible functionality, fix only for bugs.",
    "Scope is the area touched, taken from directory or component names. Reuse scopes seen in recent commits when they fit.",
  ],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["type", "scope", "subject", "body", "breaking"],
    properties: {
      type: { type: "string", enum: CONVENTIONAL_TYPES, description: "Kind of change." },
      scope: scopeField(false),
      subject: subjectField(60, "lower"),
      body: bulletBodyField,
      breaking: breakingField,
    },
  },
  render: conventionalRender(false),
};

const conventionalScoped: CommitStyle = {
  ...conventional,
  id: "conventional-scoped",
  label: "Conventional Commits, scope required",
  help:
    "Same as Conventional Commits but every message names the area it touches, e.g. feat(navbar). " +
    "Good for monorepos and larger apps where the subject alone is too vague.",
  schema: {
    ...conventional.schema,
    properties: { ...conventional.schema.properties, scope: scopeField(true) },
  },
  render: conventionalRender(true),
};

const angular: CommitStyle = {
  id: "angular",
  label: "Angular",
  help:
    "The convention Conventional Commits grew out of. Stricter type list, scope required, lowercase subject. " +
    "The body is prose explaining why the change was made and how behaviour differs from before.",
  instructions: [
    "Types are limited to the Angular set. Routine maintenance that fits none of them is build or refactor, never chore.",
    "The body explains motivation and contrasts new behaviour with previous behaviour. Do not list files.",
  ],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["type", "scope", "subject", "body", "breaking"],
    properties: {
      type: { type: "string", enum: ANGULAR_TYPES, description: "Kind of change." },
      scope: scopeField(true),
      subject: subjectField(60, "lower"),
      body: proseBodyField,
      breaking: breakingField,
    },
  },
  render(data, opts) {
    const type = str(data, "type") || "refactor";
    const scope = str(data, "scope") || "core";
    const subject = stripPeriod(lowerFirst(str(data, "subject")));
    const breaking = str(data, "breaking");
    let out = `${type}(${scope}): ${subject}`;
    const body = arr(data, "body");
    if (bodyAllowed(opts) && body.length) out += "\n\n" + paragraphs(body);
    if (breaking) out += `\n\nBREAKING CHANGE: ${wrap(upperFirst(breaking), 72)}`;
    return out;
  },
};

const gitmoji: CommitStyle = {
  id: "gitmoji",
  label: "Gitmoji",
  help:
    "An emoji up front signals the kind of change at a glance: ✨ feature, 🐛 fix, ♻️ refactor. " +
    "Capitalised subject, bullet body. Popular in open source and design-heavy teams.",
  instructions: ["Choose the gitmoji code whose meaning matches the change best. One emoji only."],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["gitmoji", "subject", "body"],
    properties: {
      gitmoji: {
        type: "string",
        enum: Object.keys(GITMOJI),
        description: "Gitmoji code. Meanings: " + Object.entries(GITMOJI).map(([k, v]) => `${k}=${v.meaning}`).join(", "),
      },
      subject: subjectField(60, "upper"),
      body: bulletBodyField,
    },
  },
  render(data, opts) {
    const code = str(data, "gitmoji");
    const emoji = GITMOJI[code]?.emoji ?? "✨";
    const subject = stripPeriod(upperFirst(str(data, "subject")));
    let out = `${emoji} ${subject}`;
    const body = arr(data, "body");
    if (bodyAllowed(opts) && body.length) out += "\n\n" + bullets(body);
    return out;
  },
};

const classic: CommitStyle = {
  id: "classic",
  label: "Classic 50/72",
  help:
    "The traditional git style from Tim Pope and the Linux kernel. A capitalised subject of at most 50 characters, " +
    "a blank line, then prose paragraphs wrapped at 72 explaining why. No type prefixes.",
  instructions: [
    "The subject is a complete thought in at most 50 characters. Finish the sentence \"If applied, this commit will ...\".",
    "The body explains why the change was needed and what it does differently. Do not list files.",
  ],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body"],
    properties: {
      subject: subjectField(50, "upper"),
      body: proseBodyField,
    },
  },
  render(data, opts) {
    const subject = stripPeriod(upperFirst(str(data, "subject")));
    const body = arr(data, "body");
    return bodyAllowed(opts) && body.length ? `${subject}\n\n${paragraphs(body)}` : subject;
  },
};

const plain: CommitStyle = {
  id: "plain",
  label: "One-liner",
  help: "Just one short imperative line, capitalised, no body and no type prefix. For solo projects and quick iterations.",
  instructions: ["Summarise the whole change in a single line. Never produce a body."],
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject"],
    properties: {
      subject: subjectField(72, "upper"),
    },
  },
  render(data) {
    return stripPeriod(upperFirst(str(data, "subject")));
  },
};

export const STYLES: readonly CommitStyle[] = [conventional, conventionalScoped, angular, gitmoji, classic, plain];

export function getStyle(id: string | undefined): CommitStyle {
  return STYLES.find((s) => s.id === id) ?? conventional;
}

// ---------- schema description for the prompt ----------

function typeOf(s: JsonSchema): string {
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const nullable = types.includes("null");
  const main = types.find((t) => t !== "null") ?? "string";
  let desc: string;
  if (s.enum) desc = "one of " + s.enum.join(" | ");
  else if (main === "array") desc = `array of up to ${s.maxItems ?? "N"} strings`;
  else if (main === "string") desc = s.maxLength ? `string, max ${s.maxLength} chars` : "string";
  else desc = main;
  return nullable ? `${desc}, or null` : desc;
}

/** Compact, human-readable description of the schema for the system prompt. */
export function describeSchema(schema: JsonSchema): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(props)
    .map(([k, s]) => {
      const t = typeOf(s);
      // enum lists for gitmoji are long; keep meanings out of the type line
      const d = s.description ? ` — ${s.description}` : "";
      return `  "${k}": ${t}${required.has(k) ? "" : " (optional)"}${d}`;
    })
    .join("\n");
}

// ---------- validation ----------

export function validate(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

  if (value === null || value === undefined) {
    if (types.includes("null")) return errors;
    if (types.length) errors.push(`${path} must not be null`);
    return errors;
  }

  const actual = Array.isArray(value) ? "array" : typeof value;
  if (types.length && !types.includes(actual)) {
    errors.push(`${path} must be ${types.join(" or ")}, got ${actual}`);
    return errors;
  }

  if (typeof value === "string") {
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} exceeds ${schema.maxLength} characters`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength} characters`);
  }

  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)));
  }

  if (actual === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj) errors.push(...validate(sub, obj[key], `${path}.${key}`));
    }
  }
  return errors;
}

/** Pull a JSON object out of a model reply, tolerating code fences and stray prose. */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return undefined;
}
