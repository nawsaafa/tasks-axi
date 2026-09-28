import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CANONICAL_GIT_SPEC } from "../src/skill.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(root, ".github", "workflows");

const PUBLISH_RUN =
  /\b(?:npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/;
const PUBLISH_ACTION =
  /(?:^|\/)(?:npm-publish|JS-DevTools\/npm-publish)(?:@|$)/i;
const REGISTRY_AUTH_ENV =
  /^(?:node_auth_token|npm_token|npm_config_registry|npm_config__auth|npm_config__authtoken|npm_config_.*_authtoken)$/i;

interface Collected {
  run: string[];
  uses: string[];
  with: Record<string, unknown>[];
  env: Record<string, unknown>[];
  permissions: unknown[];
}

function emptyCollected(): Collected {
  return { run: [], uses: [], with: [], env: [], permissions: [] };
}

function collectWorkflowNodes(node: unknown, out: Collected): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectWorkflowNodes(item, out);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.run === "string") out.run.push(record.run);
  if (typeof record.uses === "string") out.uses.push(record.uses);
  if (
    record.with != null &&
    typeof record.with === "object" &&
    !Array.isArray(record.with)
  ) {
    out.with.push(record.with as Record<string, unknown>);
  }
  if (
    record.env != null &&
    typeof record.env === "object" &&
    !Array.isArray(record.env)
  ) {
    out.env.push(record.env as Record<string, unknown>);
  }
  if ("permissions" in record) out.permissions.push(record.permissions);
  for (const value of Object.values(record)) collectWorkflowNodes(value, out);
}

function collectWorkflow(name: string): Collected {
  const found = emptyCollected();
  collectWorkflowNodes(parse(readFileSync(join(workflowsDir, name), "utf8")), found);
  return found;
}

// Every shape that would let a workflow authenticate against a package
// registry, read off the parsed document rather than the file text.
function publishCapabilityFailures(name: string, found: Collected): string[] {
  const failures: string[] = [];

  for (const run of found.run) {
    if (PUBLISH_RUN.test(run)) failures.push(`${name} run: ${run.trim()}`);
  }
  for (const uses of found.uses) {
    if (PUBLISH_ACTION.test(uses)) failures.push(`${name} uses: ${uses}`);
  }
  for (const permissions of found.permissions) {
    if (typeof permissions === "string") {
      if (permissions === "write-all") {
        failures.push(`${name} permissions: ${permissions}`);
      }
      continue;
    }
    if (permissions == null || typeof permissions !== "object") continue;
    const idToken = (permissions as Record<string, unknown>)["id-token"];
    if (idToken !== undefined && idToken !== "none") {
      failures.push(`${name} permissions.id-token: ${String(idToken)}`);
    }
  }
  for (const inputs of found.with) {
    for (const [key, value] of Object.entries(inputs)) {
      if (key.toLowerCase() === "registry-url") {
        failures.push(`${name} with.${key}: ${String(value)}`);
      }
    }
  }
  for (const env of found.env) {
    for (const key of Object.keys(env)) {
      if (REGISTRY_AUTH_ENV.test(key)) failures.push(`${name} env.${key}`);
    }
  }

  return failures;
}

// Windows npm is a `.cmd` shim, which Node refuses to spawn without a shell
// (CVE-2024-27980 hardening). Without this the child never starts, npm never
// gets to refuse the publish, and the assertions below pass vacuously.
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const UNREACHABLE_REGISTRY = "http://127.0.0.1:1/";
const publishSandboxes: string[] = [];

// npm resolves config from the command line first, then the environment, then
// npmrc files. The `--registry` flag below therefore cannot be redirected, and
// stripping every `npm_config_*`/token variable keeps an ambient credential
// from reaching whatever the child does contact.
const PUBLISH_CHILD_ENV: Record<string, string> = (() => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^npm_config_/i.test(key)) continue;
    if (/^(?:npm_token|node_auth_token|npm_auth_token)$/i.test(key)) continue;
    env[key] = value;
  }
  env.npm_config_registry = UNREACHABLE_REGISTRY;
  return env;
})();

afterEach(() => {
  for (const dir of publishSandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function attemptPublish(manifest: Record<string, unknown>): {
  status: number | null;
  output: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "tasks-axi-publish-"));
  publishSandboxes.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, ".npmrc"),
    `registry=${UNREACHABLE_REGISTRY}\n//127.0.0.1:1/:_authToken=test-token\n`,
  );

  const result = spawnSync(
    npm,
    [
      "publish",
      `--registry=${UNREACHABLE_REGISTRY}`,
      "--userconfig",
      ".npmrc",
      "--fetch-retries=0",
      "--fetch-timeout=2000",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows,
      env: PUBLISH_CHILD_ENV,
    },
  );

  if (result.error) throw result.error;
  if (result.stdout == null && result.stderr == null) {
    // npm never ran, so its output cannot be evidence of anything.
    throw new Error("npm publish produced no output; the child never started");
  }

  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
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

  it("pins every documented install to one exact immutable canonical tag", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version: string };
    const config = JSON.parse(
      readFileSync(join(root, "release-please-config.json"), "utf8"),
    ) as {
      "include-component-in-tag"?: boolean;
      packages: Record<
        string,
        {
          "package-name"?: string;
          component?: string;
          "include-component-in-tag"?: boolean;
        }
      >;
    };

    const entry = config.packages["."];
    expect(entry).toBeDefined();
    const includeComponent =
      entry["include-component-in-tag"] ??
      config["include-component-in-tag"] ??
      true;
    const component = entry.component ?? entry["package-name"];
    expect(component).toBeDefined();
    const tag = includeComponent
      ? `${component}-v${pkg.version}`
      : `v${pkg.version}`;

    expect(CANONICAL_GIT_SPEC).toBe(`github:nawsaafa/tasks-axi#${tag}`);

    const readme = readFileSync(join(root, "README.md"), "utf8");
    const refs = readme.match(/github:nawsaafa\/tasks-axi#\S+/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    expect([...new Set(refs.map((ref) => ref.replace(/[`).,]+$/, "")))]).toEqual([
      CANONICAL_GIT_SPEC,
    ]);
  });

  it("builds the CLI on a Git-source install because dist is untracked", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string>; bin: Record<string, string> };
    const tsconfig = JSON.parse(
      readFileSync(join(root, "tsconfig.json"), "utf8"),
    ) as { compilerOptions: { outDir: string } };
    const ignored = readFileSync(join(root, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""));

    const outDir = tsconfig.compilerOptions.outDir;
    expect(ignored).toContain(outDir);
    expect(pkg.bin["tasks-axi"].startsWith(`${outDir}/`)).toBe(true);

    const resolve = (script: string, seen = new Set<string>()): string[] => {
      if (seen.has(script)) return [];
      seen.add(script);
      const command = pkg.scripts[script];
      if (command === undefined) return [];
      const nested = [...command.matchAll(/(?:npm|pnpm|yarn)\s+run\s+(\S+)/g)];
      if (nested.length === 0) return [command];
      return nested.flatMap(([, name]) => resolve(name, seen));
    };

    expect(resolve("prepare")).toContain(pkg.scripts.build);
    expect(pkg.scripts.build).toMatch(/\btsc\b/);
  });

  it("refuses a credentialed local npm publication", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as Record<string, unknown> & { scripts?: unknown };

    expect(pkg.private).toBe(true);
    expect(pkg.publishConfig).toBeUndefined();
    expect(pkg.name).toBe("tasks-axi");

    const manifest = { ...pkg };
    delete manifest.scripts;

    const refused = attemptPublish(manifest);
    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain("EPRIVATE");
    expect(refused.output).toMatch(/marked as private/i);

    const publishable = { ...manifest };
    delete publishable.private;
    const attempted = attemptPublish(publishable);
    expect(attempted.output).not.toContain("EPRIVATE");
    // Without `private` npm gets past its own refusal and tries the registry,
    // which is pinned to a dead loopback port, so nothing can be uploaded.
    expect(attempted.status).not.toBe(0);
    expect(attempted.output).toContain(UNREACHABLE_REGISTRY);
    expect(attempted.output).not.toContain("registry.npmjs.org");
  }, 120_000);

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
    expect(readme).toContain(CANONICAL_GIT_SPEC);
    expect(readme).toMatch(/no-npm publication/i);
    expect(readme).not.toContain("kunchenguid/tasks-axi");
    expect(readme).not.toContain("npmjs.com/package/tasks-axi");
    expect(readme).not.toMatch(/npx(?:\s+-y)?\s+tasks-axi(?:\s|$|`)/);
    expect(readme).not.toMatch(/npm install(?:\s+-g)?\s+tasks-axi(?:\s|$)/);
  });
});

describe("no-npm release enforcement", () => {
  it("has no publish-capable command, action, permission, or credential in GitHub workflows", () => {
    const files = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    expect(files).toContain("release-please.yml");

    const failures = files.flatMap((name) =>
      publishCapabilityFailures(name, collectWorkflow(name)),
    );

    expect(failures).toEqual([]);
  });

  it("keeps release_created paths incapable of npm publication", () => {
    const found = collectWorkflow("release-please.yml");

    expect(
      found.uses.some((uses) =>
        uses.includes("googleapis/release-please-action"),
      ),
    ).toBe(true);
    expect(publishCapabilityFailures("release-please.yml", found)).toEqual([]);
  });
});
