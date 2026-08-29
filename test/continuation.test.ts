import { describe, expect, it } from "vitest";
import {
  CONTINUATION_TAG,
  assertClaimableContinuationChild,
  assertNoContinuationFaults,
  continuationChildState,
  continuationFaultFor,
  continuationFaults,
  continuationChildIds,
  continuationOwnerOf,
  normalizeContinuation,
  resolveContinuationTags,
  sameContinuation,
} from "../src/continuation.js";
import type { State, Task } from "../src/model.js";

function task(
  id: string,
  state: State = "queued",
  child?: string,
  kind?: string,
): Task {
  return {
    id,
    title: id,
    state,
    links: [],
    deps: [],
    ...(child !== undefined ? { continuation: { child } } : {}),
    ...(kind !== undefined ? { kind } : {}),
  };
}

describe("continuation seam", () => {
  it("names the canonical managed tag", () => {
    expect(CONTINUATION_TAG).toBe("continuation");
  });

  describe("assertClaimableContinuationChild", () => {
    it("accepts a live, non-public-followup child", () => {
      expect(() =>
        assertClaimableContinuationChild("owner-h1", { child: "child-k3" }, [
          task("owner-h1"),
          task("child-k3", "in_flight"),
        ]),
      ).not.toThrow();
    });

    it("refuses a Done child on a new claim", () => {
      expect(() =>
        assertClaimableContinuationChild("owner-h1", { child: "child-k3" }, [
          task("owner-h1"),
          task("child-k3", "done"),
        ]),
      ).toThrow(/already Done/);
    });

    it("refuses a public-followup child", () => {
      expect(() =>
        assertClaimableContinuationChild("owner-h1", { child: "pf-ab" }, [
          task("owner-h1"),
          task("pf-ab", "queued", undefined, "public-followup"),
        ]),
      ).toThrow(/public-followup obligation/);
    });

    it("leaves an absent child to the home-shaped dangling fault", () => {
      expect(() =>
        assertClaimableContinuationChild("owner-h1", { child: "gone-k9" }, [
          task("owner-h1"),
        ]),
      ).not.toThrow();
    });
  });

  describe("normalizeContinuation", () => {
    it("accepts one differently identified child", () => {
      expect(
        normalizeContinuation("owner-h1", { child: " child-k3 " }, undefined),
      ).toEqual({ child: "child-k3" });
    });

    it("passes undefined through unchanged", () => {
      expect(
        normalizeContinuation("owner-h1", undefined, undefined),
      ).toBeUndefined();
    });

    it("refuses a missing child id", () => {
      expect(() =>
        normalizeContinuation("owner-h1", { child: "   " }, undefined),
      ).toThrow(/no child id/);
    });

    it("refuses a malformed child id", () => {
      expect(() =>
        normalizeContinuation("owner-h1", { child: "not an id" }, undefined),
      ).toThrow(/malformed continuation child/);
    });

    it("refuses a self-named child", () => {
      expect(() =>
        normalizeContinuation("owner-h1", { child: "owner-h1" }, undefined),
      ).toThrow(/cannot name itself/);
    });

    it("refuses a public-followup owner", () => {
      expect(() =>
        normalizeContinuation(
          "public-final-ab",
          { child: "child-k3" },
          "public-followup",
        ),
      ).toThrow(/public-followup obligation/);
    });
  });

  describe("resolveContinuationTags", () => {
    it("returns undefined when the row declares nothing", () => {
      expect(
        resolveContinuationTags("owner-h1", undefined, []),
      ).toBeUndefined();
    });

    it("refuses a duplicate relation on one row", () => {
      expect(() =>
        resolveContinuationTags("owner-h1", undefined, ["a-k1", "b-k2"]),
      ).toThrow(/declares 2 continuation relations/);
    });
  });

  describe("home invariants", () => {
    it("reports no fault for a resolvable, singly-owned child", () => {
      const tasks = [
        task("owner-h1", "in_flight", "child-k3"),
        task("child-k3"),
      ];
      expect(continuationFaults(tasks)).toEqual([]);
      expect(continuationOwnerOf("child-k3", tasks)).toBe("owner-h1");
      expect(continuationChildIds(tasks)).toEqual(new Set(["child-k3"]));
      expect(continuationChildState(tasks[0], tasks)).toBe("queued");
      expect(continuationFaultFor(tasks[0], tasks)).toBeUndefined();
      expect(() => assertNoContinuationFaults(tasks)).not.toThrow();
    });

    it("reports a dangling relation and refuses it on a write", () => {
      const tasks = [task("owner-h1", "in_flight", "ghost-k9")];
      expect(continuationFaults(tasks)).toEqual([
        {
          code: "dangling",
          child: "ghost-k9",
          owners: ["owner-h1"],
          message:
            'Continuation child "ghost-k9" named by "owner-h1" does not exist in this backlog',
        },
      ]);
      expect(continuationChildState(tasks[0], tasks)).toBe("missing");
      expect(continuationFaultFor(tasks[0], tasks)).toBe("dangling");
      expect(() => assertNoContinuationFaults(tasks)).toThrow(/does not exist/);
    });

    it("reports a conflicting child claimed by two owners", () => {
      const tasks = [
        task("owner-a", "in_flight", "child-k3"),
        task("owner-b", "in_flight", "child-k3"),
        task("child-k3"),
      ];
      const faults = continuationFaults(tasks);
      expect(faults).toHaveLength(1);
      expect(faults[0].code).toBe("conflict");
      expect(faults[0].owners).toEqual(["owner-a", "owner-b"]);
      // A conflicted child resolves to no single canonical owner.
      expect(continuationOwnerOf("child-k3", tasks)).toBeUndefined();
      expect(() => assertNoContinuationFaults(tasks)).toThrow(
        /claimed by more than one owner/,
      );
    });

    it("has no continuation state for a row that owns nothing", () => {
      const tasks = [task("plain-q1")];
      expect(continuationChildState(tasks[0], tasks)).toBeUndefined();
      expect(continuationFaultFor(tasks[0], tasks)).toBeUndefined();
    });

    it("compares relations by child id", () => {
      expect(sameContinuation({ child: "a-k1" }, { child: "a-k1" })).toBe(true);
      expect(sameContinuation({ child: "a-k1" }, { child: "b-k2" })).toBe(
        false,
      );
      expect(sameContinuation(undefined, undefined)).toBe(true);
      expect(sameContinuation({ child: "a-k1" }, undefined)).toBe(false);
    });
  });
});
