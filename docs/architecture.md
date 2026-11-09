# Jagra architecture

This document describes how Jagra is put together: the repository layout, the packages and the rules between them, the modules inside the core, where data lives, and how the desktop app is split for security.

`spec-v1.md` says what Jagra does. This file says how the code is organised to do it. Tools and libraries marked "proposed" must be confirmed during implementation and the choice recorded in `decisions.md`.

---

## 1. Repository layout

Jagra is a monorepo managed with pnpm workspaces.

```
jagra/
  packages/
    core/          all of Jagra's work, plain TypeScript, no Electron, no React
    cli/           the `jagra` command, a thin layer over core
    desktop/       the Electron app
      src/main/      main process: hosts core, IPC handlers, updates, secrets
      src/preload/   the narrow bridge between main and renderer
      src/renderer/  the interface: React, Tailwind, shadcn/ui
  sample-app/      Android sample app (Kotlin, Gradle, built separately)
  scripts/         repository scripts, such as the sample app's theme generator (D-38)
  design/
    system/        theme.css (single source of the theme) and its README
    fonts/         Outfit and Fira Code with their licenses, bundled by the apps (D-39)
    screens/       mockups, one HTML file per screen
    wireframes.html
  docs/            product, spec, architecture, decisions, plan, tests, release
  CLAUDE.md
```

### Dependency rules

| Package | May depend on | Must never depend on |
|---|---|---|
| `core` | Node.js and plain libraries | Electron, React, anything in `cli` or `desktop` |
| `cli` | `core` | Electron, React, `desktop` |
| `desktop` | `core`, Electron, React and UI libraries, `design/system/theme.css` | `cli` |
| `sample-app` | Android libraries only. Its theme file and font are generated from `design/` (D-38) | Anything in `packages/` |
| `scripts` | Node.js | Anything in `packages/` |

These rules are checked by a lint rule in CI, not only by convention. A pull request that breaks them fails.

---

## 2. Inside `core`: modules, ports and adapters

Each concern in `core` is a module. Modules never call `adb`, Maestro, Mockoon or an agent directly. They call a **port**: a TypeScript interface that describes what they need ("install this APK on this device"). An **adapter** implements the port with the real program. Tests swap the real adapters for fakes (see `test-plan.md`, layer 2).

```
core/src/
  environment/   tool detection and version rules        (ENV)
  project/       config, flows, variables, file watching (PRJ, FLOW)
  devices/       device list, emulator start, install    (DEV)
  mockoon/       start, readiness, port check, stop      (MCK)
  runner/        the run itself, cancel, timeouts        (RUN)
  results/       saving, history, report index, masking  (RES)
  agents/        agent connections, instructions,        (AGT)
                 sessions, report parsing, safety net
  process/       starting and stopping external programs (SEC-8, REL-2, REL-3)
  log/           logging with secret masking             (REL-7)
  errors/        error codes                             (REL-5)
  ports/         every port interface in one place
  adapters/      real implementations of the ports
```

### Ports

| Port | What it does | Real adapter |
|---|---|---|
| `ProcessRunner` | Start a program with an argument list (never a shell string), stream its output, stop it and its children, record what is running | Node `child_process` with `shell: false`. On Windows only `.exe` and `.com`, found on `PATH` only (D-31). Stopping uses `taskkill /T /F` on Windows and the process group on macOS |
| `ToolProbe` | Find a tool and read its version, returning what it saw (`ToolFinding`) | `ProcessRunner` calls such as `java -version`. Maestro and Mockoon CLI through Java and Node on Windows (D-34). Search order and the Windows registry read in D-37 |
| `DeviceBridge` | List devices and emulators, start an emulator, wait for boot, install and uninstall, clear app data, add and remove `adb reverse`, read the Android version | `adb` and the SDK `emulator` binary |
| `ApkReader` | Read package name, version name and version code from an APK | A library that parses APK files (proposed, see `to-verify.md`) |
| `MockServer` | Start Mockoon CLI with a file and port, wait until ready, stop | `mockoon-cli` |
| `PortChecker` | Tell whether a local port is free | Node `net` |
| `FlowRunner` | Run one flow on one device with variables, a time limit, an output folder and a cancel signal, and return the result | `maestro test` |
| `ScreenInspector` | Capture the texts and elements on screen right after a failure | Maestro's hierarchy command |
| `AgentClient` | Start a session, send a request, continue a session, cancel | Two adapters: `CliAgent` (Claude Code, Codex, custom commands) and `AcpAgent` (ACP agents, using the official ACP TypeScript SDK) |
| `SecretStore` | Read and write secret values per project | Desktop: OS credential store. CLI: `JAGRA_SECRET_<NAME>` environment variables |
| `FileWatcher` | Report changes in `.jagra/flows` | A file watching library (proposed) |
| `Clock` | Time, for durations and timeouts | System clock (a fake clock in tests) |

`SecretStore` and the update check are the only places where the desktop app and the CLI behave differently, and both sit behind a port, so `core` stays the same for both.

### Errors

`core` never produces sentences for the interface. Every error is a code with parameters, for example `{ code: "TOOL_MISSING", tool: "maestro" }`. The renderer turns codes into text in the user's language (`LNG-1`), with a "Show details" part holding the technical output. The CLI turns the same codes into English text.

### Events

Long work (environment check, runs, agent requests) reports progress through typed events, for example `flow-started`, `flow-step`, `flow-finished`, `run-finished`. The desktop main process forwards them to the renderer. The CLI prints them.

### Cancellation

Every long operation takes an `AbortSignal`. Cancel in the interface, Ctrl+C in the CLI and the per-flow time limit all go through the same signal, so stopping always follows one path (`RUN-9`).

---

## 3. Data model

These are the main shapes shared by all packages. Exact fields are decided in code, in `core/src/types`.

| Type | Main fields |
|---|---|
| `ProjectConfig` | `format`, `name`, `appId`, `apk.searchPath`, `mockoon.file`, `mockoon.port`, `run.flowTimeoutMinutes` |
| `Project` | `id` (local, random), `folder`, `config`, local settings |
| `Flow` | `file`, `name`, `isHelper`, `steps`, `variables`, `properties`, parse problems |
| `Step` | `kind` (`action` or `check`), the Maestro command, its arguments as written, its line, nested steps. The renderer and the CLI write the plain language text (D-32) |
| `ToolStatus` | `tool`, `state` (Ready, Untested version, Too old, Missing, Can't start), `required`, `version`, `path`, `problem` (needs Java, needs Node, timed out, failed) (D-35) |
| `Device` | `id`, `kind` (emulator or phone), `state`, `name`, `androidVersion` |
| `Run` | `id`, `projectId`, `status`, start and end time, APK info, device, flow results |
| `FlowResult` | `flow`, `status`, `duration`, failed step index, reason code, paths to screenshot, screen contents, crash report and Maestro report |
| `AgentSession` | `id`, `agent`, `flowFile`, history used when the agent cannot continue a session |

### `config.yaml` schema

The schema is defined once with a validation library (proposed: zod) and used to read, check and explain errors in `config.yaml`. Every field except `format` has a default. Rules:

- `format` is required. Version 1 accepts only `1` (`PRJ-9`).
- `name` defaults to the project folder name.
- `appId` may be empty until the first APK is read (`PRJ-6`).
- `apk.searchPath` defaults to `app/build/outputs/apk/debug`.
- `mockoon` is optional. When present, `file` is required and `port` is optional.
- `run.flowTimeoutMinutes` defaults to 5.
- Unknown fields are kept and ignored, so a newer Jagra can add fields without breaking an older one.

---

## 4. Local data

Local data lives in the operating system's app data folder. The desktop app and the CLI use the same folder:

- Windows: `%LOCALAPPDATA%\jagra`. The local profile, not the roaming one, because runs and logs are large and tied to this machine.
- macOS: `~/Library/Application Support/jagra`.
- Linux, used only for CI so far: `$XDG_CONFIG_HOME/jagra`, or `~/.config/jagra`.

```
<app data>/jagra/
  settings.json            language, chosen agent, editor command, tool paths
  projects.json            known projects: id and folder path
  projects/<project id>/
    local.json             hand-picked APK, last device, chosen flows, AI notice accepted
    sessions/              agent sessions in progress
    runs/<run id>/
      run.json             the Run record
      index.html           report index (RES-6)
      flows/<flow>/        Maestro output, screenshots, screen contents, crash report, Maestro report
  secrets/                 encrypted secret values (desktop only)
  backups/<session id>/    safety net copies (AGT-19)
  state/active.json        processes and adb reverse rules Jagra started (REL-2)
  logs/                    technical logs: jagra.log, jagra.1.log, jagra.2.log, 5 MB each (REL-7)
```

The project id is created by Jagra and kept only in `projects.json`. It is never written to `config.yaml`, so teammates do not share ids and Locate (`PRJ-8`) only has to update one path.

### Secrets in the desktop app

The desktop app encrypts secret values with Electron's `safeStorage`, which uses the operating system's credential store for its key (Keychain on macOS, the user's protected key store on Windows), and keeps the encrypted values in `secrets/`. Nothing is stored in plain text (`SEC-3`). Confirm the exact behaviour on both systems (see `to-verify.md`).

---

## 5. A run, step by step

What happens inside `core` when Run is pressed (spec section 7):

1. `runner` asks `environment` to check the tools this run needs, `project` for the APK and its package, the chosen flows and the variables they use, `SecretStore` for those variables, and `PortChecker` for the Mockoon port. Any problem ends here with an error code.
2. `devices` starts the emulator if needed and waits for boot.
3. `devices` installs the APK. On a signature mismatch, the run pauses and asks the user (`RUN-3`).
4. `mockoon` starts Mockoon and waits for the port; `devices` adds `adb reverse`. Both are written to `state/active.json`.
5. For each flow: `devices` clears app data; `FlowRunner` runs `maestro test` for that one file, with the device, the variables, the time limit and an output folder under the run; on failure `ScreenInspector` captures the screen; `results` saves the flow result straight away.
6. `mockoon` stops, `devices` removes `adb reverse`, `state/active.json` is cleared, `results` writes the report index and applies history retention.

Cancel, a timeout or a lost device all abort through the same `AbortSignal`, and step 6 always runs.

---

## 6. An agent request, step by step

What happens inside `core` when the user asks an agent for a flow (spec section 10):

1. `agents` builds the instructions from the built-in template, `.jagra/agent-rules.md` and the request.
2. The safety net records the state of the project folder (below).
3. `AgentClient` starts or continues the session. For ACP agents, every permission request is answered by `agents`: writes inside `.jagra/flows` are allowed, everything else is refused.
4. When the agent stops, the safety net compares and reports changes outside `.jagra/flows`, and separately any change to flows other than the requested one.
5. `agents` parses the agent's JSON report.
6. `runner` runs the new flow once, using the normal run path with one flow.
7. The Review flow screen gets the flow's steps, the run result, the failure note (`AGT-24`), the screen contents and the agent's report.

### Safety net

The safety net must restore files exactly as they were right before the agent started, without undoing the user's own earlier changes. The approach depends on whether the project folder is a git repository.

**Git repository.** Before the agent starts, Jagra records the current commit and the list of changed and untracked files, and copies those changed and untracked files into `backups/<session id>/`. Afterwards it lists every file that now differs from that record. To restore: a file that was clean before is restored from the recorded commit; a file that was changed or untracked before is restored from the backup copy; a file that did not exist before is deleted.

**Not a git repository.** Before the agent starts, Jagra hashes every file and copies them into the backup, skipping the folders listed below. If the copy would be larger than a set limit, Jagra tells the user before starting that Restore will not be available for this request, and View changes will only list files.

**Skipped folders** in both cases: `.git`, `.gradle`, `build`, `node_modules`, `.idea`, and `.jagra/flows` (handled separately).

Backups are deleted when the session ends.

---

## 7. The desktop app

```
desktop/src/
  main/       creates the window, hosts core, handles IPC, updates, secrets
  preload/    exposes a small named API with contextBridge
  renderer/   React interface
```

### Security settings

Every window is created with context isolation on, Node integration off and the sandbox on (`SEC-6`). No window loads remote content. The renderer has no access to Node, the file system or `child_process`.

### The preload API

The preload script exposes one object with named functions, grouped by area. The renderer can call nothing else.

| Group | Functions (indicative) |
|---|---|
| `environment` | `check`, `onProgress` |
| `projects` | `list`, `create`, `locate`, `remove`, `get` |
| `devices` | `list`, `onChange` |
| `runs` | `start`, `cancel`, `onEvent`, `listRuns`, `getRun`, `openReport` |
| `flows` | `create`, `openInEditor` |
| `secrets` | `listNames`, `set`, `remove` |
| `agents` | `list`, `addCustom`, `request`, `fix`, `cancel`, `save`, `discard`, `onEvent` |
| `safetyNet` | `viewChanges`, `restore`, `keep` |
| `settings` | `get`, `set` |
| `app` | `info`, `copyBugInfo`, `checkForUpdates`, `onUpdate` |

Every call is checked in main with a schema before it reaches `core`. Paths coming from the renderer must point inside a known project folder, except where the user picks a folder through a native dialog opened by main.

### Renderer

React with Tailwind CSS v4 and shadcn/ui. The theme comes only from `design/system/theme.css`, imported directly. Text comes only from translation files (proposed: i18next with react-i18next), in English and Indonesian. Text from outside Jagra is always rendered as text, never as HTML (`SEC-7`). Fonts are bundled.

### Updates

Packaging and updates use electron-builder and electron-updater (proposed) with GitHub Releases as the source. Windows downloads updates in the background. macOS only shows a notice until the app is signed (`UPD-2`, `UPD-3`).

---

## 8. Tooling

| Need | Tool |
|---|---|
| Package manager and workspaces | pnpm |
| Language | TypeScript, strict mode, in every package |
| Build for the desktop app | Vite (proposed: electron-vite) |
| Installers and updates | electron-builder and electron-updater (proposed) |
| Unit and flow tests | Vitest |
| Lint and format | ESLint and Prettier, plus the dependency rule check from section 1 |
| Schemas | zod (D-30) |
| YAML | `yaml`, which reports line numbers for errors (D-29) |
| Translations | i18next and react-i18next (proposed) |
| ACP | the official ACP TypeScript SDK |
| CI | GitHub Actions on Windows and macOS runners |
