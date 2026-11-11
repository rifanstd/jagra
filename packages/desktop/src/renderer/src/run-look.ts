import type { LastRun } from "../../shared/api";
import type { Tone } from "./components/status";

/** How a run's result looks in lists (RUN-12, design/system/README.md): its tone and its words. */
export function runLook(run: LastRun): {
  tone: Tone;
  label: string;
  values?: Record<string, number>;
} {
  switch (run.status) {
    case "running":
      return { tone: "running", label: "run.status.running" };
    case "cancelled":
      return { tone: "cancelled", label: "run.status.cancelled" };
    case "stopped":
      return { tone: "stopped", label: "run.status.stopped" };
    case "interrupted":
      return { tone: "interrupted", label: "run.status.interrupted" };
    case "completed":
      return run.failed > 0
        ? {
            tone: "failed",
            label: "run.summary.someFailed",
            values: { passed: run.passed, failed: run.failed },
          }
        : {
            tone: "passed",
            label: "run.summary.allPassed",
            values: { passed: run.passed },
          };
  }
}
