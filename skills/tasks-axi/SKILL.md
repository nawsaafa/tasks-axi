---
name: tasks-axi
description: "Manage a task backlog through the tasks-axi CLI - add, list, show, start, and complete tasks; track blocked-by dependencies, structured holds, and a ready queue; prune and normalize a hand-editable backlog.md. Use whenever a task touches backlog or task state: filing or dispatching work, recording a PR or report on completion, finding dispatchable or held work, or trimming the Done list."
user-invocable: false
author: nawsaafa
metadata:
  hermes:
    tags: [tasks, backlog, planning, dependencies]
    category: productivity
---

# tasks-axi

Agent ergonomic task & backlog manager for the current workspace. Prefer this over hand-editing backlog.md for task state, dependency, or hold changes.

Canonical fork: https://github.com/nawsaafa/tasks-axi
This fork is not published to npm. Invoke the CLI from the Git source and tag below; never from the public npm registry.

## When to use

Use tasks-axi whenever a task touches the backlog: filing or dispatching work, moving a task through queued -> in flight -> done, recording a PR url or report path on completion, tracking blocked-by dependencies, pausing dispatch with structured holds, finding dispatchable ready work or intentionally held work, or trimming the Done list.

Get every command, flag, and workflow from the live CLI - it is the single source of truth:

- `npx -y github:nawsaafa/tasks-axi#tasks-axi-v0.3.1` - dashboard of the current backlog
- `npx -y github:nawsaafa/tasks-axi#tasks-axi-v0.3.1 --help` - global usage
- `npx -y github:nawsaafa/tasks-axi#tasks-axi-v0.3.1 <command> --help` - per-command usage

If the CLI prints a follow-up starting with `tasks-axi`, rerun it with the same Git source/tag prefix instead of an unscoped registry package name.
