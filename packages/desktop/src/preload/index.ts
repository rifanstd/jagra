import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ToolStatus } from "@jagra/core/types";
import {
  CHANNELS,
  EVENTS,
  type JagraApi,
  type Settings,
} from "../shared/api.js";

/** Listens to one of main's events. Only the data is passed on, never the event object. */
function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// One object with named functions, and nothing else (SEC-6). main validates every argument.
const api: JagraApi = {
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo),
    openLink: (url: string) => ipcRenderer.invoke(CHANNELS.appOpenLink, url),
    copyText: (text: string) => ipcRenderer.invoke(CHANNELS.appCopyText, text),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (change: Settings) => ipcRenderer.invoke(CHANNELS.settingsSet, change),
  },
  environment: {
    check: () => ipcRenderer.invoke(CHANNELS.environmentCheck),
    onProgress: (listener) =>
      listen<ToolStatus>(EVENTS.environmentProgress, listener),
  },
};

contextBridge.exposeInMainWorld("jagra", api);
