import { AxiError } from "./errors.js";
import { ID_RE } from "./id-pattern.js";
import type { Continuation, Task } from "./model.js";
import { PUBLIC_FOLLOWUP_KIND } from "./public-followup.js";

/**
 * The one canonical continuation/hold ownership seam.
 *
 * A continuation relation records exactly one fact: a canonical backlog row
 * (the *owner*) explicitly holds ownership of one differently identified
 * continuation *child* row in the same backlog (the *home*). It is a typed,
 * explicitly written relation - never inferred from prose, status notes, owner
 * reports, branch names, substring matches, links, or public-followup data -
 * and it is deliberately NOT a dependency edge: `blocked-by` / `parent` /
 * `discovered-from` keep their existing meaning and are never repurposed here.
 *
 * What the relation does NOT mean (all deliberate non-effects, each covered by
 * a negative control test):
 *  - it never creates the child row (no implicit row creation);
 *  - it never changes `ready` / `blocked` / `held` derivation;
 *  - it is not a claim about current work, an endpoint, or an archive owner;
 *  - a completed child is not terminal success for the owner;
 *  - it grants no authority of any kind.
 *
 * Faults are fail-visible, never silently tolerated. Row-shaped faults
 * (malformed, missing, duplicate, self-named, public-followup owner) are
 * refused when the row is parsed, so a malformed relation can never be read as
 * a valid one. Home-shaped faults (dangling, conflicting) are reported by the
 * read surfaces and refused on the *post-state* of every write, so a faulted
 * backlog can still be inspected and repaired with a single `continuation
 * clear`, while no write may leave a fault behind.
 */

/** The canonical trailing tag name: `(continuation: <child-id>)`. */
export const CONTINUATION_TAG = "continuation";

export const CONTINUATION_FAULT_CODES = ["dangling", "conflict"] as const;
export type ContinuationFaultCode = (typeof CONTINUATION_FAULT_CODES)[number];

export interface ContinuationFault {
  code: ContinuationFaultCode;
  /** The child id the fault is about. */
  child: string;
  /** Every owner row naming that child, in document order. */
  owners: string[];
  message: string;
}

const CHILD_SHAPE_HINT =
  "Continuation children are slug-shaped task ids, e.g. `(continuation: follow-up-k3)`";

function relationError(message: string, suggestions: string[]): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

/**
 * Validate one written relation for a single row. Returns the canonical value,
 * or undefined when the row declares no relation.
 */
export function normalizeContinuation(
  ownerId: string,
  value: Continuation | undefined,
  ownerKind: string | undefined,
): Continuation | undefined {
  if (value === undefined) return undefined;
  const raw = typeof value.child === "string" ? value.child.trim() : "";
  if (raw === "") {
    throw relationError(
      `Task "${ownerId}" declares a continuation relation with no child id`,
      [CHILD_SHAPE_HINT],
    );
  }
  if (!ID_RE.test(raw)) {
    throw relationError(
      `Task "${ownerId}" has a malformed continuation child "${raw}"`,
      [CHILD_SHAPE_HINT],
    );
  }
  if (raw === ownerId) {
    throw relationError(
      `Task "${ownerId}" cannot name itself as its continuation child`,
      ["A continuation child must be a differently identified row"],
    );
  }
  if (ownerKind === PUBLIC_FOLLOWUP_KIND) {
    throw relationError(
      `Task "${ownerId}" is a public-followup obligation and cannot own a continuation relation`,
      [
        "Public obligations are completed by a posted receipt or Captain waiver, never by a continuation",
      ],
    );
  }
  return { child: raw };
}

/**
 * Resolve the raw `(continuation: …)` tag values pulled off one bullet. More
 * than one tag on a row is a duplicate relation and is refused: a row owns at
 * most one continuation child.
 */
export function resolveContinuationTags(
  ownerId: string,
  ownerKind: string | undefined,
  values: string[],
): Continuation | undefined {
  if (values.length === 0) return undefined;
  if (values.length > 1) {
    throw relationError(
      `Task "${ownerId}" declares ${values.length} continuation relations; a row owns at most one`,
      ["Keep a single `(continuation: <child-id>)` tag on the row"],
    );
  }
  return normalizeContinuation(ownerId, { child: values[0] }, ownerKind);
}

/**
 * The claim-time preconditions on the *child* side of a newly written
 * relation: the child must be live, and a public-followup obligation is never a
 * continuation child (the relation is refused on both ends). Enforced at the
 * `Store` write boundary so every backend inherits them, and only when the
 * relation is newly set or changed - an existing relation stays valid when its
 * child later goes Done, which is deliberately inert and never owner success.
 *
 * A child row that is absent here is a home-shaped `dangling` fault, owned by
 * `assertNoContinuationFaults` on the write's post-state, not by this check.
 */
export function assertClaimableContinuationChild(
  ownerId: string,
  continuation: Continuation,
  tasks: Task[],
): void {
  const child = tasks.find((task) => task.id === continuation.child);
  if (child === undefined) return;
  if (child.kind === PUBLIC_FOLLOWUP_KIND) {
    throw relationError(
      `Continuation child "${child.id}" is a public-followup obligation`,
      ["A public obligation is never a continuation child"],
    );
  }
  if (child.state === "done") {
    throw relationError(`Continuation child "${child.id}" is already Done`, [
      `Name a live child row for "${ownerId}", or reopen it with \`tasks-axi reopen ${child.id}\``,
    ]);
  }
}

export function sameContinuation(
  left: Continuation | undefined,
  right: Continuation | undefined,
): boolean {
  return left?.child === right?.child;
}

/** Every owner row naming each claimed child, keyed by child id. */
export function continuationOwners(tasks: Task[]): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const task of tasks) {
    const child = task.continuation?.child;
    if (child === undefined) continue;
    const list = owners.get(child);
    if (list) list.push(task.id);
    else owners.set(child, [task.id]);
  }
  return owners;
}

/** The ids that are claimed as a continuation child by some owner. */
export function continuationChildIds(tasks: Task[]): Set<string> {
  return new Set(continuationOwners(tasks).keys());
}

/** The single owner of a child, or undefined when unclaimed or conflicted. */
export function continuationOwnerOf(
  childId: string,
  tasks: Task[],
): string | undefined {
  const owners = continuationOwners(tasks).get(childId);
  return owners !== undefined && owners.length === 1 ? owners[0] : undefined;
}

/**
 * The home-shaped faults in a backlog: a relation whose child row is absent
 * (dangling) and a child claimed by more than one owner (conflict). Both are
 * reported, never silently resolved.
 */
export function continuationFaults(tasks: Task[]): ContinuationFault[] {
  const present = new Set(tasks.map((task) => task.id));
  const faults: ContinuationFault[] = [];
  for (const [child, owners] of continuationOwners(tasks)) {
    if (!present.has(child)) {
      faults.push({
        code: "dangling",
        child,
        owners,
        message: `Continuation child "${child}" named by ${quoteList(owners)} does not exist in this backlog`,
      });
    }
    if (owners.length > 1) {
      faults.push({
        code: "conflict",
        child,
        owners,
        message: `Continuation child "${child}" is claimed by more than one owner: ${owners.join(", ")}`,
      });
    }
  }
  return faults;
}

/** The fault code affecting one row's own relation, if any. */
export function continuationFaultFor(
  task: Task,
  tasks: Task[],
): ContinuationFaultCode | undefined {
  const child = task.continuation?.child;
  if (child === undefined) return undefined;
  const fault = continuationFaults(tasks).find((f) => f.child === child);
  return fault?.code;
}

/**
 * The current state of a row's continuation child: its explicit state, or
 * `missing` when the relation dangles. A child that has gone Done is reported
 * as done and nothing more - it never completes, unblocks, or otherwise
 * changes the owner.
 */
export function continuationChildState(
  task: Task,
  tasks: Task[],
): string | undefined {
  const child = task.continuation?.child;
  if (child === undefined) return undefined;
  return tasks.find((t) => t.id === child)?.state ?? "missing";
}

/**
 * Refuse a backlog that still carries a home-shaped fault. Called on the
 * post-state of every write, so a repair (`continuation clear`) always works
 * while no write may leave a dangling or conflicting relation on disk.
 */
export function assertNoContinuationFaults(tasks: Task[]): void {
  const faults = continuationFaults(tasks);
  if (faults.length === 0) return;
  const first = faults[0];
  const suggestions = [
    `Clear it with \`tasks-axi continuation clear ${first.owners[0]}\`, or restore the named child row`,
  ];
  if (faults.length > 1) {
    suggestions.push(
      "Run `tasks-axi continuation list` to see every faulted relation",
    );
  }
  throw relationError(first.message, suggestions);
}

function quoteList(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}
