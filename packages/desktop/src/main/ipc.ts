import { z } from "zod";
import { CHANNELS, type AppInfo, type SettingsView } from "../shared/api.js";
import { settingsSchema, type SettingsFile } from "./settings.js";

/** What main does for each preload function. */
export interface Handlers {
  appInfo(): AppInfo;
  settings: SettingsFile;
}

/** The part of `ipcMain` the handlers need, so tests can pass a fake. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { senderFrame: { url: string } | null },
      ...args: unknown[]
    ) => unknown,
  ): void;
}

/** Raised for a call main refuses. The renderer sees only that it failed (SEC-6). */
export class RejectedCallError extends Error {}

/**
 * Registers every channel of the preload API. Each call is checked twice: it must come from the
 * app's own page, and its arguments must match the schema (SEC-6).
 */
export function registerIpc(
  ipc: IpcMainLike,
  handlers: Handlers,
  isOwnPage: (url: string) => boolean,
): void {
  const on = <T extends z.ZodType>(
    channel: string,
    schema: T,
    run: (args: z.infer<T>) => unknown,
  ) => {
    ipc.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isOwnPage(event.senderFrame.url)) {
        throw new RejectedCallError(`${channel}: not from the app's own page`);
      }
      const parsed = schema.safeParse(args);
      if (!parsed.success)
        throw new RejectedCallError(`${channel}: invalid arguments`);
      return run(parsed.data);
    });
  };

  on(CHANNELS.appInfo, z.tuple([]), () => handlers.appInfo());
  on(CHANNELS.settingsGet, z.tuple([]), (): Promise<SettingsView> =>
    handlers.settings.view(),
  );
  on(CHANNELS.settingsSet, z.tuple([settingsSchema]), ([change]) =>
    handlers.settings.update(change),
  );
}
