import { useEffect, useState } from "react";
import type { LiveRun } from "../../shared/api";

/** The run in progress, or the one that just ended, kept current (RUN-8, DEV-8). */
export function useLiveRun(): LiveRun | undefined {
  const [live, setLive] = useState<LiveRun>();
  useEffect(() => {
    let open = true;
    const stop = window.jagra.runs.onUpdate((next) => setLive(next));
    void window.jagra.runs.live().then((first) => {
      if (open && first) setLive((known) => known ?? first);
    });
    return () => {
      open = false;
      stop();
    };
  }, []);
  return live;
}
