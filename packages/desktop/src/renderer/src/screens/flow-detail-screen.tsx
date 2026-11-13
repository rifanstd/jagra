import type { StepMark } from "@jagra/core/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FlowDetail, StepView } from "../../../shared/api";
import { Note } from "../components/note";
import { Status, type Tone } from "../components/status";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { formatDuration } from "../format";
import type { Go } from "../navigation";
import { stepText } from "../steps";
import { failureLine } from "./results-screen";
import { FLOW_TONE } from "./running-screen";

const MARK_TONE: Record<StepMark["mark"], Tone> = {
  passed: "passed",
  failed: "failed",
  "not-run": "not-run",
};

/** Screen 7: a flow of a run, step by step, with what was on screen when it failed (RES-4, RES-5). */
export function FlowDetailScreen({
  projectId,
  runId,
  index,
  go,
}: {
  projectId: string;
  runId: string;
  index: number;
  go: Go;
}) {
  const { t, i18n } = useTranslation();
  const [detail, setDetail] = useState<FlowDetail | null>();

  useEffect(() => {
    void window.jagra.runs
      .flowDetail(projectId, runId, index)
      .then((found) => setDetail(found ?? null));
  }, [projectId, runId, index]);

  if (detail === undefined) return <main className="flex-1" />;
  if (detail === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
        <p>{t("flowDetail.notFound")}</p>
      </main>
    );
  }

  const { flow } = detail;
  const failed = flow.status === "failed";
  const crashed =
    flow.failure === "app-crashed" || flow.failure === "app-not-responding";
  const total = detail.steps?.length;
  const where =
    failed &&
    flow.failure === "step" &&
    flow.failedStep?.[0] !== undefined &&
    total
      ? t("flowDetail.atStep", { step: flow.failedStep[0] + 1, total })
      : flow.failure === "app-crashed"
        ? t("flowDetail.becauseCrash")
        : flow.failure === "app-not-responding"
          ? t("flowDetail.becauseAnr")
          : undefined;
  const duration =
    flow.durationMs === undefined
      ? undefined
      : formatDuration(flow.durationMs, i18n.language, t);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <nav
        className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        aria-label={t("nav.label")}
      >
        <Crumb onClick={() => go({ screen: "project", id: projectId })}>
          {detail.projectName}
        </Crumb>
        <span aria-hidden="true">/</span>
        <Crumb onClick={() => go({ screen: "results", projectId, runId })}>
          {t("flowDetail.crumbResults")}
        </Crumb>
        <span aria-hidden="true">/</span>
        <span className="font-mono text-foreground" aria-current="page">
          {detail.file}
        </span>
      </nav>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold">{flow.name}</h1>
          <p
            className="mt-1 flex flex-wrap items-center gap-x-2 text-muted-foreground"
            data-testid="detail-status"
          >
            <Status tone={FLOW_TONE[flow.status]}>
              {t(`run.flowStatus.${flow.status}`)}
            </Status>
            {[where, duration].filter(Boolean).join(" · ")}
            <span className="font-mono text-sm">· {detail.file}</span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            void window.jagra.projects.openFlow(projectId, detail.file)
          }
        >
          {t("flowDetail.openInEditor")}
        </Button>
      </div>

      {failed && !crashed && (
        <Note tone="failed" className="mb-5" testId="failure-note">
          <p>{failureLine(flow, t)}</p>
          {flow.detail && (
            <details>
              <summary className="cursor-pointer text-sm">
                {t("flowDetail.showDetails")}
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-card p-3 font-mono text-xs whitespace-pre-wrap">
                {flow.detail}
              </pre>
            </details>
          )}
        </Note>
      )}
      {crashed && (
        <Note tone="failed" className="mb-5" testId="failure-note">
          <p>
            {t(
              flow.failure === "app-crashed"
                ? "flowDetail.crashNote"
                : "flowDetail.anrNote",
            )}
          </p>
        </Note>
      )}
      {detail.steps && detail.changed && (
        <Note tone="info" className="mb-5">
          <p>{t("flowDetail.changed")}</p>
        </Note>
      )}

      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="min-w-0 gap-0 py-0">
          <h2 className="px-5 pt-4 pb-3 font-semibold">
            {t("flowDetail.steps")}
          </h2>
          {detail.steps ? (
            <ol data-testid="steps">
              <Steps steps={detail.steps} marks={flow.steps} />
            </ol>
          ) : (
            <p className="px-5 pb-4 text-sm text-muted-foreground">
              {t("flowDetail.missing")}
            </p>
          )}
        </Card>
        {failed && (
          <div className="grid min-w-0 gap-5">
            <Card className="gap-0 py-0">
              <h2 className="px-5 pt-4 pb-3 font-semibold">
                {t("flowDetail.screenTitle")}
              </h2>
              <div className="grid gap-4 px-5 pb-5">
                {detail.screenshot ? (
                  <img
                    src={detail.screenshot}
                    alt={t("flowDetail.screenshotAlt")}
                    className="max-h-[32rem] w-auto justify-self-center rounded-md border"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("flowDetail.noScreenshot")}
                  </p>
                )}
                {flow.blackScreenshot && (
                  <Note tone="warning" testId="black-screenshot">
                    <p>{t("flowDetail.black")}</p>
                    <p className="text-muted-foreground">
                      {t("flowDetail.blackFix")}
                    </p>
                  </Note>
                )}
                {flow.screen && flow.screen.length > 0 && (
                  <div className="grid gap-1.5">
                    <h3 className="text-sm font-medium">
                      {t("flowDetail.screenText")}
                    </h3>
                    <ul
                      className="grid gap-1 text-sm"
                      data-testid="screen-text"
                    >
                      {flow.screen.map((element, i) => (
                        <li key={i} className="truncate">
                          {element.text ?? element.description ?? element.id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
            {detail.crashReport && <CrashReport text={detail.crashReport} />}
          </div>
        )}
      </div>
    </main>
  );
}

function Crumb({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className="rounded-sm hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Each step with its mark; a step that runs other steps opens to show them (RES-4). */
function Steps({
  steps,
  marks,
  depth = 0,
}: {
  steps: StepView[];
  marks?: StepMark[];
  depth?: number;
}) {
  const { t } = useTranslation();
  return steps.map((step, i) => {
    const mark = marks?.[i];
    const text = stepText(step, t);
    const line = (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {mark ? (
          <Status tone={MARK_TONE[mark.mark]} className="font-normal">
            <span className="sr-only">{t(`flowDetail.mark.${mark.mark}`)}</span>
          </Status>
        ) : (
          <span className="w-[1.1em]" aria-hidden="true" />
        )}
        <span className={mark?.mark === "failed" ? "font-medium" : undefined}>
          {text}
        </span>
      </span>
    );
    return (
      <li
        key={`${depth}-${i}`}
        className="border-t px-5 py-2 text-sm first:border-t-0 data-[failed=true]:bg-muted"
        data-failed={mark?.mark === "failed"}
      >
        {step.steps && step.steps.length > 0 ? (
          <details open={mark?.mark === "failed"}>
            <summary className="flex cursor-pointer items-center">
              {line}
            </summary>
            <ol className="mt-2 ml-6 rounded-md border">
              <Steps steps={step.steps} marks={mark?.steps} depth={depth + 1} />
            </ol>
          </details>
        ) : (
          line
        )}
      </li>
    );
  });
}

function CrashReport({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Card className="gap-0 py-0" data-testid="crash-report">
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="font-semibold">{t("flowDetail.crashTitle")}</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void window.jagra.app.copyText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          <span aria-live="polite">
            {copied ? t("flowDetail.copied") : t("flowDetail.copyReport")}
          </span>
        </Button>
      </div>
      <pre className="mx-5 mb-5 max-h-96 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre">
        {text}
      </pre>
    </Card>
  );
}
