import { useCallback, useEffect, useState } from "react";
import type { DevicesView } from "../../shared/api";

/** The device list, kept current while the page is open (DEV-1, DEV-2). */
export function useDevices(): {
  view?: DevicesView;
  refresh: () => Promise<void>;
} {
  const [view, setView] = useState<DevicesView>();

  useEffect(() => {
    let open = true;
    const stop = window.jagra.devices.onChange((next) => setView(next));
    void window.jagra.devices.watch().then((first) => {
      if (open) setView(first);
    });
    return () => {
      open = false;
      stop();
    };
  }, []);

  const refresh = useCallback(async () => {
    setView(await window.jagra.devices.refresh());
  }, []);

  return { view, refresh };
}
