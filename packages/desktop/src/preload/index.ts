import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type JagraApi, type Settings } from "../shared/api.js";

// One object with named functions, and nothing else (SEC-6). main validates every argument.
const api: JagraApi = {
  app: {
    info: () => ipcRenderer.invoke(CHANNELS.appInfo),
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (change: Settings) => ipcRenderer.invoke(CHANNELS.settingsSet, change),
  },
};

contextBridge.exposeInMainWorld("jagra", api);
