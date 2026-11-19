import { randomUUID } from "node:crypto";
import { copyFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  asText,
  askForFix,
  askForFlow,
  backupFolder,
  contentBefore,
  endSession,
  failureLikely,
  fail,
  flowBefore,
  flowsFolder,
  isInside,
  knownProjects,
  lineDiff,
  loadConfig,
  loadLocal,
  loadSnapshot,
  noLinksBetween,
  restore,
  runsFolder,
  sessionFolder,
  undoFlow,
  updateLocal,
  type AgentChoice,
  type AgentClient,
  type AgentOutcome,
  type AgentSession,
  type GitClient,
  type Result,
  type SafetyNetOptions,
} from "@jagra/core";
import type {
  AiLive,
  AiReview,
  AiStartAnswer,
  ChangeView,
  StepView,
} from "../shared/api.js";
import type { Agents } from "./agents.js";
import { flowSteps, type Runs } from "./runs.js";

export interface AiOptions {
  appData: string;
  agents: Pick<Agents, "inUse">;
  /** The client for the agent in use: its command line or ACP, or a fake in test mode. */
  clientFor(choice: AgentChoice & { id: string; name: string }): AgentClient;
  git: GitClient;
  runs: Pick<Runs, "flowDetail">;
  broadcast(live: AiLive | undefined): void;
  timeLimitMs?: number;
  newId?: () => string;
  now?: () => number;
}

interface Current {
  projectId: string;
  folder: string;
  appId: string;
  choice: AgentChoice & { id: string; name: string };
  session?: AgentSession;
  /**
   * The flow as it was before the session's first call: null when the agent created it. Discard
   * puts this back, so it never deletes a flow that was there before.
   */
  original?: { flow: string; content: Uint8Array | null };
}

/**
 * Create flow with AI (spec section 10), one request at a time. Every call to the agent starts
 * from a user action and is never repeated on its own (AGT-5). The safety net runs around each
 * call, and its warning comes before the review (AGT-19).
 */
export class Ai {
  private live: AiLive | undefined;
  private current: Current | undefined;
  private abort: AbortController | undefined;

  constructor(private readonly options: AiOptions) {}

  get busy(): boolean {
    return this.live?.phase === "agent";
  }

  state(): AiLive | undefined {
    return this.live;
  }

  /** AGT-11: whether the notice must show first for this project. */
  async notice(
    projectId: string,
  ): Promise<
    { needed: boolean; agentName: string; folder: string } | undefined
  > {
    const project = await this.project(projectId);
    if (!project) return undefined;
    const local = await loadLocal(this.options.appData, projectId);
    const agent = await this.options.agents.inUse();
    return {
      needed: local.aiNoticeAccepted !== true,
      agentName: agent?.name ?? "",
      folder: project.folder,
    };
  }

  async acceptNotice(projectId: string): Promise<void> {
    if (await this.project(projectId)) {
      await updateLocal(this.options.appData, projectId, {
        aiNoticeAccepted: true,
      });
    }
  }

  /** AGT-12: Create flow. */
  async start(request: {
    projectId: string;
    scenario: string;
    flowName?: string;
  }): Promise<AiStartAnswer> {
    if (this.busy) throw new Error("an agent is already working");
    const project = await this.project(request.projectId);
    if (!project) throw new Error("unknown project");
    const config = await loadConfig(project.folder);
    if (!config.ok) return { error: config.error };
    const local = await loadLocal(this.options.appData, request.projectId);
    if (local.aiNoticeAccepted !== true) return { notice: true };
    const choice = await this.options.agents.inUse();
    if (!choice) return { error: { code: "AGENT_NONE" } };

    this.current = {
      projectId: request.projectId,
      folder: project.folder,
      appId: config.value.appId ?? "",
      choice,
    };
    this.live = {
      projectId: request.projectId,
      projectName: config.value.name,
      agentName: choice.name,
      scenario: request.scenario,
      phase: "agent",
      startedAt: new Date(this.now()).toISOString(),
      cancelling: false,
      outside: [],
      restorable: true,
      otherFlows: [],
      flowExists: false,
      finalMessage: "",
      fixed: false,
    };
    this.send();
    const current = this.current;
    void this.work(() =>
      askForFlow(this.askOptions(current), {
        ...this.target(current),
        scenario: request.scenario,
        ...(request.flowName ? { flowName: request.flowName } : {}),
        appId: current.appId,
      }),
    );
    return { started: true };
  }

  /** AGT-27: the note and the review run's failure go to the same session (AGT-17, AGT-18). */
  async fix(request: { note: string; runId?: string }): Promise<AiStartAnswer> {
    if (this.busy) throw new Error("an agent is already working");
    const current = this.current;
    const live = this.live;
    const session = current?.session;
    if (!current || !live || !session || !live.flow) {
      return {
        error: { code: "AGENT_CANNOT_CONTINUE", agent: live?.agentName ?? "" },
      };
    }
    const failure = request.runId ? await this.failure(request.runId) : {};
    const flow = live.flow;
    this.live = {
      ...live,
      phase: "agent",
      startedAt: new Date(this.now()).toISOString(),
      cancelling: false,
      outside: [],
      otherFlows: [],
      fixed: true,
    };
    delete this.live.error;
    delete this.live.notRestored;
    this.send();
    void this.work(() =>
      askForFix(this.askOptions(current), {
        ...this.target(current),
        session,
        flow,
        fix: {
          ...(request.note.trim() ? { note: request.note } : {}),
          ...failure,
        },
      }),
    );
    return { started: true };
  }

  /** AGT-13: stops the agent; the safety net still runs. */
  cancel(): void {
    if (!this.busy || !this.live) return;
    this.live = { ...this.live, cancelling: true };
    this.abort?.abort();
    this.send();
  }

  /** AGT-19: Restore, then on to the review. */
  async restore(): Promise<void> {
    const live = this.live;
    const snapshot = await this.snapshot();
    if (!live || live.phase !== "warning" || !snapshot) return;
    const failed = await restore(
      snapshot.snapshot,
      snapshot.options,
      live.outside.map((change) => change.path),
    );
    this.live = {
      ...live,
      ...(failed.length > 0 ? { notRestored: failed } : {}),
    };
    this.afterWarning();
  }

  /** AGT-19: Keep the changes, and go on. */
  keep(): void {
    if (this.live?.phase === "warning") this.afterWarning();
  }

  /** View changes for a listed file (AGT-19, AGT-20). */
  async viewChange(
    kind: "outside" | "flow",
    path: string,
  ): Promise<ChangeView | undefined> {
    const live = this.live;
    const current = this.current;
    const listed = (
      kind === "outside" ? live?.outside : live?.otherFlows
    )?.some((change) => change.path === path);
    const snapshot = await this.snapshot();
    if (!listed || !current || !snapshot) return undefined;
    const before =
      kind === "outside"
        ? await contentBefore(snapshot.snapshot, snapshot.options, path)
        : await flowBefore(snapshot.snapshot, snapshot.options, path);
    if (before === undefined) return { path, unavailable: true };
    const file =
      kind === "outside"
        ? join(current.folder, ...path.split("/"))
        : join(flowsFolder(current.folder), ...path.split("/"));
    const after = await readFile(file).catch(() => null);
    const [a, b] = [asText(before), asText(after)];
    if (a === undefined || b === undefined) return { path, binary: true };
    const lines = lineDiff(a, b);
    return lines ? { path, lines } : { path };
  }

  /** AGT-20: undoes one other flow's change. */
  async undoFlow(path: string): Promise<void> {
    const live = this.live;
    const snapshot = await this.snapshot();
    if (!live || !snapshot) return;
    if (!live.otherFlows.some((change) => change.path === path)) return;
    if (await undoFlow(snapshot.snapshot, snapshot.options, path)) {
      this.live = {
        ...live,
        otherFlows: live.otherFlows.filter((change) => change.path !== path),
      };
      this.send();
    }
  }

  /** AGT-22: the flow's steps and its YAML, before and after the review run. */
  async preview(): Promise<{ steps?: StepView[]; yaml?: string } | undefined> {
    const current = this.current;
    const flow = this.live?.flow;
    if (!current || !flow) return undefined;
    const file = join(flowsFolder(current.folder), ...flow.split("/"));
    const yaml = await readFile(file, "utf8").catch(() => undefined);
    const steps = await flowSteps(current.folder, file);
    return {
      ...(steps ? { steps } : {}),
      ...(yaml !== undefined ? { yaml } : {}),
    };
  }

  /** The review run's result with the AGT-24 note. */
  async review(runId: string): Promise<AiReview | undefined> {
    const current = this.current;
    if (!current) return undefined;
    const detail = await this.options.runs.flowDetail(
      current.projectId,
      runId,
      0,
    );
    if (!detail) return undefined;
    const likely =
      detail.flow.status === "failed" && detail.steps
        ? failureLikely(detail.steps, detail.flow.failedStep)
        : undefined;
    return likely ? { detail, likely } : { detail };
  }

  /** AGT-27: Save keeps the flow, even one that fails because of an app bug. */
  async save(): Promise<void> {
    await this.end();
  }

  /** AGT-27: Discard deletes the flow file, and only inside `.jagra/flows`. */
  async discard(): Promise<void> {
    const current = this.current;
    const flow = this.live?.flow;
    if (current && flow && !this.busy) {
      const flows = flowsFolder(current.folder);
      const file = join(flows, ...flow.split("/"));
      const original =
        current.original?.flow === flow ? current.original.content : null;
      // A link on the way could move the delete outside the project (D-117).
      if (
        (await isInside(flows, file)) &&
        (await noLinksBetween(current.folder, file))
      ) {
        if (original === null) await rm(file, { force: true });
        else await writeFile(file, original);
      }
    }
    await this.end();
  }

  private async end(): Promise<void> {
    if (this.busy) return;
    const current = this.current;
    if (current?.session) {
      await endSession(
        this.options.appData,
        current.projectId,
        current.session.id,
      );
    }
    this.current = undefined;
    this.live = undefined;
    this.send();
  }

  private async work(ask: () => Promise<Result<AgentOutcome>>): Promise<void> {
    const result = await ask().catch((e: unknown): Result<AgentOutcome> =>
      fail({
        code: "AGENT_FAILED",
        agent: this.live?.agentName ?? "",
        detail: String(e),
      }),
    );
    const live = this.live;
    const current = this.current;
    if (!live || !current) return;
    if (!result.ok) {
      this.live = {
        ...live,
        phase: "stopped",
        cancelling: false,
        error: result.error,
      };
      this.send();
      return;
    }
    const outcome = result.value;
    current.session = outcome.session;
    const flow = outcome.session.flow;
    if (flow && current.original?.flow !== flow) {
      const snapshot = await this.snapshot();
      current.original = {
        flow,
        content: snapshot
          ? await flowBefore(snapshot.snapshot, snapshot.options, flow).catch(
              () => null,
            )
          : null,
      };
    }
    const flowExists = flow
      ? await stat(join(flowsFolder(current.folder), ...flow.split("/"))).then(
          (info) => info.isFile(),
          () => false,
        )
      : false;
    this.live = {
      ...live,
      phase: "agent",
      cancelling: false,
      ...(outcome.error ? { error: outcome.error } : {}),
      outside: outcome.changes.outside,
      restorable: outcome.restorable,
      otherFlows: outcome.changes.flows,
      ...(flow ? { flow } : {}),
      flowExists,
      ...(outcome.report ? { report: outcome.report } : {}),
      finalMessage: outcome.finalMessage,
      ...(outcome.refused ? { refused: outcome.refused } : {}),
    };
    if (outcome.changes.outside.length > 0) this.live.phase = "warning";
    else this.afterWarning();
    this.send();
  }

  private afterWarning(): void {
    if (!this.live) return;
    this.live = {
      ...this.live,
      phase: this.live.error ? "stopped" : "review",
    };
    this.send();
  }

  /** The failing step, Maestro's reason, the screen and a copy of the screenshot (AGT-27). */
  private async failure(runId: string): Promise<{
    failedStep?: string;
    reason?: string;
    screenshot?: string;
    screen?: NonNullable<AiReview["detail"]["flow"]["screen"]>;
  }> {
    const current = this.current;
    if (!current?.session) return {};
    const detail = await this.options.runs.flowDetail(
      current.projectId,
      runId,
      0,
    );
    if (!detail || detail.flow.status === "passed") return {};
    const result = detail.flow;
    const step = stepAt(detail.steps ?? [], result.failedStep ?? []);
    let screenshot: string | undefined;
    if (result.screenshot) {
      const source = join(
        runsFolder(this.options.appData, current.projectId),
        runId,
        result.screenshot,
      );
      const target = join(
        sessionFolder(
          this.options.appData,
          current.projectId,
          current.session.id,
        ),
        "failure.png",
      );
      screenshot = await copyFile(source, target).then(
        () => target,
        () => undefined,
      );
    }
    return {
      ...(step
        ? { failedStep: `${step.command}: ${JSON.stringify(step.args)}` }
        : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(screenshot ? { screenshot } : {}),
      ...(result.screen ? { screen: result.screen } : {}),
    };
  }

  private askOptions(current: Current) {
    this.abort = new AbortController();
    return {
      client: this.options.clientFor(current.choice),
      agent: current.choice.id,
      agentName: current.choice.name,
      git: this.options.git,
      newId: this.options.newId ?? randomUUID,
      ...(this.options.timeLimitMs !== undefined
        ? { timeLimitMs: this.options.timeLimitMs }
        : {}),
    };
  }

  private target(current: Current) {
    return {
      appData: this.options.appData,
      projectId: current.projectId,
      folder: current.folder,
      signal: (this.abort ?? new AbortController()).signal,
    };
  }

  private async snapshot(): Promise<
    | {
        snapshot: NonNullable<Awaited<ReturnType<typeof loadSnapshot>>>;
        options: SafetyNetOptions;
      }
    | undefined
  > {
    const session = this.current?.session;
    if (!session) return undefined;
    const backup = backupFolder(this.options.appData, session.id);
    const snapshot = await loadSnapshot(backup);
    return snapshot
      ? { snapshot, options: { backup, git: this.options.git } }
      : undefined;
  }

  private async project(id: string) {
    return (await knownProjects(this.options.appData)).find((p) => p.id === id);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private send(): void {
    this.options.broadcast(this.live);
  }
}

function stepAt(steps: StepView[], path: number[]): StepView | undefined {
  let level: StepView[] | undefined = steps;
  let step: StepView | undefined;
  for (const index of path) {
    step = level?.[index];
    if (!step) return undefined;
    level = step.steps;
  }
  return step;
}
