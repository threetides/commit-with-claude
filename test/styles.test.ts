import { describe, expect, test } from "bun:test";
import { describeSchema, getStyle, parseJsonObject, STYLES, validate, wrap } from "../src/styles";

describe("conventional", () => {
  const style = getStyle("conventional");
  test("renders type, scope, subject and bullets", () => {
    const out = style.render(
      { type: "feat", scope: "navbar", subject: "Add tooltips to theme toggles.", body: ["wrap each toggle in a Tooltip", "use a shared offset"], breaking: null },
      { bodyMode: "auto" },
    );
    expect(out).toBe("feat(navbar): add tooltips to theme toggles\n\n- Wrap each toggle in a Tooltip\n- Use a shared offset");
  });
  test("omits body when bodyMode is never", () => {
    const out = style.render({ type: "fix", scope: null, subject: "handle empty diff", body: ["x"], breaking: null }, { bodyMode: "never" });
    expect(out).toBe("fix: handle empty diff");
  });
  test("marks breaking changes", () => {
    const out = style.render({ type: "refactor", scope: "api", subject: "rename client", body: [], breaking: "Client is now AuthClient" }, { bodyMode: "auto" });
    expect(out).toBe("refactor(api)!: rename client\n\nBREAKING CHANGE: Client is now AuthClient");
  });
  test("validates against the schema", () => {
    expect(validate(style.schema, { type: "feat", scope: null, subject: "ok", body: [], breaking: null })).toEqual([]);
    const errors = validate(style.schema, { type: "update", subject: "x".repeat(80), body: "not an array" });
    expect(errors.some((e) => e.includes("type"))).toBe(true);
    expect(errors.some((e) => e.includes("subject"))).toBe(true);
    expect(errors.some((e) => e.includes("body"))).toBe(true);
    expect(errors.some((e) => e.includes("scope") && e.includes("required"))).toBe(true);
  });
});

describe("other styles", () => {
  test("scoped falls back to core when scope missing", () => {
    expect(getStyle("conventional-scoped").render({ type: "chore", subject: "bump deps", body: [] }, { bodyMode: "auto" })).toBe("chore(core): bump deps");
  });
  test("angular renders prose paragraphs wrapped at 72", () => {
    const long = "the previous implementation re-rendered the whole list on every keystroke which made typing feel sluggish on slower machines";
    const out = getStyle("angular").render({ type: "perf", scope: "search", subject: "debounce filter input", body: [long], breaking: null }, { bodyMode: "auto" });
    const lines = out.split("\n");
    expect(lines[0]).toBe("perf(search): debounce filter input");
    expect(lines[1]).toBe("");
    expect(lines.slice(2).every((l) => l.length <= 72)).toBe(true);
    expect(lines[2].startsWith("The previous")).toBe(true);
  });
  test("gitmoji maps codes to emoji and capitalises", () => {
    expect(getStyle("gitmoji").render({ gitmoji: "bug", subject: "fix swapped tooltip labels", body: [] }, { bodyMode: "auto" })).toBe("🐛 Fix swapped tooltip labels");
  });
  test("classic capitalises and drops trailing period", () => {
    expect(getStyle("classic").render({ subject: "add social link tooltips.", body: [] }, { bodyMode: "auto" })).toBe("Add social link tooltips");
  });
  test("plain never has a body", () => {
    expect(getStyle("plain").render({ subject: "tidy css", body: ["ignored"] }, { bodyMode: "always" })).toBe("Tidy css");
  });
  test("unknown style id falls back to conventional", () => {
    expect(getStyle("nope").id).toBe("conventional");
  });
  test("every style has a schema description", () => {
    for (const s of STYLES) {
      const d = describeSchema(s.schema);
      expect(d).toContain('"subject"');
    }
  });
});

describe("parsing", () => {
  test("parses plain JSON", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  test("strips code fences", () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test("extracts an object from surrounding prose", () => {
    expect(parseJsonObject('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  test("returns undefined for arrays and garbage", () => {
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("nope")).toBeUndefined();
  });
});

describe("wrap", () => {
  test("wraps at width and keeps newlines", () => {
    expect(wrap("aaa bbb ccc ddd", 7)).toBe("aaa bbb\nccc ddd");
    expect(wrap("one\ntwo three", 20)).toBe("one\ntwo three");
  });
});
