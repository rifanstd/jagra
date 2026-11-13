import type { FlowResult } from "@jagra/core/types";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { LiveRun, PrepStep } from "../../../shared/api";
import { Note } from "../components/note";
import { Status, type Tone } from "../components/status";
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
import { Progress } from "../components/ui/progress";
import { describeError } from "../errors";
import { formatDuration } from "../format";
import type { Go } from "../navigation";
import { fileName } from "../paths";
import { useLiveRun } from "../use-live-run";

/** A flow's status as the design system shows it (design/system/README.md). */
export const FLOW_TONE: Record<FlowResult["status"], Tone> = {
  waiting: "waiting",
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "cancelled",
  "not-run": "not-run",
};

/** Screen 5: the run in progress, with Cancel always there (RUN-8, RUN-9, DEV-4). */
export function RunningScreen({ go }: { go: Go }) {
  const { t } = useTranslation();
  const live = useLiveRun();

  // The Results screen takes over once the run has ended (spec section 7, step 6).
  useEffect(() => {
    if (live?.finished && !live.error) {
      go({ screen: "results", projectId: live.projectId, runId: live.run.id });
    }
  }, [live, go]);

  if (!live) return <main className="flex-1" />;
  if (live.error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
        <Note tone="failed">
          <p>{describeError(live.error, t)}</p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => go({ screen: "project", id: live.projectId })}
            >
              {t("results.backToProject")}
            </Button>
          </div>
        </Note>
      </main>
    );
  }

  const { run } = live;
  const total = run.flows.length;
  const done = run.flows.filter(
    (f) => f.status !== "waiting" && f.status !== "running",
  ).length;
  const current = run.flows.findIndex((f) => f.status === "running");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-semibold" data-testid="running-title">
            {title(live, current, total, t)}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t("running.sub", {
              device: run.device.name,
              apk: fileName(run.apk.file),
              version: run.apk.versionName,
              code: run.apk.versionCode,
            })}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={live.cancelling}
          onClick={() => void window.jagra.runs.cancel()}
        >
          {live.cancelling ? t("running.cancelling") : t("running.cancel")}
        </Button>
      </div>
      <Progress
        value={total === 0 ? 0 : (done / total) * 100}
        aria-label={t("running.flowOf", { current: done, total })}
      />

      <Card className="mt-5 gap-0 py-0">
        <ul>
          <PrepRow label={t("running.deviceLabel")} step={live.device}>
            {live.device === "done"
              ? t("running.deviceReady", { name: run.device.name })
              : live.startingEmulator
                ? t("running.deviceBooting")
                : t("running.deviceChecking")}
          </PrepRow>
          <PrepRow
            label={t("running.apkLabel")}
            step={live.install}
            asking={live.askUninstall}
          >
            {live.askUninstall
              ? t("running.waitingAnswer")
              : live.install === "done"
                ? t("running.installed")
                : live.install === "working"
                  ? t("running.installingShort")
                  : t("run.flowStatus.waiting")}
          </PrepRow>
          {live.mockoon !== "skipped" && (
            <PrepRow label={t("running.mockoonLabel")} step={live.mockoon}>
              {live.mockoon === "done"
                ? t("running.mockoonRunning", { port: live.mockoonPort })
                : live.mockoon === "working"
                  ? t("running.mockoonStarting", { port: live.mockoonPort })
                  : t("run.flowStatus.waiting")}
            </PrepRow>
          )}
        </ul>
      </Card>
      {live.startingEmulator && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("running.emulatorNote")}
        </p>
      )}
      {live.oldAndroid && (
        <Note tone="warning" className="mt-3">
          <p>{t("running.oldAndroid", { version: live.oldAndroid })}</p>
        </Note>
      )}

      <Card className="mt-5 gap-0 py-0">
        <ul>
          {run.flows.map((flow, index) => (
            <FlowRow
              key={flow.file}
              flow={flow}
              step={index === current ? live.step : undefined}
            />
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("running.footer")}
      </p>

      <Dialog open={live.askUninstall}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("running.uninstall.title")}</DialogTitle>
            <DialogDescription>
              {t("running.uninstall.text", {
                packageName: run.apk.packageName,
                device: run.device.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <Note tone="warning">
            <p>{t("running.uninstall.warning")}</p>
          </Note>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void window.jagra.runs.cancel()}
            >
              {t("running.uninstall.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void window.jagra.runs.answerUninstall(true)}
            >
              {t("running.uninstall.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function title(
  live: LiveRun,
  current: number,
  total: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (live.cancelling) return t("running.cancelling");
  if (current >= 0) return t("running.flowOf", { current: current + 1, total });
  if (live.startingEmulator) return t("running.startingEmulator");
  if (live.device !== "done") return t("running.preparing");
  if (live.install !== "done") return t("running.installing");
  if (live.mockoon === "working" || live.mockoon === "waiting")
    return t("running.startingMockoon");
  return t("running.finishing");
}

function PrepRow({
  label,
  step,
  asking = false,
  children,
}: {
  label: string;
  step: PrepStep;
  asking?: boolean;
  children: string;
}) {
  const tone: Tone = asking
    ? "warning"
    : step === "done"
      ? "passed"
      : step === "working"
        ? "running"
        : "waiting";
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-2.5 first:border-t-0">
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      <Status tone={tone}>{children}</Status>
    </li>
  );
}

function FlowRow({ flow, step }: { flow: FlowResult; step?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-5 py-2.5 first:border-t-0 data-[running=true]:bg-accent data-[running=true]:text-accent-foreground"
      data-running={flow.status === "running"}
      data-testid={`run-flow-${fileName(flow.file)}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{flow.name}</span>
        {step && (
          <span className="block truncate text-sm text-muted-foreground">
            {t("running.latestStep", { step })}
          </span>
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
    </li>
  );
}
