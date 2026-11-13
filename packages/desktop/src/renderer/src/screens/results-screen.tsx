import type { FlowResult, Run } from "@jagra/core/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RunResult } from "../../../shared/api";
import { RunControls } from "../components/run-controls";
import { Status, type Tone } from "../components/status";
import { TextLink } from "../components/text-link";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { describeError } from "../errors";
import { formatDuration, formatWhen } from "../format";
import type { Go } from "../navigation";
import { fileName } from "../paths";
import { useDevices } from "../use-devices";
import { FLOW_TONE } from "./running-screen";

/** Screen 6: what passed and what failed, and the way to the report (RES-2, RES-3, RES-6, RES-10). */
export function ResultsScreen({
  projectId,
  runId,
  go,
}: {
  projectId: string;
  runId: string;
  go: Go;
}) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<RunResult | null>();
  const { view } = useDevices();

  useEffect(() => {
    void window.jagra.runs
      .result(projectId, runId)
      .then((found) => setResult(found ?? null));
  }, [projectId, runId]);

  if (result === undefined) return <main className="flex-1" />;
  if (result === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
        <p>{t("results.notFound")}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => go({ screen: "project", id: projectId })}
        >
          {t("results.backToProject")}
        </Button>
      </main>
    );
  }

  const { run } = result;
  const headline = headlineOf(run, t);
  const device = view?.devices.find((d) => d.id === run.device.id);
  const files = run.flows.map((f) => fileName(f.file));
  const duration = run.endedAt
    ? Date.parse(run.endedAt) - Date.parse(run.startedAt)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-12 sm:px-6">
      <button
        type="button"
        className="mb-3 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => go({ screen: "project", id: projectId })}
      >
        {result.projectName}
      </button>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold" data-testid="results-headline">
            <Status tone={headline.tone} className="whitespace-normal">
              {headline.text}
            </Status>
          </h1>
          <p
            className="mt-1 text-muted-foreground"
            data-testid="results-counts"
          >
            {counts(run, t)}
          </p>
          {run.status === "cancelled" && (
            <p className="text-sm text-muted-foreground">
              {t("results.keptNote")}
            </p>
          )}
          {run.status === "interrupted" && (
            <p className="text-sm text-muted-foreground">
              {t("results.interruptedNote")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Button
            variant="outline"
            onClick={() => void window.jagra.runs.openReport(projectId, runId)}
          >
            {t("results.openReport")}
          </Button>
          <div>
            <RunControls
              projectId={projectId}
              chosen={files.length}
              device={device}
              ready
              go={go}
              label={t("results.runAgain")}
              // RES-10: the same flows on the same device, with the newest APK.
              beforeStart={async () => {
                await window.jagra.projects.chooseFlows(projectId, files);
                await window.jagra.projects.chooseDevice(
                  projectId,
                  run.device.id,
                );
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0 gap-0 py-0">
          <h2 className="px-5 pt-4 pb-3 font-semibold">{t("results.flows")}</h2>
          <ul>
            {run.flows.map((flow, index) => (
              <ResultRow
                key={flow.file}
                flow={flow}
                open={() => go({ screen: "flow", projectId, runId, index })}
              />
            ))}
          </ul>
        </Card>
        <Card className="min-w-0 gap-0 py-0">
          <h2 className="px-5 pt-4 pb-3 font-semibold">
            {t("results.thisRun")}
          </h2>
          <dl className="grid gap-3 px-5 pb-5 text-sm">
            <Fact label={t("results.time")}>
              {formatWhen(Date.parse(run.startedAt), Date.now(), i18n.language)}
            </Fact>
            <Fact label={t("results.duration")}>
              {duration === undefined
                ? t("results.unknown")
                : formatDuration(duration, i18n.language, t)}
            </Fact>
            <Fact label={t("results.apk")}>
              {t("results.apkValue", {
                file: fileName(run.apk.file),
                version: run.apk.versionName,
                code: run.apk.versionCode,
              })}
            </Fact>
            <Fact label={t("results.device")}>
              {run.device.androidVersion
                ? t("results.deviceValue", {
                    name: run.device.name,
                    version: run.device.androidVersion,
                  })
                : run.device.name}
            </Fact>
            <Fact label={t("results.mockoon")}>
              {result.mockoon
                ? t("results.mockoonStopped")
                : t("results.mockoonNone")}
            </Fact>
          </dl>
          <div className="border-t px-5 py-3.5 text-sm">
            <TextLink onClick={() => go({ screen: "history", projectId })}>
              {t("history.allRuns")}
            </TextLink>
          </div>
        </Card>
      </div>
    </main>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ResultRow({ flow, open }: { flow: FlowResult; open: () => void }) {
  const { t, i18n } = useTranslation();
  const why = flow.status === "failed" ? failureLine(flow, t) : undefined;
  return (
    <li className="border-t">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        data-testid={`result-${fileName(flow.file)}`}
        onClick={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{flow.name}</span>
          {why && (
            <span className="block text-sm text-muted-foreground">{why}</span>
          )}
        </span>
        {flow.durationMs !== undefined && (
          <span className="text-sm text-muted-foreground">
            {formatDuration(flow.durationMs, i18n.language, t)}
          </span>
        )}
        <Status tone={FLOW_TONE[flow.status]}>
          {t(`run.flowStatus.${flow.status}`)}
        </Status>
      </button>
    </li>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

/** RES-3: one line on why a flow failed. Maestro's own words are shown as text (SEC-7). */
export function failureLine(flow: FlowResult, t: T): string {
  if (flow.failure === "error" && flow.error)
    return describeError(flow.error, t);
  if (flow.failure === "step" && flow.failedStep?.[0] !== undefined) {
    return t("results.stepFailed", {
      step: flow.failedStep[0] + 1,
      reason: flow.reason ?? "",
    });
  }
  const kind = t(`run.failure.${flow.failure ?? "step"}`);
  return flow.reason ? `${kind}: ${flow.reason}` : kind;
}

function headlineOf(run: Run, t: T): { tone: Tone; text: string } {
  const failed = run.flows.filter((f) => f.status === "failed").length;
  switch (run.status) {
    case "running":
      return { tone: "running", text: t("results.headline.running") };
    case "completed":
      return failed > 0
        ? {
            tone: "failed",
            text: t("results.headline.failed", { count: failed }),
          }
        : { tone: "passed", text: t("results.headline.passed") };
    case "cancelled":
      return { tone: "cancelled", text: t("results.headline.cancelled") };
    case "stopped":
      return {
        tone: "stopped",
        text: run.stopReason
          ? t("results.headline.stopped", {
              reason: describeError(run.stopReason, t),
            })
          : t("run.status.stopped"),
      };
    case "interrupted":
      return { tone: "interrupted", text: t("results.headline.interrupted") };
  }
}

/** "4 passed, 1 failed of 5 flows" (RES-2). */
function counts(run: Run, t: T): string {
  const count = (status: FlowResult["status"]) =>
    run.flows.filter((f) => f.status === status).length;
  const parts = [
    ["passed", count("passed")],
    ["failed", count("failed")],
    ["cancelled", count("cancelled")],
    ["notRun", count("not-run")],
  ] as const;
  const text = parts
    .filter(([, n]) => n > 0)
    .map(([key, n]) => t(`results.count.${key}`, { count: n }))
    .join(", ");
  return t("results.ofTotal", { parts: text, total: run.flows.length });
}
