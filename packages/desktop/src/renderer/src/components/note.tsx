import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Alert } from "./ui/alert";

type NoteTone = "info" | "warning" | "failed";

const MARK: Record<NoteTone, string> = { info: "i", warning: "!", failed: "✕" };
const COLOR: Record<NoteTone, string> = {
  info: "text-secondary dark:text-foreground",
  warning: "text-warning",
  failed: "text-destructive",
};

/**
 * A short message inside a form or a panel, with a mark and muted background (mockup `.note`).
 * Only warnings and failures are announced; an information note is read in place.
 */
export function Note({
  tone,
  children,
  className,
  testId,
}: {
  tone: NoteTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Alert
      role={tone === "info" ? "note" : "alert"}
      data-testid={testId}
      className={cn("flex gap-2.5 bg-muted text-foreground", className)}
    >
      <span aria-hidden="true" className={cn("status-mark", COLOR[tone])}>
        {MARK[tone]}
      </span>
      <div className="grid min-w-0 gap-1.5">{children}</div>
    </Alert>
  );
}
