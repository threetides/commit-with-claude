/** Minimal glob matcher: supports `*`, `**`, `?`. A pattern without `/` matches against any path segment suffix. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$+.()|{}[]".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  const anchored = glob.includes("/") ? `^${re}$` : `(?:^|/)${re}$`;
  return new RegExp(anchored);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Files whose diffs are noise for a commit message. Replaced by a one-line summary. */
export const BUILTIN_IGNORE_GLOBS: readonly string[] = [
  // lockfiles
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  ".pnp.cjs",
  ".pnp.loader.mjs",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "flake.lock",
  "mix.lock",
  "Podfile.lock",
  "Package.resolved",
  "pubspec.lock",
  // generated / compiled artefacts
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.snap",
  "**/__snapshots__/**",
  "*.pb.go",
  "*.pb.ts",
  "*_pb2.py",
  "*.g.dart",
  "*.freezed.dart",
  "*.generated.*",
  "*.d.ts.map",
];
