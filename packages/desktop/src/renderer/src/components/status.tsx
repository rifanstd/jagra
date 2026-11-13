import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/** The statuses of design/system/README.md. Each has a mark, a word and a color, never color alone. */
export type Tone =
  | "passed"
  | "failed"
  | "running"
  | "waiting"
  | "warning"
  | "optional"
  | "not-run"
  | "cancelled"
  | "stopped"
  | "interrupted";

const MARK: Record<Exclude<Tone, "running">, string> = {
  passed: "✓",
  failed: "✕",
  waiting: "○",
  warning: "!",
  optional: "○",
  "not-run": "–",
  cancelled: "–",
  stopped: "!",
  interrupted: "!",
};

const COLOR: Record<Tone, string> = {
  passed: "text-success",
  failed: "text-destructive",
  running: "text-foreground",
  waiting: "text-muted-foreground",
  warning: "text-warning",
  optional: "text-muted-foreground",
  "not-run": "text-muted-foreground",
  cancelled: "text-warning",
  stopped: "text-warning",
  interrupted: "text-warning",
};

/** A turning mark, so a long check never looks frozen. It stands still under reduced motion. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-current motion-reduce:animate-none motion-reduce:border-r-current",
        className,
      )}
    />
  );
}

export function Status({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium whitespace-nowrap",
        COLOR[tone],
        className,
      )}
    >
      {tone === "running" ? (
        <Spinner />
      ) : (
        <span aria-hidden="true" className="status-mark">
          {MARK[tone]}
        </span>
      )}
      {children}
    </span>
  );
}
