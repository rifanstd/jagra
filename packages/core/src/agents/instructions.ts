import type { ScreenElement } from "../types/index.js";

/**
 * The built-in template (AGT-15), in English whatever the user's language. It ends with the report
 * Jagra reads back (AGT-16). The rules repeat what Jagra enforces anyway, so an agent that follows
 * them never meets a refusal.
 */
export const TEMPLATE = `You write one Maestro flow for Jagra. Jagra runs Maestro flows on an Android app to test a build before it goes to QA. You only write the flow; Jagra runs it afterwards and Maestro decides whether it passes.

Rules:
- Write plain Maestro YAML that the normal Maestro CLI accepts: a header with \`appId\`, \`name\` and \`properties\` with \`condition: success\`, then \`---\`, then the list of steps.
- Start the steps with \`- launchApp:\` and \`clearState: true\` on the next line.
- When one of the helper flows listed below fits, call it with \`runFlow\` instead of repeating its steps.
- Write passwords, tokens and other secrets as variables such as \`\${PASSWORD}\`, never as values.
- Write only inside \`.jagra/flows\`. Do not create, change or delete any other file.
- Do not run any command: not Maestro, not adb, not a build, not a script.
- Never use Maestro's AI commands: \`assertWithAI\`, \`assertNoDefectsWithAI\` and \`extractTextWithAI\`.
- When the project folder has the app's source code, read it and use the exact text of buttons, fields and messages, for example from string resources and layouts.
- Keep every check the scenario asks for. If the code shows the app does not do what the scenario expects, keep the check as the scenario wants it and report a possible bug instead of changing the check.

When you are done, end your reply with this JSON object and nothing after it:
{"flow": "<the flow file you wrote, relative to the project folder>", "checks": "<one or two sentences on what the flow checks>", "possibleBug": "<what in the code suggests the app does not do what the scenario expects, or null>", "suggestedTests": ["<another scenario worth a flow of its own>"]}`;

/** A flow the agent may call or must not duplicate, as the request lists it (AGT-14). */
export interface ListedFlow {
  /** Path inside `.jagra/flows`, with `/`. */
  file: string;
  name: string;
}

export interface FlowRequest {
  /** What the user typed, in any language (AGT-12). */
  scenario: string;
  /** The file to write, when the user named the flow. */
  file?: string;
  appId: string;
  hasSourceCode: boolean;
  helpers: ListedFlow[];
  flows: ListedFlow[];
}

/** What Ask agent to fix sends with the user's note (AGT-27). */
export interface FixRequest {
  /** The flow file, relative to the project folder. */
  file: string;
  note?: string;
  /** The failing step as Jagra shows it, such as `Tap on "Save"`. */
  failedStep?: string;
  reason?: string;
  /** A copy of the screenshot the agent may read, when there is one. */
  screenshot?: string;
  screen?: ScreenElement[];
}

/** The earlier work, for a new session when the agent cannot continue one (AGT-18). */
export interface History {
  scenario: string;
  /** The flow file as it is now, with its path relative to the project folder. */
  file: string;
  content: string;
  fix: FixRequest;
}

/** Template, team rules when there are any, then the request (AGT-14). */
export function buildInstructions(rules: string, request: FlowRequest): string {
  return join([TEMPLATE, teamRules(rules), requestPart(request)]);
}

/** The message for a session that continues (AGT-17). The template is already in the session. */
export function buildFix(fix: FixRequest): string {
  return join([
    `Fix the flow ${fix.file}. Jagra ran it and it did not pass.`,
    fixPart(fix),
    "Change only that flow, unless a helper flow is wrong. End your reply with the JSON report again.",
  ]);
}

/** A new session that gets the earlier work written out (AGT-18). */
export function buildHistory(rules: string, history: History): string {
  return join([
    TEMPLATE,
    teamRules(rules),
    [
      "## Earlier work",
      "",
      "Another session started this flow and cannot be continued, so here is what happened.",
      "",
      "The user's scenario:",
      quote(history.scenario),
      "",
      `The flow so far, in ${history.file}:`,
      "```yaml",
      history.content.trimEnd(),
      "```",
    ].join("\n"),
    `## What to do now\n\nFix the flow ${history.file}. Jagra ran it and it did not pass.`,
    fixPart(history.fix),
    "End your reply with the JSON report.",
  ]);
}

function teamRules(rules: string): string {
  const text = rules.trim();
  return text
    ? `## Rules from the team (.jagra/agent-rules.md)\n\nThey come on top of the rules above.\n\n${text}`
    : "";
}

function requestPart(request: FlowRequest): string {
  const where = request.file
    ? `Write the flow to \`.jagra/flows/${request.file}\`.`
    : "Write the flow to a new file in `.jagra/flows`, named after the scenario in English, in lowercase with hyphens, such as `login-wrong-password.yaml`.";
  return [
    "## The request",
    "",
    "The user's scenario, possibly in another language:",
    quote(request.scenario),
    "",
    where,
    `The app's \`appId\` is \`${request.appId}\`.`,
    request.hasSourceCode
      ? "The project folder has the app's source code."
      : "The project folder does not have the app's source code, so use the scenario's words for buttons and fields.",
    "",
    "Helper flows in `.jagra/flows/parts`:",
    list(request.helpers),
    "",
    "Flows that exist already. Do not write one that tests the same thing:",
    list(request.flows),
  ].join("\n");
}

function fixPart(fix: FixRequest): string {
  const lines = [
    `The user's note: ${fix.note?.trim() ? fix.note.trim() : "none"}`,
  ];
  if (fix.failedStep) lines.push(`The step that failed: ${fix.failedStep}`);
  if (fix.reason) lines.push(`Maestro's reason: ${fix.reason}`);
  if (fix.screenshot)
    lines.push(`Screenshot at the failure: ${fix.screenshot}`);
  if (fix.screen && fix.screen.length > 0) {
    lines.push(
      "",
      "What was on the screen at the failure:",
      ...fix.screen.map((element) => `- ${describe(element)}`),
    );
  }
  return lines.join("\n");
}

function describe(element: ScreenElement): string {
  return [
    element.text !== undefined ? `text "${element.text}"` : undefined,
    element.id !== undefined ? `id "${element.id}"` : undefined,
    element.description !== undefined
      ? `description "${element.description}"`
      : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function list(flows: ListedFlow[]): string {
  return flows.length === 0
    ? "- none"
    : flows.map((flow) => `- ${flow.file}: ${flow.name}`).join("\n");
}

/** The user's words as a quoted block, so they read as the request and not as rules. */
function quote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function join(parts: string[]): string {
  return `${parts.filter((part) => part !== "").join("\n\n")}\n`;
}
