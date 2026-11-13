import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RunSummary } from "../../../shared/api";
import { Status, type Tone } from "../components/status";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { formatWhen } from "../format";
import type { Go } from "../navigation";

/** Screen 10: the project's last 20 runs, newest first, including unfinished ones (RES-8, RES-9). */
export function HistoryScreen({
  projectId,
  go,
}: {
  projectId: string;
  go: Go;
}) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RunSummary[] | null>();

  useEffect(() => {
    void window.jagra.runs
      .history(projectId)
      .then((found) => setRuns(found ?? null));
  }, [projectId]);

  if (runs === undefined) return <main className="flex-1" />;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-7 pb-12 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("history.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("history.subtitle")}</p>
      </div>
      {!runs || runs.length === 0 ? (
        <Card className="gap-3 p-6">
          <h2 className="font-semibold">{t("history.emptyTitle")}</h2>
          <p className="text-muted-foreground">{t("history.emptyText")}</p>
          <div>
            <Button
              variant="outline"
              onClick={() => go({ screen: "project", id: projectId })}
            >
              {t("history.toProject")}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          <ul>
            {runs.map((run) => {
              const look = summary(run, t);
              return (
                <li key={run.id} className="border-t first:border-t-0">
                  <button
                    type="button"
                    data-testid={`history-${run.id}`}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() =>
                      go({ screen: "results", projectId, runId: run.id })
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <Status tone={look.tone} className="whitespace-normal">
                        {look.text}
                      </Status>
                      <span className="block text-sm text-muted-foreground">
                        {t("history.meta", {
                          when: formatWhen(
                            Date.parse(run.startedAt),
                            Date.now(),
                            i18n.language,
                          ),
                          device: run.device,
                        })}
                      </span>
                    </span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {t("history.version", {
                        version: run.apkVersion,
                        code: run.apkCode,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </main>
  );
}

/** One line per run, in the words of mockup 10. */
function summary(
  run: RunSummary,
  t: ReturnType<typeof useTranslation>["t"],
): { tone: Tone; text: string } {
  switch (run.status) {
    case "running":
      return { tone: "running", text: t("history.running") };
    case "interrupted":
      return {
        tone: "interrupted",
        text: t("history.interrupted", { count: run.passed + run.failed }),
      };
    case "stopped":
      return { tone: "stopped", text: t("history.stopped") };
    case "cancelled":
      return {
        tone: "cancelled",
        text: t("history.cancelled", { count: run.passed }),
      };
    case "completed":
      return run.failed > 0
        ? {
            tone: "failed",
            text: t("run.summary.someFailed", {
              passed: run.passed,
              failed: run.failed,
            }),
          }
        : {
            tone: "passed",
            text: t("run.summary.allPassed", { passed: run.passed }),
          };
  }
}
