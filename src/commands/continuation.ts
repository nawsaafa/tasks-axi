import {
  requireNonEmptySingleLineFlagValue,
  requirePositionals,
  requireId,
  takeBoolFlag,
  takeFlag,
} from "../args.js";
import { renderMutation, taskToJson } from "../confirm.js";
import { requireCtx, type TasksContext } from "../context.js";
import {
  continuationChildState,
  continuationFaultFor,
  continuationFaults,
} from "../continuation.js";
import { AxiError, notFound } from "../errors.js";
import { formatCountLine } from "../format.js";
import { validateId } from "../id.js";
import type { Task } from "../model.js";
import { PUBLIC_FOLLOWUP_KIND } from "../public-followup.js";
import { getSuggestions } from "../suggestions.js";
import {
  field,
  renderDetail,
  renderHelp,
  renderList,
  renderOutput,
} from "../toon.js";

/**
 * The CLI surface for the typed continuation/hold ownership relation.
 *
 * `set` and `clear` are the only writers; `show` and `list` are the read
 * surfaces, and `list` is where a dangling or conflicting relation is visible
 * even while every write is refusing to leave one on disk. The commands record
 * ownership and nothing else - they never create the child row, never move
 * either row, and never change readiness, dispatch, completion, or authority.
 */

export const CONTINUATION_HELP = `usage: tasks-axi continuation <command> [args] [flags]
Record which backlog row canonically owns one live continuation child.
The relation is explicit only: it is never inferred from prose, notes, owner
reports, branch names, links, or public-followup data, and it is not a
dependency edge. It does not create the child, change ready/blocked/held,
claim current work, mark an endpoint or archive owner, complete the owner when
the child completes, or grant any authority.
commands:
  set <owner-id> --child <child-id>   claim ownership of one live child (idempotent)
  clear <owner-id>                    release the relation (idempotent)
  show <owner-id>                     the relation on one row
  list                                every relation in this backlog, with faults
flags:
  --json   machine-readable result
examples:
  tasks-axi continuation set widget-rollout-h7 --child widget-rollout-phase2-k3
  tasks-axi continuation show widget-rollout-h7
  tasks-axi continuation list --json
  tasks-axi continuation clear widget-rollout-h7`;

const SUBCOMMAND_HELP: Record<string, string> = {
  set: "usage: tasks-axi continuation set <owner-id> --child <child-id> [--json]",
  clear: "usage: tasks-axi continuation clear <owner-id> [--json]",
  show: "usage: tasks-axi continuation show <owner-id> [--json]",
  list: "usage: tasks-axi continuation list [--json]",
};

export function continuationSubcommandHelp(
  command: string | undefined,
): string | undefined {
  return command === undefined ? undefined : SUBCOMMAND_HELP[command];
}

export async function continuationCommand(
  rawArgs: string[],
  context?: TasksContext,
): Promise<string> {
  const [command, ...args] = rawArgs;
  switch (command) {
    case "set":
      return continuationSet(args, context);
    case "clear":
      return continuationClear(args, context);
    case "show":
      return continuationShow(args, context);
    case "list":
      return continuationList(args, context);
    default:
      throw new AxiError(
        command
          ? `Unknown continuation command: ${command}`
          : "Missing continuation command",
        "VALIDATION_ERROR",
        [CONTINUATION_HELP.split("\n")[0]],
      );
  }
}

const RELATION_SCHEMA = [
  field("owner"),
  field("child"),
  field("child_state"),
  field("fault"),
];

function relationRow(task: Task, all: Task[]): Record<string, unknown> {
  return {
    owner: task.id,
    child: task.continuation?.child ?? "-",
    child_state: continuationChildState(task, all) ?? "-",
    fault: continuationFaultFor(task, all) ?? "none",
  };
}

function relationJson(task: Task, all: Task[]): Record<string, unknown> {
  const child = task.continuation?.child ?? null;
  return {
    owner: task.id,
    child,
    child_state:
      child === null ? null : (continuationChildState(task, all) ?? null),
    fault: continuationFaultFor(task, all) ?? null,
  };
}

function requireChild(raw: string | undefined, ownerId: string): string {
  if (raw === undefined) {
    throw new AxiError("--child <id> is required", "VALIDATION_ERROR", [
      "Name the continuation child, e.g. `--child widget-rollout-phase2-k3`",
    ]);
  }
  const child = validateId(raw.trim(), [
    "Use an existing task slug like `widget-rollout-phase2-k3`",
  ]);
  if (child === ownerId) {
    throw new AxiError(
      `Task "${ownerId}" cannot name itself as its continuation child`,
      "VALIDATION_ERROR",
      ["A continuation child must be a differently identified row"],
    );
  }
  return child;
}

async function continuationSet(
  rawArgs: string[],
  context?: TasksContext,
): Promise<string> {
  const { store } = requireCtx(context);
  const args = [...rawArgs];
  const json = takeBoolFlag(args, "--json");
  // Take the flag before the positional check so `--child` is not read as an
  // unknown flag.
  const childRaw = requireNonEmptySingleLineFlagValue(
    "--child",
    takeFlag(args, "--child"),
  );
  const positionals = requirePositionals(args, 1, 1, SUBCOMMAND_HELP.set);
  const owner = requireId(positionals[0], "id");
  const child = requireChild(childRaw, owner);

  const current = await store.get(owner);
  if (!current) throw notFound(owner, { globals: context?.suggestionGlobals });
  if (current.kind === PUBLIC_FOLLOWUP_KIND) {
    throw new AxiError(
      `Task "${owner}" is a public-followup obligation and cannot own a continuation relation`,
      "VALIDATION_ERROR",
      [
        "Public obligations are completed by a posted receipt or Captain waiver, never by a continuation",
      ],
    );
  }

  const all = (await store.list({})).items;
  // The child row is never created here: an unknown id is a fail-visible error.
  const childTask = all.find((task) => task.id === child);
  if (!childTask) {
    throw new AxiError(
      `Continuation child "${child}" not found in this backlog`,
      "VALIDATION_ERROR",
      [`Create the child row first, e.g. \`tasks-axi add ${child} "<title>"\``],
    );
  }
  if (childTask.kind === PUBLIC_FOLLOWUP_KIND) {
    throw new AxiError(
      `Continuation child "${child}" is a public-followup obligation`,
      "VALIDATION_ERROR",
      ["A public obligation is never a continuation child"],
    );
  }
  // "live" is a claim-time precondition. An already-owned relation whose child
  // later completes stays valid and inert - a done child is not owner success.
  if (childTask.state === "done") {
    throw new AxiError(
      `Continuation child "${child}" is already Done`,
      "VALIDATION_ERROR",
      [
        `Name a live child row, or reopen it with \`tasks-axi reopen ${child}\``,
      ],
    );
  }
  const otherOwner = all.find(
    (task) => task.id !== owner && task.continuation?.child === child,
  );
  if (otherOwner) {
    throw new AxiError(
      `Continuation child "${child}" is already owned by "${otherOwner.id}"`,
      "VALIDATION_ERROR",
      [
        `A live child resolves to at most one owner per backlog; clear it with \`tasks-axi continuation clear ${otherOwner.id}\` first`,
      ],
    );
  }

  const already = current.continuation?.child === child;
  const task = already
    ? current
    : (await store.update(owner, { continuation: { child } })).task;
  const after = (await store.list({})).items;
  return renderMutation({
    json,
    confirm: already
      ? `continuation ${owner} already owns ${child}`
      : `continuation ${owner} -> owns ${child}`,
    already,
    jsonPayload: {
      ok: true,
      action: "continuation set",
      ...(already ? { already: true } : {}),
      continuation: relationJson(task, after),
      task: taskToJson(task, after),
    },
    detail: renderDetail(
      "continuation",
      relationRow(task, after),
      RELATION_SCHEMA,
    ),
    suggestions: getSuggestions({
      action: "continuation-set",
      id: owner,
      globals: context?.suggestionGlobals,
    }),
  });
}

async function continuationClear(
  rawArgs: string[],
  context?: TasksContext,
): Promise<string> {
  const { store } = requireCtx(context);
  const args = [...rawArgs];
  const json = takeBoolFlag(args, "--json");
  const positionals = requirePositionals(args, 1, 1, SUBCOMMAND_HELP.clear);
  const owner = requireId(positionals[0], "id");

  const current = await store.get(owner);
  if (!current) throw notFound(owner, { globals: context?.suggestionGlobals });

  const previous = current.continuation?.child;
  const already = previous === undefined;
  const task = already
    ? current
    : (await store.update(owner, { continuation: null })).task;
  const after = (await store.list({})).items;
  return renderMutation({
    json,
    confirm: already
      ? `continuation ${owner} already owns nothing`
      : `continuation ${owner} -> cleared ${previous}`,
    already,
    jsonPayload: {
      ok: true,
      action: "continuation clear",
      ...(already ? { already: true } : {}),
      ...(previous !== undefined ? { cleared: previous } : {}),
      continuation: relationJson(task, after),
      task: taskToJson(task, after),
    },
    suggestions: getSuggestions({
      action: "continuation-clear",
      id: owner,
      globals: context?.suggestionGlobals,
    }),
  });
}

async function continuationShow(
  rawArgs: string[],
  context?: TasksContext,
): Promise<string> {
  const { store } = requireCtx(context);
  const args = [...rawArgs];
  const json = takeBoolFlag(args, "--json");
  const positionals = requirePositionals(args, 1, 1, SUBCOMMAND_HELP.show);
  const owner = requireId(positionals[0], "id");

  const all = (await store.list({})).items;
  const task = all.find((item) => item.id === owner);
  if (!task) throw notFound(owner, { globals: context?.suggestionGlobals });

  if (json) return JSON.stringify(relationJson(task, all), null, 2);
  return renderOutput([
    renderDetail("continuation", relationRow(task, all), RELATION_SCHEMA),
    renderHelp(
      getSuggestions({
        action: "continuation-show",
        id: owner,
        globals: context?.suggestionGlobals,
      }),
    ),
  ]);
}

async function continuationList(
  rawArgs: string[],
  context?: TasksContext,
): Promise<string> {
  const { store } = requireCtx(context);
  const args = [...rawArgs];
  const json = takeBoolFlag(args, "--json");
  requirePositionals(args, 0, 0, SUBCOMMAND_HELP.list);

  const all = (await store.list({})).items;
  const owners = all.filter((task) => task.continuation !== undefined);
  const faults = continuationFaults(all);

  if (json) {
    return JSON.stringify(
      {
        continuations: owners.map((task) => relationJson(task, all)),
        faults: faults.map((fault) => ({
          code: fault.code,
          child: fault.child,
          owners: fault.owners,
          message: fault.message,
        })),
      },
      null,
      2,
    );
  }

  const blocks = [formatCountLine({ count: owners.length })];
  if (owners.length === 0) {
    blocks.push("continuations: 0 relations");
  } else {
    blocks.push(
      renderList(
        "continuations",
        owners.map((task) => relationRow(task, all)),
        RELATION_SCHEMA,
      ),
    );
  }
  if (faults.length > 0) {
    blocks.push(
      renderList(
        "faults",
        faults.map((fault) => ({
          code: fault.code,
          child: fault.child,
          owners: fault.owners.join(","),
        })),
        [field("code"), field("child"), field("owners")],
      ),
    );
  }
  blocks.push(
    renderHelp(
      getSuggestions({
        action: "continuation-list",
        isEmpty: owners.length === 0,
        globals: context?.suggestionGlobals,
      }),
    ),
  );
  return renderOutput(blocks);
}
