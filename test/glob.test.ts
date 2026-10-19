import { describe, expect, test } from "bun:test";
import { BUILTIN_IGNORE_GLOBS, globToRegExp, matchesAny } from "../src/glob";

describe("glob", () => {
  test("basename patterns match at any depth", () => {
    expect(matchesAny("bun.lock", ["bun.lock"])).toBe(true);
    expect(matchesAny("apps/web/bun.lock", ["bun.lock"])).toBe(true);
    expect(matchesAny("apps/web/bun.lockb", ["bun.lock"])).toBe(false);
  });
  test("star does not cross directories", () => {
    expect(globToRegExp("src/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/x/a.ts")).toBe(false);
  });
  test("double star crosses directories", () => {
    expect(globToRegExp("**/__snapshots__/**").test("src/x/__snapshots__/a.snap")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/x/y/a.ts")).toBe(true);
  });
  test("question mark matches one char", () => {
    expect(globToRegExp("a?.ts").test("ab.ts")).toBe(true);
    expect(globToRegExp("a?.ts").test("abc.ts")).toBe(false);
  });
  test("builtin list catches common noise and leaves source alone", () => {
    for (const p of ["package-lock.json", "web/pnpm-lock.yaml", "dist/app.min.js", "a/b.map", "x/__snapshots__/y.snap", "api/user.pb.go"]) {
      expect(matchesAny(p, BUILTIN_IGNORE_GLOBS)).toBe(true);
    }
    for (const p of ["src/index.css", "src/App.tsx", "package.json", "README.md", "map.ts", "mapping/snap.ts"]) {
      expect(matchesAny(p, BUILTIN_IGNORE_GLOBS)).toBe(false);
    }
  });
});
