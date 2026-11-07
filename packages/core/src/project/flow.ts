import { dirname, resolve } from "node:path";
import {
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  type Node,
  type YAMLMap,
} from "yaml";
import type { FlowProblem } from "../errors/index.js";
import type { Step, StepKind } from "../types/index.js";

/** Maestro commands that check something. Every other command is an action (AGT-22). */
const CHECK_COMMANDS = new Set([
  "assertVisible",
  "assertNotVisible",
  "assertTrue",
  "assertScreenshot",
  "assertDarkMode",
  "assertLightMode",
]);

/** Commands that hand a result to an AI model. Pass or fail must come from Maestro's own checks (D-33). */
export const AI_COMMANDS = new Set([
  "assertWithAI",
  "assertNoDefectsWithAI",
  "extractTextWithAI",
]);

/** Commands whose value can hold nested commands under `commands:`. */
const NESTING_COMMANDS = new Set(["runFlow", "repeat", "retry"]);

/** A `runFlow` or `retry` that runs another file. */
export interface HelperCall {
  /** Absolute path, resolved from the calling flow's folder. */
  file: string;
  /** Variables the call passes in its `env:`, so the helper does not need them from outside. */
  passes: string[];
  line: number;
}

export interface Flow {
  file: string;
  /** The header's `name`, or the file name without its extension (FLOW-2). */
  name: string;
  isHelper: boolean;
  appId?: string;
  properties: Record<string, string>;
  steps: Step[];
  calls: HelperCall[];
  /** `${NAME}` variables this file uses and does not define itself (RUN-10). */
  variables: string[];
  problems: FlowProblem[];
}

const VARIABLE = /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

export function emptyFlow(
  file: string,
  isHelper: boolean,
  problems: FlowProblem[] = [],
): Flow {
  return {
    file,
    name: fileStem(file),
    isHelper,
    properties: {},
    steps: [],
    calls: [],
    variables: [],
    problems,
  };
}

/** Parses one Maestro flow file and checks the shape FLOW-6 asks for. Never throws. */
export function parseFlow(text: string, file: string, isHelper: boolean): Flow {
  const flow = emptyFlow(file, isHelper);
  const problem = (p: FlowProblem) => {
    flow.problems.push(p);
    return flow;
  };

  const lines = new LineCounter();
  const docs = parseAllDocuments(text, {
    lineCounter: lines,
    uniqueKeys: true,
  });
  if (!Array.isArray(docs) || docs.length === 0)
    return problem({ code: "FLOW_HEADER_MISSING", file });

  for (const doc of docs) {
    const error = doc.errors[0];
    if (error) {
      const at = error.linePos?.[0] ?? { line: 1, col: 1 };
      return problem({
        code: "FLOW_YAML_INVALID",
        file,
        line: at.line,
        column: at.col,
        detail: error.message.split("\n")[0] ?? error.code,
      });
    }
  }

  const lineOf = (node: Node | null | undefined, fallback = 1) =>
    node?.range ? lines.linePos(node.range[0]).line : fallback;

  const [headerDoc, bodyDoc, extraDoc] = docs;
  if (!headerDoc || !bodyDoc)
    return problem({ code: "FLOW_HEADER_MISSING", file });
  if (extraDoc) {
    return problem({
      code: "FLOW_TOO_MANY_DOCUMENTS",
      file,
      line: lineOf(extraDoc.contents),
    });
  }

  const header = headerDoc.contents;
  if (!isMap(header)) {
    return problem({
      code: "FLOW_HEADER_NOT_A_MAP",
      file,
      line: lineOf(header),
    });
  }
  const headerValues = headerDoc.toJS() as Record<string, unknown>;

  const appId = headerValues.appId;
  if (typeof appId === "string" && appId.trim() !== "") flow.appId = appId;
  else problem({ code: "FLOW_APP_ID_MISSING", file, line: lineOf(header) });

  if (
    typeof headerValues.name === "string" &&
    headerValues.name.trim() !== ""
  ) {
    flow.name = headerValues.name;
  }

  const properties = readProperties(headerValues.properties);
  if (properties) flow.properties = properties;
  else
    problem({
      code: "FLOW_PROPERTIES_INVALID",
      file,
      line: lineOf(nodeAt(header, "properties")),
    });

  const defined = new Set(
    isPlainObject(headerValues.env) ? Object.keys(headerValues.env) : [],
  );

  const reader = new StepReader(file, lineOf, flow);
  for (const hook of ["onFlowStart", "onFlowComplete"]) {
    const hookNode = nodeAt(header, hook);
    const commands = isMap(hookNode)
      ? hookNode.get("commands", true)
      : hookNode;
    if (isSeq(commands)) reader.readList(commands.items);
  }

  const body = bodyDoc.contents;
  if (!isSeq(body) || body.items.length === 0) {
    return problem({
      code: "FLOW_STEPS_MISSING",
      file,
      line: lineOf(body, lineOf(header) + 1),
    });
  }
  flow.steps = reader.readList(body.items);

  flow.variables = [...variablesIn([headerDoc.toJS(), bodyDoc.toJS()])]
    .filter((name) => !defined.has(name) && !name.startsWith("MAESTRO_"))
    .sort();
  return flow;
}

class StepReader {
  constructor(
    private readonly file: string,
    private readonly lineOf: (node: Node | null | undefined) => number,
    private readonly flow: Flow,
  ) {}

  readList(items: unknown[]): Step[] {
    const steps: Step[] = [];
    for (const item of items) {
      const step = this.read(item as Node);
      if (step) steps.push(step);
    }
    return steps;
  }

  private read(node: Node): Step | undefined {
    const line = this.lineOf(node);
    if (isScalar(node) && typeof node.value === "string") {
      return this.step(node.value, null, line);
    }
    if (!isMap(node) || node.items.length !== 1) {
      this.flow.problems.push({
        code: "FLOW_STEP_INVALID",
        file: this.file,
        line,
      });
      return undefined;
    }
    const pair = node.items[0];
    const command = isScalar(pair?.key) ? String(pair.key.value) : "";
    const value = pair?.value as Node | null;
    const step = this.step(
      command,
      value === null ? null : value.toJSON(),
      line,
    );

    if (NESTING_COMMANDS.has(command)) {
      this.readCall(command, value, line);
      const nested = isMap(value) ? value.get("commands", true) : undefined;
      if (isSeq(nested)) step.steps = this.readList(nested.items);
    }
    return step;
  }

  private step(command: string, args: unknown, line: number): Step {
    if (AI_COMMANDS.has(command)) {
      this.flow.problems.push({
        code: "FLOW_AI_COMMAND",
        file: this.file,
        line,
        command,
      });
    }
    const kind: StepKind = CHECK_COMMANDS.has(command) ? "check" : "action";
    return { kind, command, args, line };
  }

  private readCall(command: string, value: Node | null, line: number): void {
    let target: unknown;
    let passes: string[] = [];
    if (command === "runFlow" && isScalar(value)) {
      target = value.value;
    } else if (isMap(value)) {
      target = value.get("file");
      const env = value.get("env", true);
      if (isMap(env))
        passes = env.items.map((p) =>
          String(isScalar(p.key) ? p.key.value : p.key),
        );
    }
    if (typeof target === "string" && target.trim() !== "") {
      this.flow.calls.push({
        file: resolve(dirname(this.file), target),
        passes,
        line,
      });
    }
  }
}

function readProperties(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) return undefined;
  const properties: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "boolean"
    ) {
      return undefined;
    }
    properties[key] = String(item);
  }
  return properties;
}

function variablesIn(values: unknown[]): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(VARIABLE))
        if (match[1]) found.add(match[1]);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isPlainObject(value)) {
      Object.values(value).forEach(visit);
    }
  };
  values.forEach(visit);
  return found;
}

function nodeAt(map: YAMLMap, key: string): Node | undefined {
  return map.get(key, true);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fileStem(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.ya?ml$/i, "");
}
