import { stringify } from "yaml";
import type { StepMark, StepMarkKind } from "../../ports/flow-runner.js";
import type { ScreenElement } from "../../types/index.js";

/** Commands Maestro adds on its own. They are not steps of the flow. */
const INTERNAL_COMMANDS = new Set([
  "defineVariablesCommand",
  "applyConfigurationCommand",
]);

export interface MaestroFailure {
  message?: string;
  debugMessage?: string;
  /** Paths relative to the flow's debug folder. */
  screenshot?: string;
  hierarchy?: string;
}

export interface ReadCommands {
  steps: StepMark[];
  failedStep?: number[];
  failure?: MaestroFailure;
}

interface Entry {
  kind: string;
  status: string;
  depth: number;
  failure?: MaestroFailure;
}

interface Node {
  entry: Entry;
  children: Node[];
}

/**
 * Reads Maestro's `commands.json` into step marks (D-49). Entries come in the order they ran, each
 * with its nesting depth. With a wrapper (D-47), the wrapper's own `runFlow` is dropped and the
 * flow's steps move up one level.
 */
export function readCommands(
  json: unknown,
  wrapped: boolean,
): ReadCommands | undefined {
  if (!Array.isArray(json)) return undefined;
  let entries = json.flatMap((item) => {
    const entry = toEntry(item);
    return entry && !INTERNAL_COMMANDS.has(entry.kind) ? [entry] : [];
  });
  if (wrapped) {
    const [first, ...rest] = entries;
    if (first?.kind !== "runFlowCommand" || first.depth !== 0) return undefined;
    entries = rest.map((e) => ({ ...e, depth: e.depth - 1 }));
  }

  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const entry of entries) {
    const node: Node = { entry, children: [] };
    while (stack.length > Math.max(entry.depth, 0)) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
    stack.push(node);
  }

  const steps = roots.map(toMark);
  const path: number[] = [];
  let level: Node[] = roots;
  let marks: StepMark[] | undefined = steps;
  let failure: MaestroFailure | undefined;
  while (marks) {
    const index = marks.findIndex((m) => m.mark === "failed");
    if (index < 0) break;
    path.push(index);
    const node: Node | undefined = level[index];
    failure = node?.entry.failure ?? failure;
    level = node?.children ?? [];
    marks = marks[index]?.steps;
  }
  return { steps, failedStep: path.length > 0 ? path : undefined, failure };
}

function toMark(node: Node): StepMark {
  const steps = node.children.map(toMark);
  const childFailed = steps.some((s) => s.mark === "failed");
  return steps.length > 0
    ? { mark: markOf(node.entry.status, childFailed), steps }
    : { mark: markOf(node.entry.status, childFailed) };
}

function markOf(status: string, childFailed: boolean): StepMarkKind {
  if (status === "COMPLETED" || status === "WARNED")
    return childFailed ? "failed" : "passed";
  if (status === "FAILED" || childFailed) return "failed";
  return "not-run";
}

function toEntry(item: unknown): Entry | undefined {
  if (!isRecord(item) || !isRecord(item.command) || !isRecord(item.metadata))
    return undefined;
  const kind = Object.keys(item.command)[0];
  const { status, depth, error, artifacts } = item.metadata;
  if (kind === undefined || typeof status !== "string") return undefined;
  const entry: Entry = {
    kind,
    status,
    depth: typeof depth === "number" ? depth : 0,
  };
  if (status === "FAILED") {
    const failure: MaestroFailure = {};
    if (isRecord(error)) {
      if (typeof error.message === "string") failure.message = error.message;
      if (typeof error.debugMessage === "string")
        failure.debugMessage = error.debugMessage;
    }
    for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
      if (!isRecord(artifact) || typeof artifact.path !== "string") continue;
      if (artifact.type === "SCREENSHOT") failure.screenshot = artifact.path;
      if (artifact.type === "SCREEN_HIERARCHY")
        failure.hierarchy = artifact.path;
    }
    entry.failure = failure;
  }
  return entry;
}

/**
 * The step Maestro has just started, from a line of its log file, which it writes as it goes.
 * `--format` stops Maestro printing steps on stdout, and this line is the next best source
 * (D-49). It is Maestro's internal log format, so a mismatch only means no step is shown.
 */
export function stepStarted(line: string): string | undefined {
  const match = /CliConsoleListener\.onCommandStart: (.+) RUNNING\s*$/.exec(
    line,
  );
  const label = match?.[1];
  if (
    label === undefined ||
    label === "Define variables" ||
    label === "Apply configuration"
  ) {
    return undefined;
  }
  return label;
}

export interface AppProblem {
  kind: "crash" | "anr";
  /** The lines of the crash or ANR report from logcat. */
  report: string;
}

/**
 * Maestro reports an app crash as an ordinary failed step, so Jagra reads the logcat Maestro saved
 * (D-51). A crash is a `FATAL EXCEPTION` block for the app's process, an ANR an `ANR in <app>`.
 */
export function findAppProblem(
  logcat: string,
  appId: string,
): AppProblem | undefined {
  const lines = logcat.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (
      line.includes("FATAL EXCEPTION") &&
      (lines[i + 1] ?? "").includes(`Process: ${appId},`)
    ) {
      return { kind: "crash", report: block(lines, i, "AndroidRuntime") };
    }
    if (new RegExp(`ANR in ${escapeRegExp(appId)}(\\s|$|:|\\()`).test(line)) {
      return { kind: "anr", report: block(lines, i, "ActivityManager") };
    }
  }
  return undefined;
}

/** Lines from `start` on that come from the same logcat tag. */
function block(lines: string[], start: number, tag: string): string {
  const out: string[] = [];
  for (let i = start; i < lines.length && out.length < 200; i++) {
    const line = lines[i] ?? "";
    if (i > start && !line.includes(tag)) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Elements with text, an id or a description from Maestro's screen hierarchy file. */
export function readHierarchy(json: unknown): ScreenElement[] {
  const elements: ScreenElement[] = [];
  const visit = (node: unknown) => {
    if (!isRecord(node)) return;
    const attributes = isRecord(node.attributes) ? node.attributes : {};
    const text = nonEmpty(attributes.text) ?? nonEmpty(attributes.hintText);
    const id = nonEmpty(attributes["resource-id"]);
    const description = nonEmpty(attributes.accessibilityText);
    // The status bar, its notifications and other system UI are not the app's screen.
    if (id?.startsWith("com.android.systemui:")) return;
    // Android's own layout containers carry an id and nothing a person would read.
    const useful = text || description || (id && !id.startsWith("android:id/"));
    if (useful) {
      const element: ScreenElement = {};
      if (text) element.text = text;
      if (id) element.id = id;
      if (description) element.description = description;
      elements.push(element);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(json);
  return elements;
}

/** The environment variable that carries the value of `${name}` to Maestro (D-47). */
export function secretVariable(name: string): string {
  return `MAESTRO_JAGRA_SECRET_${name}`;
}

/**
 * A flow that maps each variable to the environment variable carrying it, then runs the real
 * flow. Values never appear in it, only names (D-47).
 */
export function wrapperFlow(
  appId: string,
  name: string,
  flowFile: string,
  variables: readonly string[],
): string {
  const env = Object.fromEntries(
    variables.map((v) => [v, `\${${secretVariable(v)}}`]),
  );
  return `${stringify({ appId, name, env })}---\n${stringify([
    { runFlow: flowFile.replaceAll("\\", "/") },
  ])}`;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
