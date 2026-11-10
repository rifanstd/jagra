#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  AdbDeviceBridge,
  AdbkitApkReader,
  ActiveProcessFile,
  activeProcessesFile,
  appDataFolder,
  checkEnvironment,
  EnvSecretStore,
  isProcessAlive,
  MaestroFlowRunner,
  NodeProcessRunner,
  NodeToolProbe,
  SystemClock,
  type ToolName,
  type ToolStatus,
} from "@jagra/core";
import { main } from "./main.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};
const appData = appDataFolder();
const runner = new NodeProcessRunner({
  store: new ActiveProcessFile(activeProcessesFile(appData)),
});
const clock = new SystemClock();
const pathOf = (tools: ToolStatus[], name: ToolName) =>
  tools.find((t) => t.tool === name)?.path;

// Ctrl+C cancels the run the same way Cancel does (RUN-9). A second one quits at once.
const cancel = new AbortController();
process.on("SIGINT", () => {
  if (cancel.signal.aborted) process.exit(2);
  console.log("Cancelling...");
  cancel.abort();
});

process.exitCode = await main(
  process.argv.slice(2),
  {
    cwd: process.cwd(),
    appData,
    clock,
    secrets: new EnvSecretStore(),
    apkReader: new AdbkitApkReader(),
    checkTools: (tools) =>
      checkEnvironment(new NodeToolProbe({ runner }), { tools }),
    bridge: (tools) =>
      new AdbDeviceBridge({
        runner,
        clock,
        adb: pathOf(tools, "adb") ?? "adb",
        emulator: pathOf(tools, "emulator"),
      }),
    flowRunner: (tools) =>
      new MaestroFlowRunner({
        runner,
        clock,
        maestro: pathOf(tools, "maestro") ?? "maestro",
      }),
    isAlive: isProcessAlive,
    out: (line) => console.log(line),
    signal: cancel.signal,
  },
  version,
);
