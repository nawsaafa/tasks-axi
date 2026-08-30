import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESCRIPTION } from "../src/cli.js";
import {
  CANONICAL_GIT_SPEC,
  CANONICAL_INVOKE,
  CANONICAL_OWNER_REPO,
  CANONICAL_TAG,
  createSkillMarkdown,
  PENDING_RELEASE_NOTE,
  SKILL_AUTHOR,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

const UNSCOPED_NPX = /npx(?:\s+-y)?\s+tasks-axi(?:\s|$|`)/;
const UPSTREAM_PACKAGE = /kunchenguid\/tasks-axi|npmjs\.com\/package\/tasks-axi/;

describe("skill generation", () => {
  it("keeps frontmatter identity and defers instructions to the CLI", () => {
    const md = createSkillMarkdown();
    expect(md.startsWith("---\nname: tasks-axi\n")).toBe(true);
    expect(md).toContain(JSON.stringify(SKILL_DESCRIPTION));
    expect(md).toContain("metadata:");
    expect(md).toContain(DESCRIPTION);
    expect(md).toContain(`author: ${SKILL_AUTHOR}`);
    expect(md).toContain(CANONICAL_OWNER_REPO);
    expect(md).toContain(`\`${CANONICAL_INVOKE}\``);
    expect(md).toContain(`\`${CANONICAL_INVOKE} --help\``);
    expect(md).toContain(`\`${CANONICAL_INVOKE} <command> --help\``);
  });

  it("identifies the canonical fork and uses only Git source/tag invocation", () => {
    const md = createSkillMarkdown();
    expect(SKILL_AUTHOR).toBe("nawsaafa");
    expect(CANONICAL_GIT_SPEC).toMatch(
      /^github:nawsaafa\/tasks-axi#tasks-axi-v\d+\.\d+\.\d+$/,
    );
    expect(md).toContain(`github.com/${CANONICAL_OWNER_REPO}`);
    expect(md).toContain("not published to npm");
    expect(md).not.toMatch(UNSCOPED_NPX);
    expect(md).not.toMatch(UPSTREAM_PACKAGE);
    expect(md).not.toContain("Kun Chen");
    expect(md).not.toContain("kunchenguid");
  });

  it("carries the pending-release caveat alongside its pinned commands", () => {
    const committed = normalizeLineEndings(
      readFileSync(
        new URL("../skills/tasks-axi/SKILL.md", import.meta.url),
        "utf8",
      ),
    );

    expect(PENDING_RELEASE_NOTE).toContain(CANONICAL_TAG);
    expect(PENDING_RELEASE_NOTE).toMatch(/separately authorized manual GitHub release/);

    const lastCommand = committed.lastIndexOf(`\`${CANONICAL_INVOKE} <command> --help\``);
    const caveat = committed.indexOf(PENDING_RELEASE_NOTE);

    expect(lastCommand).toBeGreaterThan(-1);
    expect(caveat).toBeGreaterThan(lastCommand);
  });

  it("does not bake CLI-owned command, flag, or workflow text", () => {
    const md = createSkillMarkdown();
    expect(md).not.toContain("## Commands");
    expect(md).not.toContain("## Tips");
    expect(md).not.toContain("## Workflow");
    expect(md).not.toMatch(/^commands\[\d+\]:/m);
  });

  it("matches the committed skill file (guards against drift)", () => {
    const committed = readFileSync(
      new URL("../skills/tasks-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(normalizeLineEndings(committed)).toBe(createSkillMarkdown());
    expect(normalizeLineEndings(committed)).not.toMatch(UNSCOPED_NPX);
    expect(normalizeLineEndings(committed)).not.toMatch(UPSTREAM_PACKAGE);
  });
});
