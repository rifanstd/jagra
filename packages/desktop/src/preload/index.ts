import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ToolStatus } from "@jagra/core/types";
import {
  CHANNELS,
  EVENTS,
  type DevicesView,
  type JagraApi,
  type NewProject,
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
  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.projectsGet, id),
    pickFolder: () => ipcRenderer.invoke(CHANNELS.projectsPickFolder),
    pickApk: () => ipcRenderer.invoke(CHANNELS.projectsPickApk),
    pickMockoon: () => ipcRenderer.invoke(CHANNELS.projectsPickMockoon),
    create: (project: NewProject) =>
      ipcRenderer.invoke(CHANNELS.projectsCreate, project),
    remove: (id: string) => ipcRenderer.invoke(CHANNELS.projectsRemove, id),
    locate: (id: string) => ipcRenderer.invoke(CHANNELS.projectsLocate, id),
    openConfig: (id: string) =>
      ipcRenderer.invoke(CHANNELS.projectsOpenConfig, id),
    sampleFolder: () => ipcRenderer.invoke(CHANNELS.projectsSampleFolder),
    trySample: () => ipcRenderer.invoke(CHANNELS.projectsTrySample),
    apk: (id: string) => ipcRenderer.invoke(CHANNELS.projectsApk, id),
    chooseFlows: (id: string, files: string[]) =>
      ipcRenderer.invoke(CHANNELS.projectsChooseFlows, id, files),
    chooseDevice: (id: string, deviceId: string) =>
      ipcRenderer.invoke(CHANNELS.projectsChooseDevice, id, deviceId),
    changeApk: (id: string, to: "file" | "newest") =>
      ipcRenderer.invoke(CHANNELS.projectsChangeApk, id, to),
    openFlow: (id: string, file: string) =>
      ipcRenderer.invoke(CHANNELS.projectsOpenFlow, id, file),
  },
  devices: {
    watch: () => ipcRenderer.invoke(CHANNELS.devicesWatch),
    refresh: () => ipcRenderer.invoke(CHANNELS.devicesRefresh),
    onChange: (listener) => listen<DevicesView>(EVENTS.devicesChange, listener),
  },
  environment: {
    check: () => ipcRenderer.invoke(CHANNELS.environmentCheck),
    onProgress: (listener) =>
      listen<ToolStatus>(EVENTS.environmentProgress, listener),
  },
};

contextBridge.exposeInMainWorld("jagra", api);
