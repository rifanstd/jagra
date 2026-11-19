import { randomUUID } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { fail, ok, type JagraError, type Result } from "../errors/index.js";
import type { AgentClient, AgentReply } from "../ports/agent-client.js";
import type { Clock } from "../ports/clock.js";
import type { GitClient } from "../ports/git.js";
import {
  compare,
  takeSnapshot,
  type Changes,
  type SafetyNetOptions,
  type Snapshot,
} from "../safety/snapshot.js";
import { SystemClock } from "../adapters/clock/system-clock.js";
import { discoverFlows, flowsFolder } from "../project/flows.js";
import { flowFileName } from "../project/new-flow.js";
import {
  buildFix,
  buildHistory,
  buildInstructions,
  type FixRequest,
} from "./instructions.js";
import { checkJagraFolder, isInside } from "./paths.js";
import { readReport, type AgentReport } from "./report.js";
import {
  backupFolder,
  saveSession,
  sessionFolder,
  type AgentSession,
} from "./session.js";

/** Without a git client, the safety net copies the folder like any plain one (D-114). */
const NO_GIT: GitClient = {
  head: () =>
    Promise.resolve(fail({ code: "PROGRAM_NOT_FOUND", program: "git" })),
  changed: () =>
    Promise.resolve(fail({ code: "PROGRAM_NOT_FOUND", program: "git" })),
  show: () =>
    Promise.resolve(fail({ code: "PROGRAM_NOT_FOUND", program: "git" })),
  untracked: () =>
    Promise.resolve(fail({ code: "PROGRAM_NOT_FOUND", program: "git" })),
  gitDir: () =>
    Promise.resolve(fail({ code: "PROGRAM_NOT_FOUND", program: "git" })),
};

/** AGT-13: an agent still working after this long is stopped. */
export const AGENT_TIME_LIMIT_MS = 15 * 60_000;

/** Files whose presence means the folder holds the app's source code (AGT-14, D-113). */
const SOURCE_MARKERS = [
  "settings.gradle",
  "settings.gradle.kts",
  "build.gradle",
  "build.gradle.kts",
  join("app", "src"),
];

export interface AskOptions {
  client: AgentClient;
  /** The agent in use, by id, kept in the session. */
  agent: string;
  /** Shown in errors, such as `Claude Code`. */
  agentName: string;
  clock?: Clock;
  newId?: () => string;
  timeLimitMs?: number;
  /** For the safety net in a git repository. Without it, every folder is treated as a plain one. */
  git?: GitClient;
  backupLimitBytes?: number;
}

export interface AskTarget {
  appData: string;
  projectId: string;
  /** The project folder. */
  folder: string;
  signal?: AbortSignal;
}

/**
 * What came of one call to the agent. Once the agent has run, the outcome comes back even when it
 * stopped with an error, because the safety net ran anyway (AGT-13, AGT-19).
 */
export interface AgentOutcome {
  session: AgentSession;
  /** Why the agent stopped early: cancelled, timed out, failed. */
  error?: JagraError;
  finalMessage: string;
  /** AGT-19, AGT-20: what changed outside `.jagra/flows`, and in flows other than this one. */
  changes: Changes;
  /** False when the folder was too large to copy, so Restore is not offered. */
  restorable: boolean;
  /** Undefined when the agent's message has no readable report (AGT-16). */
  report?: AgentReport;
  /** Files the agent tried to change outside `.jagra/flows` and was refused. */
  refused?: string[];
}

/**
 * Create flow (AGT-12 to AGT-16): builds the instructions, starts a new session and reads the
 * report. Only a user action calls it, and it never repeats itself (AGT-5).
 */
export async function askForFlow(
  options: AskOptions,
  target: AskTarget & {
    scenario: string;
    /** The optional flow name the user typed. */
    flowName?: string;
    appId: string;
  },
): Promise<Result<AgentOutcome>> {
  let file: string | undefined;
  if (target.flowName?.trim()) {
    file = flowFileName(target.flowName);
    if (!file)
      return fail({ code: "FLOW_NAME_INVALID", name: target.flowName });
    if (await exists(join(flowsFolder(target.folder), file))) {
      return fail({ code: "FLOW_EXISTS", file });
    }
  }
  const list = await discoverFlows(target.folder);
  const parts = flowsFolder(target.folder);
  const instructions = buildInstructions(await teamRules(target.folder), {
    scenario: target.scenario,
    ...(file ? { file } : {}),
    appId: target.appId,
    hasSourceCode: await hasSourceCode(target.folder),
    helpers: list.helpers.map((flow) => ({
      file: slashes(relative(parts, flow.file)),
      name: flow.name,
    })),
    flows: list.flows.map((flow) => ({
      file: basename(flow.file),
      name: flow.name,
    })),
  });
  const session: AgentSession = {
    id: (options.newId ?? randomUUID)(),
    agent: options.agent,
    scenario: target.scenario,
    ...(file ? { flow: file } : {}),
    startedAt: new Date(
      (options.clock ?? new SystemClock()).now(),
    ).toISOString(),
  };
  const folder = await checkJagraFolder(target.folder);
  if (!folder.ok) return folder;
  const snapshot = await guard(options, target, session);
  const reply = await call(options, target, session, instructions, (request) =>
    options.client.start(request),
  );
  return ok(await settle(options, target, session, reply, snapshot));
}

/**
 * Ask agent to fix (AGT-27): sends the note and the failure to the same session (AGT-17). When
 * the agent cannot continue it, a new session gets the earlier work written out (AGT-18).
 */
export async function askForFix(
  options: AskOptions,
  target: AskTarget & {
    session: AgentSession;
    /** The flow on the Review screen, inside `.jagra/flows` with `/`. */
    flow: string;
    fix: Omit<FixRequest, "file">;
  },
): Promise<Result<AgentOutcome>> {
  const file = `.jagra/flows/${target.flow}`;
  const fix: FixRequest = { ...target.fix, file };
  const session: AgentSession = { ...target.session, flow: target.flow };
  const folder = await checkJagraFolder(target.folder);
  if (!folder.ok) return folder;
  const snapshot = await guard(options, target, session);
  if (session.agentSession) {
    const continued = await call(
      options,
      target,
      session,
      buildFix(fix),
      (request) => options.client.continue(session.agentSession ?? "", request),
    );
    if (continued.ok || continued.error.code !== "AGENT_CANNOT_CONTINUE") {
      return ok(await settle(options, target, session, continued, snapshot));
    }
  }
  const content = await readFile(join(target.folder, file), "utf8").catch(
    () => "",
  );
  const instructions = buildHistory(await teamRules(target.folder), {
    scenario: session.scenario,
    file,
    content,
    fix,
  });
  const fresh = await call(options, target, session, instructions, (request) =>
    options.client.start(request),
  );
  // The old agent session is gone; the new one replaces it, or none if the agent gives no id.
  const rest: AgentSession = { ...session };
  delete rest.agentSession;
  return ok(await settle(options, target, rest, fresh, snapshot));
}

/** AGT-19: the folder's state right before the agent starts, in `backups/<session id>`. */
function guard(
  options: AskOptions,
  target: AskTarget,
  session: AgentSession,
): Promise<Snapshot> {
  return takeSnapshot(target.folder, safetyNet(options, target, session));
}

function safetyNet(
  options: AskOptions,
  target: AskTarget,
  session: AgentSession,
): SafetyNetOptions {
  return {
    backup: backupFolder(target.appData, session.id),
    git: options.git ?? NO_GIT,
    ...(options.backupLimitBytes !== undefined
      ? { limitBytes: options.backupLimitBytes }
      : {}),
  };
}

/** After the agent stops for any reason: the report when there is one, then the comparison. */
async function settle(
  options: AskOptions,
  target: AskTarget,
  session: AgentSession,
  reply: Result<AgentReply>,
  snapshot: Snapshot,
): Promise<AgentOutcome> {
  const done = reply.ok
    ? await finish(target, session, reply.value)
    : { session, finalMessage: "" };
  const changes = await compare(
    snapshot,
    safetyNet(options, target, session),
    done.session.flow,
  );
  return {
    ...done,
    ...(reply.ok ? {} : { error: reply.error }),
    changes,
    restorable: snapshot.restorable,
  };
}

/** Writes the instructions, then runs the agent with Cancel and the time limit (AGT-13). */
async function call(
  options: AskOptions,
  target: AskTarget,
  session: AgentSession,
  instructions: string,
  run: (request: {
    folder: string;
    instructionsFile: string;
    workFolder: string;
    signal: AbortSignal;
  }) => Promise<Result<AgentReply>>,
): Promise<Result<AgentReply>> {
  const workFolder = sessionFolder(
    target.appData,
    target.projectId,
    session.id,
  );
  await saveSession(target.appData, target.projectId, session);
  const instructionsFile = join(workFolder, "instructions.md");
  await writeFile(instructionsFile, instructions, "utf8");
  const limit = AbortSignal.timeout(options.timeLimitMs ?? AGENT_TIME_LIMIT_MS);
  const signal = target.signal
    ? AbortSignal.any([target.signal, limit])
    : limit;
  const reply = await run({
    folder: target.folder,
    instructionsFile,
    workFolder,
    signal,
  });
  if (!reply.ok && limit.aborted && !target.signal?.aborted) {
    return fail({
      code: "AGENT_TIMED_OUT",
      agent: options.agentName,
      minutes: Math.round(
        (options.timeLimitMs ?? AGENT_TIME_LIMIT_MS) / 60_000,
      ),
    });
  }
  return reply;
}

/** Reads the report, settles which flow the session is about, and saves the session. */
async function finish(
  target: AskTarget,
  session: AgentSession,
  reply: AgentReply,
): Promise<Omit<AgentOutcome, "changes" | "restorable">> {
  const report = readReport(reply.finalMessage);
  const flow = session.flow ?? (await reportedFlow(target.folder, report));
  const saved: AgentSession = {
    ...session,
    ...(reply.sessionId ? { agentSession: reply.sessionId } : {}),
    ...(flow ? { flow } : {}),
  };
  await saveSession(target.appData, target.projectId, saved);
  return {
    session: saved,
    finalMessage: reply.finalMessage,
    ...(report ? { report } : {}),
    ...(reply.refused ? { refused: reply.refused } : {}),
  };
}

/** The report's flow, when it is a YAML file inside `.jagra/flows`. */
async function reportedFlow(
  folder: string,
  report: AgentReport | undefined,
): Promise<string | undefined> {
  if (!report) return undefined;
  const flows = flowsFolder(folder);
  const path = join(folder, report.flow);
  if (!/\.ya?ml$/i.test(path) || !(await isInside(flows, path))) {
    return undefined;
  }
  const inside = slashes(relative(flows, path));
  return inside === "" ? undefined : inside;
}

async function teamRules(folder: string): Promise<string> {
  return readFile(join(folder, ".jagra", "agent-rules.md"), "utf8").catch(
    () => "",
  );
}

export async function hasSourceCode(folder: string): Promise<boolean> {
  for (const marker of SOURCE_MARKERS) {
    if (await exists(join(folder, marker))) return true;
  }
  return false;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slashes(path: string): string {
  return path.split(sep).join("/");
}
