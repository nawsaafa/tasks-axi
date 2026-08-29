import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import {
  parseBacklog,
  renderBacklog,
} from "../../src/backends/markdown-grammar.js";
import {
  CONTINUATION_HELP,
  continuationCommand,
  continuationSubcommandHelp,
} from "../../src/commands/continuation.js";
import {
  listCommand,
  rmCommand,
  showCommand,
} from "../../src/commands/crud.js";
import { pruneCommand, renderCommand } from "../../src/commands/maintain.js";
import { publicFollowupCommand } from "../../src/commands/public-followup.js";
import {
  doneCommand,
  holdCommand,
  mvCommand,
  readyCommand,
  reopenCommand,
  startCommand,
} from "../../src/commands/state.js";
import { readyTasks } from "../../src/derive.js";
import { makeBacklog, type TempBacklog } from "../helpers.js";

/**
 * One owner row, one live child row, and two unrelated rows that must survive
 * every continuation operation byte-for-byte.
 */
const HOME = [
  "# Backlog",
  "",
  "## In flight",
  "- [ ] rollout-h7 - SHIP roll the widget out (repo: widget) (since 2026-06-22)",
  "- Free-form note nobody owns.",
  "",
  "## Queued",
  "- [ ] rollout-phase2-k3 - phase two of the rollout (repo: widget) (since 2026-06-22)",
  "- [ ] unrelated-q1 - unrelated work (repo: other) (since 2026-06-22)",
  "",
  "## Done",
  "- [x] older-d1 - something finished (done 2026-06-20)",
  "",
].join("\n");

function backlog(content = HOME): TempBacklog {
  return makeBacklog(content);
}

async function run(
  b: TempBacklog,
  command: string,
  args: string[] = [],
): Promise<string> {
  return continuationCommand([command, ...args], b.ctx);
}

async function set(
  b: TempBacklog,
  owner = "rollout-h7",
  child = "rollout-phase2-k3",
  extra: string[] = [],
): Promise<string> {
  return run(b, "set", [owner, "--child", child, ...extra]);
}

describe("continuation commands", () => {
  describe("help", () => {
    it("documents the relation and its deliberate non-effects", () => {
      expect(CONTINUATION_HELP).toContain("set <owner-id> --child <child-id>");
      expect(continuationSubcommandHelp("set")).toContain(
        "tasks-axi continuation set",
      );
      expect(continuationSubcommandHelp("nope")).toBeUndefined();
    });

    it("rejects an unknown or missing subcommand", async () => {
      const b = backlog();
      try {
        await expect(run(b, "wat")).rejects.toThrow(
          /Unknown continuation command: wat/,
        );
        await expect(continuationCommand([], b.ctx)).rejects.toThrow(
          /Missing continuation command/,
        );
      } finally {
        b.cleanup();
      }
    });
  });

  describe("set", () => {
    it("records one canonical tag and confirms the write", async () => {
      const b = backlog();
      try {
        const out = await set(b);
        expect(out).toContain(
          "ok: continuation rollout-h7 -> owns rollout-phase2-k3",
        );
        expect(out).toContain("child_state: queued");
        expect(out).toContain("fault: none");
        expect(b.read()).toContain(
          "- [ ] rollout-h7 - SHIP roll the widget out (repo: widget) (since 2026-06-22) (continuation: rollout-phase2-k3)",
        );
        // The child row is untouched: ownership is recorded on the owner only.
        expect(b.read()).toContain(
          "- [ ] rollout-phase2-k3 - phase two of the rollout (repo: widget) (since 2026-06-22)",
        );
        expect(decode(out)).toBeTruthy();
      } finally {
        b.cleanup();
      }
    });

    it("is idempotent and reports already", async () => {
      const b = backlog();
      try {
        await set(b);
        const before = b.read();
        const out = await set(b);
        expect(out).toContain(
          "ok: continuation rollout-h7 already owns rollout-phase2-k3",
        );
        expect(out).toContain("already: true");
        expect(b.read()).toBe(before);
      } finally {
        b.cleanup();
      }
    });

    it("emits a machine-readable --json result", async () => {
      const b = backlog();
      try {
        const payload = JSON.parse(
          await set(b, "rollout-h7", "rollout-phase2-k3", ["--json"]),
        );
        expect(payload).toMatchObject({
          ok: true,
          action: "continuation set",
          continuation: {
            owner: "rollout-h7",
            child: "rollout-phase2-k3",
            child_state: "queued",
            fault: null,
          },
        });
        expect(payload.task.continuation).toEqual({
          child: "rollout-phase2-k3",
        });
      } finally {
        b.cleanup();
      }
    });

    it("replaces the single relation rather than accumulating one", async () => {
      const b = backlog();
      try {
        await set(b);
        await set(b, "rollout-h7", "unrelated-q1");
        const read = b.read();
        expect(read).toContain("(continuation: unrelated-q1)");
        expect(read).not.toContain("(continuation: rollout-phase2-k3)");
        expect(read.match(/\(continuation:/g)).toHaveLength(1);
      } finally {
        b.cleanup();
      }
    });
  });

  describe("set negative controls", () => {
    it("never creates the named child row", async () => {
      const b = backlog();
      try {
        await expect(set(b, "rollout-h7", "ghost-k9")).rejects.toThrow(
          /Continuation child "ghost-k9" not found/,
        );
        const read = b.read();
        expect(read).not.toContain("ghost-k9");
        expect(read).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a self-named child", async () => {
      const b = backlog();
      try {
        await expect(set(b, "rollout-h7", "rollout-h7")).rejects.toThrow(
          /cannot name itself/,
        );
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a malformed child id", async () => {
      const b = backlog();
      try {
        await expect(
          continuationCommand(
            ["set", "rollout-h7", "--child", "not an id"],
            b.ctx,
          ),
        ).rejects.toThrow(/Invalid id/);
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a missing --child", async () => {
      const b = backlog();
      try {
        await expect(
          continuationCommand(["set", "rollout-h7"], b.ctx),
        ).rejects.toThrow(/--child <id> is required/);
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("refuses an unknown owner", async () => {
      const b = backlog();
      try {
        await expect(set(b, "ghost-h9", "unrelated-q1")).rejects.toThrow(
          /not found in this backlog/,
        );
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a child that is not live", async () => {
      const b = backlog();
      try {
        await expect(set(b, "rollout-h7", "older-d1")).rejects.toThrow(
          /is already Done/,
        );
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("stays idempotent when the owned child has since gone Done", async () => {
      const b = backlog();
      try {
        await set(b);
        await doneCommand(["rollout-phase2-k3"], b.ctx);
        const before = b.read();
        const out = await set(b);
        expect(out).toContain(
          "ok: continuation rollout-h7 already owns rollout-phase2-k3",
        );
        expect(out).toContain("already: true");
        expect(b.read()).toBe(before);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a second owner for one child", async () => {
      const b = backlog();
      try {
        await set(b);
        await expect(
          set(b, "unrelated-q1", "rollout-phase2-k3"),
        ).rejects.toThrow(/already owned by "rollout-h7"/);
        expect(b.read().match(/\(continuation:/g)).toHaveLength(1);
      } finally {
        b.cleanup();
      }
    });

    it("refuses a public-followup obligation on either end", async () => {
      const b = backlog();
      try {
        const file = (name: string, value: unknown): string => {
          const path = join(b.dir, name);
          writeFileSync(path, JSON.stringify(value), "utf8");
          return path;
        };
        await publicFollowupCommand(
          [
            "add",
            "public-final-ab",
            "--request-context-file",
            file("request.json", {
              request_id: "req-public-demo",
              platform: "discord",
              context_binding: { version: "ctx1", value: "ctx1_opaque_demo" },
              public_safe_summary: "Follow up when the public-safe fix ships",
              received_at: "2026-07-13T12:00:00Z",
              followup_expires_at: "2026-08-13T12:00:00Z",
              reservation_expires_at: "2026-09-13T12:00:00Z",
            }),
            "--purpose",
            "promised-final",
            "--expected-final-file",
            file("expected.json", {
              type: "pr-merged",
              project: "demo",
              required_deliverables: ["pr_url"],
              completion_policy: "all-required",
            }),
            "--expires-at",
            "2026-10-01T00:00:00Z",
            "--json",
          ],
          b.ctx,
        );

        await expect(
          set(b, "public-final-ab", "rollout-phase2-k3"),
        ).rejects.toThrow(/cannot own a continuation relation/);
        await expect(set(b, "rollout-h7", "public-final-ab")).rejects.toThrow(
          /is a public-followup obligation/,
        );
        expect(b.read()).not.toContain("(continuation:");
      } finally {
        b.cleanup();
      }
    });
  });

  describe("clear", () => {
    it("releases the relation and leaves the row otherwise byte-identical", async () => {
      const b = backlog();
      try {
        await set(b);
        const out = await run(b, "clear", ["rollout-h7"]);
        expect(out).toContain(
          "ok: continuation rollout-h7 -> cleared rollout-phase2-k3",
        );
        expect(b.read()).not.toContain("(continuation:");
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("is idempotent on a row that owns nothing", async () => {
      const b = backlog();
      try {
        const out = await run(b, "clear", ["rollout-h7"]);
        expect(out).toContain(
          "ok: continuation rollout-h7 already owns nothing",
        );
        expect(out).toContain("already: true");
        expect(b.read()).toBe(HOME);
      } finally {
        b.cleanup();
      }
    });

    it("repairs a hand-edited dangling relation", async () => {
      const dangling = HOME.replace(
        "(since 2026-06-22)\n- Free-form",
        "(since 2026-06-22) (continuation: ghost-k9)\n- Free-form",
      );
      const b = backlog(dangling);
      try {
        // Every ordinary write is refused while the fault stands...
        await expect(startCommand(["unrelated-q1"], b.ctx)).rejects.toThrow(
          /Continuation child "ghost-k9" named by "rollout-h7" does not exist/,
        );
        // ...but the fault is visible, and the repair itself lands.
        expect(await run(b, "list")).toContain("ghost-k9");
        await run(b, "clear", ["rollout-h7"]);
        expect(b.read()).toBe(HOME);
        await startCommand(["unrelated-q1"], b.ctx);
      } finally {
        b.cleanup();
      }
    });

    it("repairs a hand-edited home carrying two faults, one clear at a time", async () => {
      const twoFaults = HOME.replace(
        "SHIP roll the widget out (repo: widget) (since 2026-06-22)",
        "SHIP roll the widget out (repo: widget) (since 2026-06-22) (continuation: ghost-1)",
      ).replace(
        "unrelated work (repo: other) (since 2026-06-22)",
        "unrelated work (repo: other) (since 2026-06-22) (continuation: ghost-2)",
      );
      const b = backlog(twoFaults);
      try {
        await expect(
          startCommand(["rollout-phase2-k3"], b.ctx),
        ).rejects.toThrow(/"ghost-1"/);

        await run(b, "clear", ["rollout-h7"]);
        expect(b.read()).not.toContain("(continuation: ghost-1)");
        expect(b.read()).toContain("(continuation: ghost-2)");

        await expect(
          startCommand(["rollout-phase2-k3"], b.ctx),
        ).rejects.toThrow(/"ghost-2"/);

        await run(b, "clear", ["unrelated-q1"]);
        expect(b.read()).not.toContain("(continuation:");
        expect(JSON.parse(await run(b, "list", ["--json"])).faults).toEqual([]);
        await startCommand(["rollout-phase2-k3"], b.ctx);
      } finally {
        b.cleanup();
      }
    });

    it("repairs a duplicated owner naming one missing child", async () => {
      const duplicated = HOME.replace(
        "SHIP roll the widget out (repo: widget) (since 2026-06-22)",
        "SHIP roll the widget out (repo: widget) (since 2026-06-22) (continuation: ghost-k9)",
      ).replace(
        "unrelated work (repo: other) (since 2026-06-22)",
        "unrelated work (repo: other) (since 2026-06-22) (continuation: ghost-k9)",
      );
      const b = backlog(duplicated);
      try {
        const listed = JSON.parse(await run(b, "list", ["--json"]));
        expect(listed.faults.map((f: { code: string }) => f.code)).toEqual([
          "dangling",
          "conflict",
        ]);

        await run(b, "clear", ["rollout-h7"]);
        await run(b, "clear", ["unrelated-q1"]);
        expect(b.read()).not.toContain("(continuation:");
        expect(JSON.parse(await run(b, "list", ["--json"])).faults).toEqual([]);
        await startCommand(["rollout-phase2-k3"], b.ctx);
      } finally {
        b.cleanup();
      }
    });
  });

  describe("show / list", () => {
    it("shows one relation and lists every relation", async () => {
      const b = backlog();
      try {
        await set(b);
        const shown = await run(b, "show", ["rollout-h7"]);
        expect(shown).toContain("owner: rollout-h7");
        expect(shown).toContain("child: rollout-phase2-k3");
        expect(decode(shown)).toBeTruthy();

        const listed = await run(b, "list");
        expect(listed).toContain("count: 1");
        expect(listed).toContain("rollout-h7");
        expect(decode(listed)).toBeTruthy();

        const json = JSON.parse(await run(b, "list", ["--json"]));
        expect(json.continuations).toEqual([
          {
            owner: "rollout-h7",
            child: "rollout-phase2-k3",
            child_state: "queued",
            fault: null,
          },
        ]);
        expect(json.faults).toEqual([]);
      } finally {
        b.cleanup();
      }
    });

    it("reports a row that owns nothing without inventing one", async () => {
      const b = backlog();
      try {
        const shown = await run(b, "show", ["rollout-h7", "--json"]);
        expect(JSON.parse(shown)).toEqual({
          owner: "rollout-h7",
          child: null,
          child_state: null,
          fault: null,
        });
        expect(await run(b, "list")).toContain("continuations: 0 relations");
      } finally {
        b.cleanup();
      }
    });

    it("surfaces a conflicting relation as a visible fault", async () => {
      const conflicting = HOME.replace(
        "- [ ] unrelated-q1 - unrelated work (repo: other) (since 2026-06-22)",
        "- [ ] unrelated-q1 - unrelated work (repo: other) (since 2026-06-22) (continuation: rollout-phase2-k3)",
      ).replace(
        "(repo: widget) (since 2026-06-22)\n- Free-form",
        "(repo: widget) (since 2026-06-22) (continuation: rollout-phase2-k3)\n- Free-form",
      );
      const b = backlog(conflicting);
      try {
        const json = JSON.parse(await run(b, "list", ["--json"]));
        expect(json.faults).toEqual([
          {
            code: "conflict",
            child: "rollout-phase2-k3",
            owners: ["rollout-h7", "unrelated-q1"],
            message:
              'Continuation child "rollout-phase2-k3" is claimed by more than one owner: rollout-h7, unrelated-q1',
          },
        ]);
        await expect(startCommand(["unrelated-q1"], b.ctx)).rejects.toThrow(
          /claimed by more than one owner/,
        );
      } finally {
        b.cleanup();
      }
    });
  });

  describe("preservation and byte-stability", () => {
    it("round-trips the tag through parse/render unchanged", async () => {
      const b = backlog();
      try {
        await set(b);
        const src = b.read();
        expect(src).toContain("(continuation: rollout-phase2-k3)");
        expect(renderBacklog(parseBacklog(src))).toBe(src);
        // Normalizing every row is idempotent: the tag is neither duplicated
        // nor relocated. (`render` drops trailing blank separators once, which
        // is pre-existing normalization, so compare the two normalized forms.)
        await renderCommand([], b.ctx);
        const normalized = b.read();
        expect(normalized).toContain("(continuation: rollout-phase2-k3)");
        expect(normalized.match(/\(continuation:/g)).toHaveLength(1);
        await renderCommand([], b.ctx);
        expect(b.read()).toBe(normalized);
      } finally {
        b.cleanup();
      }
    });

    it("survives transitions, holds, and updates of the owner", async () => {
      const b = backlog();
      try {
        await set(b);
        await holdCommand(
          ["rollout-h7", "--reason", "captain decision pending"],
          b.ctx,
        );
        await doneCommand(["rollout-h7", "--no-prune"], b.ctx);
        await reopenCommand(["rollout-h7"], b.ctx);
        await startCommand(["rollout-h7"], b.ctx);
        expect(b.read()).toContain("(continuation: rollout-phase2-k3)");
        const shown = await showCommand(["rollout-h7"], b.ctx);
        expect(shown).toContain("continuation: rollout-phase2-k3");
      } finally {
        b.cleanup();
      }
    });

    it("keeps the relation when the child completes, without completing the owner", async () => {
      const b = backlog();
      try {
        await set(b);
        await doneCommand(["rollout-phase2-k3", "--no-prune"], b.ctx);
        const owner = await b.store.get("rollout-h7");
        expect(owner?.state).toBe("in_flight");
        expect(owner?.continuation).toEqual({ child: "rollout-phase2-k3" });
        const json = JSON.parse(await run(b, "show", ["rollout-h7", "--json"]));
        expect(json.child_state).toBe("done");
        expect(json.fault).toBeNull();
      } finally {
        b.cleanup();
      }
    });

    it("exposes the relation through list --fields and never by default", async () => {
      const b = backlog();
      try {
        await set(b);
        const plain = await listCommand([], b.ctx);
        expect(plain).not.toContain("continuation");
        const withFields = await listCommand(
          [
            "--fields",
            "continuation,continuation_child_state,continuation_fault",
          ],
          b.ctx,
        );
        expect(withFields).toContain("rollout-phase2-k3");
        expect(decode(withFields)).toBeTruthy();
      } finally {
        b.cleanup();
      }
    });
  });

  describe("the relation is inert", () => {
    it("does not change ready, blocked, or held derivation", async () => {
      const b = backlog();
      try {
        const before = readyTasks((await b.store.list({})).items).map(
          (t) => t.id,
        );
        const readyBefore = await readyCommand([], b.ctx);
        await set(b);
        const after = readyTasks((await b.store.list({})).items).map(
          (t) => t.id,
        );
        expect(after).toEqual(before);
        expect(await readyCommand([], b.ctx)).toBe(readyBefore);

        const owner = await b.store.get("rollout-h7");
        const child = await b.store.get("rollout-phase2-k3");
        expect(owner?.deps).toEqual([]);
        expect(child?.deps).toEqual([]);
        expect(child?.hold).toBeUndefined();
        const shown = await showCommand(["rollout-phase2-k3"], b.ctx);
        expect(shown).toContain("blocked: no");
        expect(shown).toContain("held: no");
      } finally {
        b.cleanup();
      }
    });

    it("refuses to strand the child through rm, mv, or prune", async () => {
      const b = backlog();
      try {
        await set(b);
        await expect(rmCommand(["rollout-phase2-k3"], b.ctx)).rejects.toThrow(
          /is the continuation child of rollout-h7/,
        );

        const other = join(b.dir, "other-backlog.md");
        writeFileSync(
          other,
          "# Backlog\n\n## In flight\n\n## Queued\n\n## Done\n",
        );
        await expect(
          mvCommand(["rollout-phase2-k3", "--to", other], b.ctx),
        ).rejects.toThrow(
          /continuation child of rollout-h7, which stays behind/,
        );
        await expect(
          mvCommand(["rollout-h7", "--to", other], b.ctx),
        ).rejects.toThrow(
          /continuation child "rollout-phase2-k3" would be stranded/,
        );

        // The whole relation may travel together.
        await mvCommand(
          ["rollout-h7", "rollout-phase2-k3", "--to", other],
          b.ctx,
        );
        expect(b.read()).not.toContain("(continuation:");
      } finally {
        b.cleanup();
      }
    });

    it("never archives a claimed child out from under its owner", async () => {
      const b = backlog();
      try {
        await set(b, "rollout-h7", "rollout-phase2-k3");
        await doneCommand(["rollout-phase2-k3", "--no-prune"], b.ctx);
        const out = await pruneCommand(["--keep", "0"], b.ctx);
        expect(out).toContain("ok: prune done -> archived 1");
        expect(b.read()).toContain("rollout-phase2-k3");
        expect(b.archive()).not.toContain("rollout-phase2-k3");
        expect(b.archive()).toContain("older-d1");
      } finally {
        b.cleanup();
      }
    });
  });
});
