import type { ToolName, ToolStatus } from "@jagra/core/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentView } from "../../shared/api";

export interface EnvironmentCheck {
  /** The last finished check. */
  view?: EnvironmentView;
  /** Tools already known during the current check. */
  progress: Partial<Record<ToolName, ToolStatus>>;
  checking: boolean;
  /** The last check did not finish. */
  failed: boolean;
  check: () => Promise<void>;
}

/** Runs the environment check when the app opens, and again on Check again (ENV-5, ENV-7). */
export function useEnvironment(): EnvironmentCheck {
  const [view, setView] = useState<EnvironmentView>();
  const [progress, setProgress] = useState<
    Partial<Record<ToolName, ToolStatus>>
  >({});
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    setFailed(false);
    setProgress({});
    const stop = window.jagra.environment.onProgress((status) =>
      setProgress((known) => ({ ...known, [status.tool]: status })),
    );
    try {
      setView(await window.jagra.environment.check());
    } catch {
      setFailed(true);
    } finally {
      stop();
      running.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return { view, progress, checking, failed, check };
}
