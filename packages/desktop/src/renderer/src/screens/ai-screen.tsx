import type { FileChange } from "@jagra/core/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AiLive,
  AiReview,
  ChangeView,
  StepView,
} from "../../../shared/api";
import { Note } from "../components/note";
import { RunControls } from "../components/run-controls";
import { Spinner, Status } from "../components/status";
import { TextLink } from "../components/text-link";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { describeError } from "../errors";
import { formatDuration } from "../format";
import type { Go } from "../navigation";
import { useDevices } from "../use-devices";
import { useLiveRun } from "../use-live-run";
import { Steps, withNotRun } from "./flow-detail-screen";
import { DeviceField } from "./project-screen";

/** The request in progress, kept current while the screen is open. Null while loading. */
function useAi(): AiLive | undefined | null {
  const [live, setLive] = useState<AiLive | undefined | null>(null);
  useEffect(() => {
    let open = true;
    const stop = window.jagra.ai.onUpdate((next) => setLive(next));
    void window.jagra.ai.live().then((first) => {
      if (open) setLive(first);
    });
    return () => {
      open = false;
      stop();
    };
  }, []);
  return live;
}

/** Screens 08, 13 and 14: Create flow with AI, from the request to the review (spec section 10). */
export function AiScreen({
  projectId,
  scenario,
  go,
}: {
  projectId: string;
  scenario?: string;
  go: Go;
}) {
  const live = useAi();
  if (live === null) return null;
  if (!live || live.projectId !== projectId) {
    return (
      <RequestForm
        projectId={projectId}
        initial={scenario ?? ""}
        busy={live !== undefined && live.phase === "agent"}
        go={go}
      />
    );
  }
  if (live.phase === "agent") return <Working live={live} />;
  if (live.phase === "warning") {
    return (
      <>
        <Working live={live} />
        <Warning live={live} />
      </>
    );
  }
  if (live.phase === "stopped") return <Stopped live={live} go={go} />;
  return <Review live={live} go={go} />;
}

function Page({
  title,
  sub,
  wide = false,
  actions,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  wide?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full px-4 pt-7 pb-12 sm:px-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {sub && <div className="mt-1 text-muted-foreground">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

/** AGT-12: the scenario in any language and an optional file name; AGT-11 before the first time. */
function RequestForm({
  projectId,
  initial,
  busy,
  go,
}: {
  projectId: string;
  initial: string;
  busy: boolean;
  go: Go;
}) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState(initial);
  const [flowName, setFlowName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [notice, setNotice] = useState<{ folder: string }>();
  const [error, setError] = useState<AiLiveError>();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void window.jagra.ai.notice(projectId).then((answer) => {
      if (answer) setAgentName(answer.agentName);
    });
  }, [projectId]);

  const create = async () => {
    setSending(true);
    setError(undefined);
    try {
      const check = await window.jagra.ai.notice(projectId);
      if (check?.needed) {
        setNotice({ folder: check.folder });
        return;
      }
      const answer = await window.jagra.ai.start({
        projectId,
        scenario: scenario.trim(),
        ...(flowName.trim() ? { flowName: flowName.trim() } : {}),
      });
      if ("error" in answer) setError(answer.error);
      else if ("notice" in answer) setNotice({ folder: check?.folder ?? "" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Page title={t("ai.form.title")} sub={t("ai.form.lead")}>
      <Card className="gap-0 py-0">
        <form
          className="grid gap-5 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (scenario.trim() && !sending && !busy) void create();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ai-scenario">{t("ai.form.scenario")}</Label>
            <textarea
              id="ai-scenario"
              rows={4}
              maxLength={10_000}
              value={scenario}
              aria-describedby="ai-scenario-hint"
              onChange={(event) => setScenario(event.target.value)}
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <p id="ai-scenario-hint" className="text-xs text-muted-foreground">
              {t("ai.form.scenarioHint")}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-flow-name">
              {t("ai.form.flowName")}{" "}
              <span className="font-normal text-muted-foreground">
                {t("ai.form.optional")}
              </span>
            </Label>
            <Input
              id="ai-flow-name"
              value={flowName}
              maxLength={100}
              placeholder={t("ai.form.flowNamePlaceholder")}
              onChange={(event) => setFlowName(event.target.value)}
            />
          </div>
          {busy && (
            <Note tone="warning">
              <p>{t("ai.form.busy")}</p>
            </Note>
          )}
          {error && (
            <Note tone="failed">
              <p>{describeError(error, t)}</p>
            </Note>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              {t("ai.form.agent", { agent: agentName })}{" "}
              <TextLink onClick={() => go({ screen: "settings" })}>
                {t("ai.form.change")}
              </TextLink>
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => go({ screen: "project", id: projectId })}
            >
              {t("ai.form.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!scenario.trim() || sending || busy}
            >
              {t("ai.form.create")}
            </Button>
          </div>
        </form>
      </Card>
      <Dialog
        open={notice !== undefined}
        onOpenChange={(open) => !open && setNotice(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("ai.notice.title", { agent: agentName })}
            </DialogTitle>
            <DialogDescription>
              {t("ai.notice.reads", { agent: agentName })}{" "}
              <code className="font-mono text-foreground">
                {notice?.folder}
              </code>{" "}
              {t("ai.notice.sends")}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">{t("ai.notice.work")}</p>
          <p className="text-sm text-muted-foreground">{t("ai.notice.once")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotice(undefined)}>
              {t("ai.notice.cancel")}
            </Button>
            <Button
              onClick={() =>
                void window.jagra.ai.acceptNotice(projectId).then(() => {
                  setNotice(undefined);
                  return create();
                })
              }
            >
              {t("ai.notice.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

type AiLiveError = NonNullable<AiLive["error"]>;

/** AGT-13: that the agent works, for how long, and Cancel. */
function Working({ live }: { live: AiLive }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const working = live.phase === "agent";
  const elapsed = Math.max(0, now - Date.parse(live.startedAt));
  return (
    <Page
      title={t("ai.working.title")}
      sub={<q>{live.scenario}</q>}
      actions={
        <Button
          variant="outline"
          disabled={!working || live.cancelling}
          onClick={() => void window.jagra.ai.cancel()}
        >
          {live.cancelling
            ? t("ai.working.cancelling")
            : t("ai.working.cancel")}
        </Button>
      }
    >
      <Card className="gap-0 py-0">
        <ul data-testid="ai-steps">
          <li className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1">
              {t("ai.working.agent", { agent: live.agentName })}
            </span>
            {working && (
              <span className="text-sm text-muted-foreground">
                {formatDuration(elapsed - (elapsed % 1000), i18n.language, t)}
              </span>
            )}
            {working ? (
              <Status tone="running">{t("ai.working.busy")}</Status>
            ) : (
              <Status tone="passed">{t("ai.working.done")}</Status>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
            <span className="min-w-0 flex-1">
              {t("ai.working.checkBefore")}{" "}
              <code className="font-mono text-sm">.jagra/flows</code>
            </span>
            {working ? (
              <Status tone="waiting">{t("ai.working.waiting")}</Status>
            ) : (
              <Status tone="warning">{t("ai.working.changed")}</Status>
            )}
          </li>
          <li className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
            <span className="min-w-0 flex-1">{t("ai.working.run")}</span>
            <Status tone="waiting">{t("ai.working.waiting")}</Status>
          </li>
        </ul>
      </Card>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("ai.working.rulesBefore")}{" "}
        <code className="font-mono">.jagra/flows</code>{" "}
        {t("ai.working.rulesAfter")}
      </p>
    </Page>
  );
}

/** Screen 14 (AGT-19): files changed outside `.jagra/flows`, with View changes, Keep and Restore. */
function Warning({ live }: { live: AiLive }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState(false);
  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("ai.warning.title")}</DialogTitle>
          <DialogDescription>
            {t("ai.warning.leadBefore")}{" "}
            <code className="font-mono text-foreground">.jagra/flows</code>
            {t("ai.warning.leadAfter")}
          </DialogDescription>
        </DialogHeader>
        <ChangeList changes={live.outside} testId="outside-changes" />
        {live.restorable ? (
          <p className="text-sm text-muted-foreground">
            {t("ai.warning.restoreNote")}
          </p>
        ) : (
          <Note tone="warning">
            <p className="text-sm">{t("ai.warning.noBackup")}</p>
          </Note>
        )}
        <DialogFooter>
          {live.restorable && (
            <Button variant="outline" onClick={() => setViewing(true)}>
              {t("ai.warning.view")}
            </Button>
          )}
          <Button variant="outline" onClick={() => void window.jagra.ai.keep()}>
            {t("ai.warning.keep")}
          </Button>
          {live.restorable && (
            <Button onClick={() => void window.jagra.ai.restore()}>
              {t("ai.warning.restore")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
      <ChangesDialog
        kind="outside"
        paths={viewing ? live.outside.map((change) => change.path) : []}
        onClose={() => setViewing(false)}
      />
    </Dialog>
  );
}

function ChangeList({
  changes,
  testId,
  actions,
}: {
  changes: FileChange[];
  testId: string;
  actions?: (change: FileChange) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ul className="rounded-md border" data-testid={testId}>
      {changes.map((change) => (
        <li
          key={change.path}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 first:border-t-0"
        >
          <Status tone="warning">
            <span className="sr-only">{t("ai.change.changed")}</span>
          </Status>
          <span
            className="min-w-0 flex-1 truncate font-mono text-sm"
            title={change.path}
          >
            {change.path}
          </span>
          <span className="text-sm text-muted-foreground">
            {t(`ai.change.${change.kind}`)}
          </span>
          {actions?.(change)}
        </li>
      ))}
    </ul>
  );
}

/** View changes: each file's lines before and after the agent worked (AGT-19, AGT-20). */
function ChangesDialog({
  kind,
  paths,
  onClose,
}: {
  kind: "outside" | "flow";
  paths: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [views, setViews] = useState<ChangeView[]>();
  const key = paths.join("\n");
  useEffect(() => {
    if (key === "") {
      setViews(undefined);
      return;
    }
    void Promise.all(
      key.split("\n").map((path) => window.jagra.ai.viewChange(kind, path)),
    ).then((list) =>
      setViews(list.filter((view): view is ChangeView => view !== undefined)),
    );
  }, [kind, key]);
  return (
    <Dialog open={paths.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("ai.change.title")}</DialogTitle>
          <DialogDescription>{t("ai.change.lead")}</DialogDescription>
        </DialogHeader>
        <div
          className="grid max-h-[60vh] gap-4 overflow-auto"
          data-testid="change-views"
        >
          {views?.map((view) => (
            <section key={view.path} className="min-w-0">
              <h3 className="mb-1.5 truncate font-mono text-sm font-medium">
                {view.path}
              </h3>
              {view.lines ? (
                <pre className="overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
                  {view.lines.map((line, index) => (
                    <div
                      key={index}
                      className={
                        line.kind === "added"
                          ? "text-success"
                          : line.kind === "removed"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }
                    >
                      {line.kind === "added"
                        ? "+ "
                        : line.kind === "removed"
                          ? "- "
                          : "  "}
                      {line.text}
                    </div>
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {view.binary
                    ? t("ai.change.binary")
                    : view.unavailable
                      ? t("ai.change.unavailable")
                      : t("ai.change.tooLarge")}
                </p>
              )}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("ai.change.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The agent stopped early: cancelled, timed out or with an error (AGT-13). */
function Stopped({ live, go }: { live: AiLive; go: Go }) {
  const { t } = useTranslation();
  const back = async (discard: boolean) => {
    await (discard ? window.jagra.ai.discard() : window.jagra.ai.save());
    go({ screen: "project", id: live.projectId });
  };
  return (
    <Page title={t("ai.stopped.title")} sub={<q>{live.scenario}</q>}>
      <div className="grid gap-4">
        {live.error && (
          <Note tone="failed" testId="ai-error">
            <p>{describeError(live.error, t)}</p>
          </Note>
        )}
        {live.finalMessage && <AgentMessage text={live.finalMessage} />}
        <div className="flex flex-wrap gap-2">
          {live.flowExists && (
            <Button variant="destructive" onClick={() => void back(true)}>
              {t("ai.review.discard")}
            </Button>
          )}
          <Button variant="outline" onClick={() => void back(false)}>
            {t("ai.stopped.back")}
          </Button>
        </div>
      </div>
    </Page>
  );
}

function AgentMessage({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-2 p-5">
      <h2 className="font-semibold">{t("ai.review.message")}</h2>
      <pre className="max-h-80 overflow-auto font-sans text-sm whitespace-pre-wrap">
        {text}
      </pre>
    </Card>
  );
}

/** Screen 08, review (AGT-21 to AGT-27). */
function Review({ live, go }: { live: AiLive; go: Go }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{
    steps?: StepView[];
    yaml?: string;
  }>();
  const [yaml, setYaml] = useState(false);
  const [runId, setRunId] = useState<string>();
  const [review, setReview] = useState<AiReview>();
  const [viewing, setViewing] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const liveRun = useLiveRun();
  const flowFile =
    live.flow && !live.flow.includes("/") ? live.flow : undefined;

  useEffect(() => {
    void window.jagra.ai.preview().then(setPreview);
  }, [live.flow, live.fixed, live.startedAt]);

  // When the review run this screen started has ended, its result comes in.
  const running =
    runId !== undefined && liveRun !== undefined && liveRun.run.id === runId;
  const finished = running && liveRun.finished;
  useEffect(() => {
    if (runId && finished) void window.jagra.ai.review(runId).then(setReview);
  }, [runId, finished]);
  useEffect(() => {
    setRunId(undefined);
    setReview(undefined);
  }, [live.startedAt]);

  const end = async (discard: boolean) => {
    await (discard ? window.jagra.ai.discard() : window.jagra.ai.save());
    go({ screen: "project", id: live.projectId });
  };

  const result = review?.detail.flow;
  const steps = review?.detail.steps ?? preview?.steps;
  const marks =
    review && review.detail.steps
      ? withNotRun(review.detail.steps, review.detail.flow)
      : undefined;

  if (!live.flowExists) {
    return (
      <Page title={t("ai.review.noFlow")} sub={<q>{live.scenario}</q>}>
        <div className="grid gap-4">
          <AgentMessage text={live.finalMessage} />
          <div>
            <Button variant="outline" onClick={() => void end(false)}>
              {t("ai.stopped.back")}
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page
      wide
      title={t("ai.review.title")}
      sub={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-sm">{live.flow}</span>
          <span data-testid="review-status">
            {result?.status === "passed" && (
              <Status tone="passed">{t("ai.review.passed")}</Status>
            )}
            {result && result.status !== "passed" && (
              <Status tone="failed">{t("ai.review.failed")}</Status>
            )}
          </span>
        </span>
      }
      actions={
        <>
          <Button variant="destructive" onClick={() => void end(true)}>
            {t("ai.review.discard")}
          </Button>
          <Button onClick={() => void end(false)}>{t("ai.review.save")}</Button>
        </>
      }
    >
      {review?.likely && (
        <Note tone="info" className="mb-5" testId="failure-note">
          <p>{t(`ai.review.likely.${review.likely}`)}</p>
          {review.likely === "app" && (
            <p className="text-sm text-muted-foreground">
              {t("ai.review.saveAnyway")}
            </p>
          )}
        </Note>
      )}
      {live.notRestored && live.notRestored.length > 0 && (
        <Note tone="warning" className="mb-5">
          <p>
            {t("ai.review.notRestored", { files: live.notRestored.join(", ") })}
          </p>
        </Note>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-5">
          <Card className="gap-0 py-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
              <h2 className="font-semibold">{t("ai.review.content")}</h2>
              <Button variant="ghost" size="sm" onClick={() => setYaml(!yaml)}>
                {yaml ? t("ai.review.showSteps") : t("ai.review.showYaml")}
              </Button>
            </div>
            {yaml ? (
              <pre className="mx-5 mb-5 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {preview?.yaml}
              </pre>
            ) : steps ? (
              <ol className="border-t" data-testid="review-steps">
                <Steps steps={steps} marks={marks} />
              </ol>
            ) : null}
          </Card>
          {!review && flowFile && (
            <ReviewRun
              projectId={live.projectId}
              flow={flowFile}
              running={running && !finished}
              go={go}
              onStarted={() => {
                const id = liveRunId();
                void id.then(setRunId);
              }}
            />
          )}
        </div>
        <div className="grid min-w-0 gap-5">
          {result && result.status !== "passed" && (
            <Card className="gap-3 p-5" data-testid="failure-screen">
              <h2 className="font-semibold">{t("ai.review.screen")}</h2>
              {review?.detail.screenshot && (
                <img
                  src={review.detail.screenshot}
                  alt={t("ai.review.screenshot")}
                  className="max-h-96 w-auto rounded-md border"
                />
              )}
              {result.reason && <p className="text-sm">{result.reason}</p>}
              {result.screen && result.screen.length > 0 && (
                <>
                  <h3 className="text-sm font-medium">
                    {t("ai.review.texts")}
                  </h3>
                  <ul className="list-disc pl-5 text-sm">
                    {result.screen.map((element, index) => (
                      <li key={index}>
                        {element.text ?? element.description ?? element.id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
          <Report
            live={live}
            onCreateToo={(scenario) =>
              void window.jagra.ai
                .save()
                .then(() =>
                  go({ screen: "ai", projectId: live.projectId, scenario }),
                )
            }
          />
          {live.otherFlows.length > 0 && (
            <Card className="gap-3 p-5">
              <h2 className="font-semibold">{t("ai.review.otherFlows")}</h2>
              <ChangeList
                changes={live.otherFlows}
                testId="other-flows"
                actions={(change) => (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewing([change.path])}
                    >
                      {t("ai.review.view")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void window.jagra.ai.undoFlow(change.path)}
                    >
                      {t("ai.warning.restore")}
                    </Button>
                  </>
                )}
              />
            </Card>
          )}
          <Card className="gap-3 p-5">
            <h2 className="font-semibold" id="ai-fix">
              {t("ai.review.fixTitle")}
            </h2>
            <textarea
              aria-labelledby="ai-fix"
              rows={3}
              maxLength={10_000}
              value={note}
              placeholder={t("ai.review.fixPlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <p className="text-xs text-muted-foreground">
              {t("ai.review.fixHint")}
            </p>
            <div>
              <Button
                variant="outline"
                disabled={running && !finished}
                onClick={() =>
                  void window.jagra.ai.fix({
                    note,
                    ...(runId ? { runId } : {}),
                  })
                }
              >
                {t("ai.review.fixSend")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
      <ChangesDialog
        kind="flow"
        paths={viewing}
        onClose={() => setViewing([])}
      />
    </Page>
  );
}

/** The run that just started, by its id. */
async function liveRunId(): Promise<string | undefined> {
  return (await window.jagra.runs.live())?.run.id;
}

/** AGT-21: runs the flow once by itself on the device used last, or asks for a device. */
function ReviewRun({
  projectId,
  flow,
  running,
  go,
  onStarted,
}: {
  projectId: string;
  flow: string;
  running: boolean;
  go: Go;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const { view, refresh } = useDevices();
  const [deviceId, setDeviceId] = useState<string>();
  const [apkReady, setApkReady] = useState(false);
  useEffect(() => {
    void window.jagra.projects.get(projectId).then((project) => {
      setDeviceId(project?.details?.device);
      setApkReady(project?.details?.apk.ok ?? false);
    });
  }, [projectId]);
  const devices = view?.devices ?? [];
  const device = devices.find((d) => d.id === deviceId) ?? devices[0];
  return (
    <Card className="gap-4 p-5" data-testid="review-run">
      <h2 className="font-semibold">{t("ai.review.runTitle")}</h2>
      {running ? (
        <p className="flex items-center gap-2 text-sm">
          <Spinner />
          {t("ai.review.running", { device: device?.name ?? "" })}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("ai.review.runLead")}
          </p>
          <DeviceField
            view={view}
            refresh={refresh}
            device={device}
            choose={(next) => {
              setDeviceId(next);
              void window.jagra.projects.chooseDevice(projectId, next);
            }}
            go={go}
          />
          <RunControls
            projectId={projectId}
            chosen={1}
            device={device}
            ready={apkReady}
            go={go}
            flows={[flow]}
            label={t("ai.review.run")}
            onStarted={onStarted}
            autoStart
          />
        </>
      )}
    </Card>
  );
}

/** AGT-16, AGT-26: the agent's report, or its raw message when there is none. */
function Report({
  live,
  onCreateToo,
}: {
  live: AiLive;
  /** AGT-26: keeps this flow and opens a new request with the scenario. */
  onCreateToo: (scenario: string) => void;
}) {
  const { t } = useTranslation();
  if (!live.report) return <AgentMessage text={live.finalMessage} />;
  const { checks, possibleBug, suggestedTests } = live.report;
  return (
    <Card className="gap-3 p-5" data-testid="agent-report">
      <h2 className="font-semibold">{t("ai.review.report")}</h2>
      <h3 className="text-sm font-medium">{t("ai.review.checks")}</h3>
      <p className="text-sm">{checks}</p>
      {possibleBug && (
        <>
          <h3 className="text-sm font-medium">{t("ai.review.possibleBug")}</h3>
          <p className="text-sm">{possibleBug}</p>
        </>
      )}
      {live.refused && live.refused.length > 0 && (
        <>
          <h3 className="text-sm font-medium">{t("ai.review.refused")}</h3>
          <ul className="list-disc pl-5 font-mono text-xs">
            {live.refused.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </>
      )}
      {suggestedTests.length > 0 && (
        <>
          <h3 className="text-sm font-medium">{t("ai.review.suggested")}</h3>
          <ul className="rounded-md border">
            {suggestedTests.map((scenario) => (
              <li
                key={scenario}
                className="flex flex-wrap items-center gap-2 border-t px-3 py-2 first:border-t-0"
              >
                <span className="min-w-0 flex-1 text-sm">{scenario}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateToo(scenario)}
                >
                  {t("ai.review.createToo")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
