import type { ToolStatus } from "@jagra/core";
import { z } from "zod";
import {
  CHANNELS,
  EVENTS,
  type AppInfo,
  type EnvironmentView,
  type SettingsView,
} from "../shared/api.js";
import { settingsSchema, type SettingsFile } from "./settings.js";

/** What main does for each preload function. */
export interface Handlers {
  appInfo(): AppInfo;
  /** Opens a link only when `isKnownLink` allows it. */
  openLink(url: string): Promise<void>;
  isKnownLink(url: string): boolean;
  copyText(text: string): Promise<void>;
  settings: SettingsFile;
  checkEnvironment(
    onProgress: (status: ToolStatus) => void,
  ): Promise<EnvironmentView>;
}

/** The part of an IPC event the handlers use. */
export interface CallEvent {
  senderFrame: { url: string } | null;
  sender: { send(channel: string, ...args: unknown[]): void };
}

/** The part of `ipcMain` the handlers need, so tests can pass a fake. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: CallEvent, ...args: unknown[]) => unknown,
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
    run: (args: z.infer<T>, event: CallEvent) => unknown,
  ) => {
    ipc.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isOwnPage(event.senderFrame.url)) {
        throw new RejectedCallError(`${channel}: not from the app's own page`);
      }
      const parsed = schema.safeParse(args);
      if (!parsed.success)
        throw new RejectedCallError(`${channel}: invalid arguments`);
      return run(parsed.data, event);
    });
  };

  on(CHANNELS.appInfo, z.tuple([]), () => handlers.appInfo());
  on(CHANNELS.appOpenLink, z.tuple([z.string().max(2048)]), ([url]) => {
    if (!handlers.isKnownLink(url))
      throw new RejectedCallError(`${CHANNELS.appOpenLink}: unknown link`);
    return handlers.openLink(url);
  });
  on(CHANNELS.appCopyText, z.tuple([z.string().max(100_000)]), ([text]) =>
    handlers.copyText(text),
  );
  on(CHANNELS.settingsGet, z.tuple([]), (): Promise<SettingsView> =>
    handlers.settings.view(),
  );
  on(CHANNELS.settingsSet, z.tuple([settingsSchema]), ([change]) =>
    handlers.settings.update(change),
  );
  on(CHANNELS.environmentCheck, z.tuple([]), (_args, event) =>
    handlers.checkEnvironment((status) =>
      event.sender.send(EVENTS.environmentProgress, status),
    ),
  );
}
