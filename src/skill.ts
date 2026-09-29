import { DESCRIPTION } from "./cli.js";

// Trigger string agents match against to auto-load the skill. Terse and
// outcome-focused so it fires on "manage the backlog / track tasks" intents.
export const SKILL_DESCRIPTION =
  "Manage a task backlog through the tasks-axi CLI - add, list, show, start, " +
  "and complete tasks; track blocked-by dependencies, structured holds, and a " +
  "ready queue; prune and normalize a hand-editable backlog.md. Use whenever a task touches " +
  "backlog or task state: filing or dispatching work, recording a PR or report " +
  "on completion, finding dispatchable or held work, or trimming the Done list.";

export const CANONICAL_OWNER_REPO = "nawsaafa/tasks-axi";
export const CANONICAL_REF = "main";
export const CANONICAL_GIT_SPEC = `github:${CANONICAL_OWNER_REPO}#${CANONICAL_REF}`;
export const CANONICAL_INVOKE = `npx -y ${CANONICAL_GIT_SPEC}`;
export const PUBLISHED_UNINSTALLABLE_TAG = "v0.3.0";
export const PENDING_RELEASE_TAG = "v0.3.1";
export const PENDING_RELEASE_NOTE = `\`${CANONICAL_REF}\` is a moving branch ref, not an immutable pin. The published \`${PUBLISHED_UNINSTALLABLE_TAG}\` tag carries no build step, so a Git-source install from it yields no runnable CLI - do not pin it. Pin \`${PENDING_RELEASE_TAG}\` instead once its separately authorized release is published.`;
export const SKILL_AUTHOR = "nawsaafa";

// Extended frontmatter read by Nous Research's Hermes Agent harness; harnesses
// that don't know these fields (e.g. Claude Code) ignore them.
export const HERMES_TAGS = ["tasks", "backlog", "planning", "dependencies"];
export const HERMES_CATEGORY = "productivity";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render the installable SKILL.md as a minimal stub.
 *
 * Frontmatter is the skill's identity and discovery surface. The body only
 * says what tasks-axi is, when to reach for it, and where to get live
 * instructions: the CLI itself. Never bake CLI-owned commands, flags, or
 * workflow steps here - an installed skill goes stale when the Git source
 * is bumped, and `pnpm run build:skill` would re-inflate any such copy.
 */
export function createSkillMarkdown(): string {
  return `---
name: tasks-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# tasks-axi

${DESCRIPTION}

Canonical fork: https://github.com/${CANONICAL_OWNER_REPO}
This fork is not published to npm. Invoke the CLI from the Git source ref below; never from the public npm registry.

## When to use

Use tasks-axi whenever a task touches the backlog: filing or dispatching work, moving a task through queued -> in flight -> done, recording a PR url or report path on completion, tracking blocked-by dependencies, pausing dispatch with structured holds, finding dispatchable ready work or intentionally held work, or trimming the Done list.

Get every command, flag, and workflow from the live CLI - it is the single source of truth:

- \`${CANONICAL_INVOKE}\` - dashboard of the current backlog
- \`${CANONICAL_INVOKE} --help\` - global usage
- \`${CANONICAL_INVOKE} <command> --help\` - per-command usage

${PENDING_RELEASE_NOTE}

If the CLI prints a follow-up starting with \`tasks-axi\`, rerun it with the same Git source ref prefix instead of an unscoped registry package name.
`;
}
