import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(root, ".github", "workflows");

const PUBLISH_RUN =
  /\b(?:npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/;
const PUBLISH_ACTION =
  /(?:^|\/)(?:npm-publish|JS-DevTools\/npm-publish)(?:@|$)/i;

function collectRunsAndUses(
  node: unknown,
  out: { run: string[]; uses: string[] },
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectRunsAndUses(item, out);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.run === "string") out.run.push(record.run);
  if (typeof record.uses === "string") out.uses.push(record.uses);
  for (const value of Object.values(record)) collectRunsAndUses(value, out);
}

describe("canonical fork provenance", () => {
  it("points package identity URLs at nawsaafa/tasks-axi", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      repository?: { url?: string };
      homepage?: string;
      bugs?: { url?: string };
      bin?: Record<string, string>;
    };

    expect(pkg.name).toBe("tasks-axi");
    expect(pkg.bin).toEqual({ "tasks-axi": "dist/bin/tasks-axi.js" });
    expect(pkg.repository?.url).toBe(
      "git+https://github.com/nawsaafa/tasks-axi.git",
    );
    expect(pkg.homepage).toBe("https://github.com/nawsaafa/tasks-axi#readme");
    expect(pkg.bugs?.url).toBe("https://github.com/nawsaafa/tasks-axi/issues");
    expect(pkg.repository?.url).not.toContain("kunchenguid/tasks-axi");
    expect(pkg.homepage).not.toContain("kunchenguid/tasks-axi");
    expect(pkg.bugs?.url).not.toContain("kunchenguid/tasks-axi");
  });

  it("keeps release-please bookkeeping on the canonical version", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version: string };
    const manifest = JSON.parse(
      readFileSync(join(root, ".release-please-manifest.json"), "utf8"),
    ) as Record<string, string>;

    expect(manifest["."]).toBe(pkg.version);
  });

  it("documents Git source/tag install paths and no-npm publication", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain("nawsaafa/tasks-axi");
    expect(readme).toContain("github:nawsaafa/tasks-axi#v");
    expect(readme).toMatch(/no-npm publication/i);
    expect(readme).not.toContain("kunchenguid/tasks-axi");
    expect(readme).not.toContain("npmjs.com/package/tasks-axi");
    expect(readme).not.toMatch(/npx(?:\s+-y)?\s+tasks-axi(?:\s|$|`)/);
    expect(readme).not.toMatch(/npm install(?:\s+-g)?\s+tasks-axi(?:\s|$)/);
  });
});

describe("no-npm release enforcement", () => {
  it("has no active npm-publish command or action in GitHub workflows", () => {
    const files = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    expect(files).toContain("release-please.yml");

    const failures: string[] = [];
    for (const name of files) {
      const doc = parse(readFileSync(join(workflowsDir, name), "utf8"));
      const found = { run: [] as string[], uses: [] as string[] };
      collectRunsAndUses(doc, found);

      for (const run of found.run) {
        if (PUBLISH_RUN.test(run)) {
          failures.push(`${name} run: ${run.trim()}`);
        }
      }
      for (const uses of found.uses) {
        if (PUBLISH_ACTION.test(uses)) {
          failures.push(`${name} uses: ${uses}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps release_created paths incapable of npm publication", () => {
    const source = readFileSync(
      join(workflowsDir, "release-please.yml"),
      "utf8",
    );
    const doc = parse(source);
    const found = { run: [] as string[], uses: [] as string[] };
    collectRunsAndUses(doc, found);

    expect(found.uses.some((uses) => uses.includes("googleapis/release-please-action"))).toBe(true);
    expect(found.run.filter((run) => PUBLISH_RUN.test(run))).toEqual([]);
    expect(found.uses.filter((uses) => PUBLISH_ACTION.test(uses))).toEqual([]);
    expect(source).not.toMatch(/registry-url:\s*["']https:\/\/registry\.npmjs\.org["']/);
    expect(source).not.toMatch(/id-token:\s*write/);
  });
});
