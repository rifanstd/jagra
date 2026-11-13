import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ToolStatus } from "@jagra/core/types";
import {
  CHANNELS,
  EVENTS,
  type DevicesView,
  type JagraApi,
  type LiveRun,
  type NewProject,
  type Settings,
  type StartRun,
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
    copyBugInfo: () => ipcRenderer.invoke(CHANNELS.appCopyBugInfo),
    openLink: (url: string) => ipcRenderer.invoke(CHANNELS.appOpenLink, url),
    copyText: (text: string) => ipcRenderer.invoke(CHANNELS.appCopyText, text),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (change: Settings) => ipcRenderer.invoke(CHANNELS.settingsSet, change),
    pickToolPath: (tool) =>
      ipcRenderer.invoke(CHANNELS.settingsPickToolPath, tool),
    resetToolPath: (tool) =>
      ipcRenderer.invoke(CHANNELS.settingsResetToolPath, tool),
    pickEditor: () => ipcRenderer.invoke(CHANNELS.settingsPickEditor),
    resetEditor: () => ipcRenderer.invoke(CHANNELS.settingsResetEditor),
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
  runs: {
    start: (request: StartRun) =>
      ipcRenderer.invoke(CHANNELS.runsStart, request),
    cancel: () => ipcRenderer.invoke(CHANNELS.runsCancel),
    answerUninstall: (uninstall: boolean) =>
      ipcRenderer.invoke(CHANNELS.runsAnswerUninstall, uninstall),
    live: () => ipcRenderer.invoke(CHANNELS.runsLive),
    onUpdate: (listener) => listen<LiveRun>(EVENTS.runsUpdate, listener),
    result: (projectId: string, runId: string) =>
      ipcRenderer.invoke(CHANNELS.runsResult, projectId, runId),
    openReport: (projectId: string, runId: string) =>
      ipcRenderer.invoke(CHANNELS.runsOpenReport, projectId, runId),
    flowDetail: (projectId: string, runId: string, index: number) =>
      ipcRenderer.invoke(CHANNELS.runsFlowDetail, projectId, runId, index),
    history: (projectId: string) =>
      ipcRenderer.invoke(CHANNELS.runsHistory, projectId),
  },
  secrets: {
    set: (projectId: string, name: string, value: string) =>
      ipcRenderer.invoke(CHANNELS.secretsSet, projectId, name, value),
    list: (projectId: string) =>
      ipcRenderer.invoke(CHANNELS.secretsList, projectId),
    remove: (projectId: string, name: string) =>
      ipcRenderer.invoke(CHANNELS.secretsRemove, projectId, name),
  },
  environment: {
    check: () => ipcRenderer.invoke(CHANNELS.environmentCheck),
    onProgress: (listener) =>
      listen<ToolStatus>(EVENTS.environmentProgress, listener),
  },
};

contextBridge.exposeInMainWorld("jagra", api);
