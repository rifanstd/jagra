# Jagra version 1 specification

This document describes what Jagra version 1 does and how it behaves. It is written for whoever builds Jagra, including Claude Code.

Read `product.md` first for the why. Read `decisions.md` before changing anything that looks odd here: most odd things are deliberate.

Each requirement has an ID such as `ENV-3`. Use these IDs in commits, tests, issues and conversations. "Must" means required for version 1. "Should" means expected unless there is a good reason, which then goes in `decisions.md`.

If something is not covered here, do not guess. Ask, and add the answer to this document.

---

## 1. Scope

### In version 1

- Desktop app with a user interface, on Windows 10 and 11 (64-bit) and the last three versions of macOS (Apple silicon and Intel).
- A basic `jagra` command line that runs all flows of a project and reports pass or fail.
- Testing Android apps from an APK. The newest debug APK is picked up automatically from the build output, or chosen by hand.
- Android emulators and USB-connected Android phones. One device per run. Jagra may start an emulator that already exists.
- Environment check with install instructions. Jagra never installs tools itself.
- Projects stored in a `.jagra` folder inside the app's repository, shared through git. Personal data stays on the user's machine.
- Mockoon at two levels: no Mockoon, or the user's existing Mockoon file used as it is.
- Running tests: clean app for every flow, continue after a failure, a time limit per flow, a clean Cancel, and choosing which flows to run.
- Results: summary, per-flow detail, screenshots, crash reports, a limited run history, the Maestro HTML report, and detection of black screenshots.
- Writing flows by hand: template, format check, `properties` in the flow header, helper flows, and variables for secrets.
- Writing flows with a local AI agent: five known agents, ACP and custom commands, sessions, the Review flow screen, and the file change safety net.
- Automatic updates on Windows and an update notice on macOS.
- English and Indonesian interface.
- A sample Android app in the repository.
- Open source release on GitHub with a signed Windows installer and an unsigned macOS build.

### Not in version 1

- Testing iOS apps.
- AAB files and building the app from source.
- Backend conditions from Mockoon (success, error, empty data per flow). Version 1 must still reserve the `properties.condition` field (see `FLOW-2`).
- An agent that writes scenarios on its own from a diff or a ticket.
- An agent that explores the app or diagnoses failed tests.
- Running on several devices at once.
- Video recording and a custom QA handoff report.
- Signing the macOS build.
- Bundling Maestro inside Jagra, or Jagra installing any tool.
- A flow editor inside Jagra.
- Advanced command line features, such as writing flows with an agent.
- Telemetry of any kind.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| App under test | The Android app the user wants to test. Not Jagra itself. |
| Project | One app under test, as Jagra knows it. Has a project folder and local settings. |
| Project folder | The folder the user picks when creating a project. Usually the root of the app's repository. May be an empty folder when the user only has an APK. |
| `.jagra` folder | Folder inside the project folder holding everything shared with the team: config, flows, helper flows, Mockoon file, team rules for the agent. Committed to git. |
| Local data | Data that stays on the user's machine and never goes into git: APK location, chosen device, chosen agent, secret values, run history, logs. |
| Flow | One Maestro YAML file in `.jagra/flows`. One flow is one test. |
| Helper flow | A Maestro YAML file in `.jagra/flows/parts`, called from other flows with `runFlow`. Never listed or run on its own. Example: logging in. |
| Run | One press of Run: installing the APK, starting Mockoon if used, and running the chosen flows on one device. |
| Device | An Android emulator or a USB-connected Android phone. |
| Agent | An AI coding agent installed on the user's machine, such as Claude Code. Jagra asks it to write flows. Jagra never calls an AI model directly. |
| Session | One conversation with an agent about one flow, kept until the flow is saved or discarded. |
| Required tool | Java, Android platform tools (`adb`) or Maestro. Jagra cannot run tests without them. |
| Optional tool | Android emulator, Mockoon CLI (with Node.js) or an agent. Jagra works without them, minus the feature that needs them. |

Note on naming: the notes behind this spec are in Indonesian and call the helper folder `flows/bagian`. The repository uses English names, so the folder is `.jagra/flows/parts`.

---

## 3. Environment check

Before a user can run anything, their machine needs a few tools. Jagra checks for them, explains what is missing and how to install it, and never installs anything itself.

### Tools

| Tool | Required | Why | How Jagra checks |
|---|---|---|---|
| Java 17 or newer | Yes | Maestro runs on Java | Run `java -version` |
| Android platform tools (`adb`) | Yes | Install APKs, list devices, forward ports | Run `adb version` |
| Maestro | Yes | Runs flows | Run `maestro --version` |
| Android emulator | No | Not needed with a USB phone | Find the `emulator` binary in the Android SDK and list emulators |
| Mockoon CLI | No | Only for projects that use Mockoon | Run `mockoon-cli --version` |
| Agents | No | Only for writing flows with AI | See section 10 |

The exact commands may differ by platform and tool version. Confirm them during implementation (see `to-verify.md`). On Windows, Maestro and Mockoon CLI are started through Java and Node, never through their `.bat` and `.cmd` files (D-34). Where Jagra looks for each tool is in D-37.

### Requirements

- **ENV-1** Jagra must check all tools in parallel, not one after another. The whole check must finish in under 5 seconds on a typical developer laptop.
- **ENV-2** Each tool gets one of these states:

  | State | Meaning | Status style |
  |---|---|---|
  | Ready | Found, version supported and tested | `success` |
  | Untested version | Found, newer than the newest version Jagra was tested with | `warning` |
  | Too old | Found, below the minimum version | `destructive` |
  | Missing (required) | Not found | `destructive` |
  | Missing (optional) | Not found | `muted-foreground`, labelled "optional" |
  | Can't start | Found, but it does not run: it needs Java or Node, it failed, or it did not answer in time. The reason is shown (D-35) | `destructive` |

- **ENV-3** Jagra must keep, in code, the minimum and the newest tested version for Maestro and Mockoon CLI, and the minimum version for Java. An untested newer version is allowed to run.
- **ENV-4** Every tool that is not Ready must show install or update instructions for the user's operating system, with a link to the official page. Windows instructions for Maestro need the most care, because that install is the most likely place for a new user to get stuck.
- **ENV-5** A Check again button must re-run the whole check.
- **ENV-6** The user must be able to set the path to any tool by hand in Settings > Tool locations, for tools installed in a non-standard place. A path set by hand wins over automatic detection. These paths are local data.
- **ENV-7** The check runs at three moments:
  1. On the first launch, as the first screen (screen 1).
  2. As a small status indicator on the project list. Clicking it opens the full check.
  3. Right before a run, checking only the tools that run needs. Mockoon CLI is only checked if the project uses Mockoon. Agents are never checked before a run.
- **ENV-8** If a required tool is missing or too old right before a run, the run must not start. Jagra shows which tool is the problem and a link to the full check.
- **ENV-9** Jagra must never install, update or remove a tool, and must never ask for admin rights.

### Done when

- On a machine with all tools, the first launch shows every required tool as Ready and moves on to the project list.
- On a machine without Maestro, the check shows Maestro as Missing in red, shows install instructions for that operating system, and the Run button refuses to start a run with a clear message.
- Installing Maestro and pressing Check again turns it Ready without restarting Jagra.
- A tool installed in a custom folder is found after its path is set in Settings.
- A project without Mockoon runs normally on a machine without Mockoon CLI.
- The full check finishes in under 5 seconds.

---

## 4. Projects

A project is one app under test. Everything the team shares lives in the `.jagra` folder inside the project folder and goes into git. Everything personal stays on the user's machine.

### The `.jagra` folder

```
<project folder>/
  .jagra/
    config.yaml        shared project settings
    agent-rules.md     the team's extra rules for agents (may be empty)
    flows/             test flows, one file per test
      parts/           helper flows, called from other flows
```

The Mockoon file can live anywhere inside the project folder. `config.yaml` points to it with a relative path. Keeping it in `.jagra/` is recommended but not required.

### `config.yaml`

```yaml
format: 1                   # format version of this folder, see PRJ-9
name: aplikasi-a            # shown in Jagra, defaults to the folder name
appId: com.company.appa     # package name of the app under test
apk:
  searchPath: app/build/outputs/apk/debug   # relative to the project folder
mockoon:                    # leave out the whole block when not used
  file: .jagra/mockoon.json # relative to the project folder
  port: 3000                # optional, defaults to the port in the Mockoon file
run:
  flowTimeoutMinutes: 5     # time limit per flow
```

The exact schema goes in `architecture.md`. Any field added later must have a default, so older `config.yaml` files keep working.

### Local data per project

Kept by Jagra on the user's machine, never in git: the APK path when chosen by hand, the last device used, which flows were selected last time, secret values (in the operating system credential store, see `SEC-3`), the agent session for a flow in progress, run history and logs.

### Requirements

- **PRJ-1** Creating a project means picking a project folder. If `.jagra/config.yaml` exists, Jagra reads it and the project is ready. If not, Jagra creates the `.jagra` folder with a starter `config.yaml`, an empty `agent-rules.md`, and empty `flows/` and `flows/parts/` folders.
- **PRJ-2** The project name defaults to the folder name and can be changed. The name lives in `config.yaml`.
- **PRJ-3** An empty folder is a valid project folder. This is how a user with only an APK uses Jagra. Agent features still work but cannot read code (see section 10).
- **PRJ-4** Jagra finds the newest `.apk` file under `apk.searchPath`, by modification time. If the search path does not exist or has no APK, Jagra asks the user to build the app or choose an APK by hand. A hand-picked APK is local data and wins over the search path until the user clears it.
- **PRJ-5** Jagra reads the package name, version name and version code from the APK. The project page shows the APK file name, version and how long ago it was built.
- **PRJ-6** If `appId` is empty, Jagra fills it from the first APK it reads. If the APK's package name differs from `appId`, Jagra warns before the run and lets the user cancel or continue.
- **PRJ-7** The project list shows every project with its name, folder and the result of its last run. Removing a project from the list never deletes any file.
- **PRJ-8** If a project folder no longer exists (moved or deleted), the project list says so and offers a Locate button to pick the new place.
- **PRJ-9** If `format` in `config.yaml` is higher than this version of Jagra understands, Jagra must not touch the folder and must tell the user to update Jagra. Version 1 only knows format 1.
- **PRJ-10** If `config.yaml` or any flow file cannot be read, Jagra shows the file and the line with the problem and keeps everything else usable (see `REL-6`).
- **PRJ-11** Jagra must never write to the project folder outside `.jagra`, except when the user explicitly restores a file in the agent safety net (see section 10).

### Done when

- Picking an app repository without `.jagra` creates the folder with the starter files listed in `PRJ-1`, and nothing else in the repository changes.
- A teammate who pulls the repository and picks the same folder gets the same project, flows and settings, and only has to choose a device.
- After building a new debug APK in Android Studio, the project page shows the new APK without any action from the user.
- An APK with a different package name than `appId` triggers the warning in `PRJ-6`.
- Moving the project folder and using Locate brings the project back with its run history.
- A broken `config.yaml` shows the file and line, and other projects still open.

---

## 5. Devices

Tests run on an Android emulator or on an Android phone connected by USB. One device per run.

### Device states

| State | Meaning | What Jagra does |
|---|---|---|
| Emulator running | Running and ready | Use it |
| Emulator starting | Running, but Android has not finished booting (D-43) | Wait until it is ready, then run |
| Emulator off | Exists on this machine, not running | Start it, wait until it is ready, then run |
| Phone ready | Connected and USB debugging is authorised | Use it |
| Phone not authorised | Connected, but the user has not accepted the USB debugging prompt | Tell the user to unlock the phone and accept the prompt |
| Phone not responding | Connected, but `adb` cannot talk to it (D-43) | Tell the user to unplug the phone and plug it in again |
| No device | No emulator exists and no phone is connected | Show how to create an emulator or connect a phone |

### Requirements

- **DEV-1** Jagra lists running devices from `adb` and existing emulators from the Android SDK, merged into one list with the states above.
- **DEV-2** The list updates on its own when a phone is plugged in or out or an emulator starts or stops. A refresh button is also available.
- **DEV-3** The device used last for a project is selected automatically. This is local data.
- **DEV-4** When the chosen emulator is off, Jagra starts it and waits until Android has finished booting and the emulator is no longer busy before installing the APK (D-44). The screen shows "Starting emulator" so the user does not think Jagra froze. If the emulator is not ready after 3 minutes, the run stops with a clear message.
- **DEV-5** Jagra leaves an emulator it started running after the run ends, so the next run does not wait again.
- **DEV-6** Jagra shows a checklist for phones: USB debugging on in Developer options, accept the prompt on the phone, keep the screen on and unlocked during the run, and on some brands (for example Xiaomi) turn on the extra developer option that allows simulated input.
- **DEV-7** If the device's Android version is below what Maestro supports, Jagra shows a clear warning before the run instead of a confusing error later.
- **DEV-8** Jagra runs one run at a time. While a run is active, Run is disabled on every project.
- **DEV-9** If the device disconnects during a run, the current flow fails with the reason "Device disconnected", the remaining flows do not run, and the run ends cleanly (see `RUN-7`).

### Done when

- Plugging in an authorised phone makes it appear in the list within a few seconds, without pressing refresh.
- Choosing an emulator that is off and pressing Run starts it, waits, and runs the flows, with "Starting emulator" visible meanwhile.
- A phone that has not accepted USB debugging shows the "Phone not authorised" state and the instruction.
- Unplugging the phone in the middle of a run ends the run cleanly with "Device disconnected" on the current flow.

---

## 6. Mockoon

Mockoon is optional. A project either uses no Mockoon and tests against the real backend, or uses the team's existing Mockoon file exactly as it is. Testing one flow under several backend conditions comes in a later version.

### Requirements

- **MCK-1** A project uses Mockoon when `config.yaml` has a `mockoon` block. Jagra must never change the Mockoon file.
- **MCK-2** During a run, Jagra starts Mockoon CLI with the project's Mockoon file after the APK is installed and before the first flow. It waits until the port accepts connections. If that takes more than 30 seconds, the run stops with a clear message.
- **MCK-3** If the port is already in use, the run does not start. Jagra says which port is busy and that the Mockoon desktop app may be open with the same port.
- **MCK-4** Jagra sets up `adb reverse` for the Mockoon port on the chosen device, so `http://localhost:<port>` on the device reaches Mockoon on the computer. This works the same way on emulators and phones. Jagra removes the reverse rule when the run ends.
- **MCK-5** Jagra stops Mockoon when the run ends, when the user cancels, when the run fails with an error, and when Jagra quits. After a crash, Jagra stops any Mockoon it started on the next launch (see `REL-2`).
- **MCK-6** When a user adds a Mockoon file to a project, Jagra shows two tips that Jagra cannot check for them: the debug build must call `http://localhost:<port>`, and the debug build must allow plain HTTP to localhost through Android's network security config.
- **MCK-7** Version 1 ignores `properties.condition` in flows. The field is reserved for backend conditions in a later version.

### Done when

- A project without a `mockoon` block runs without Mockoon CLI installed.
- A project with Mockoon runs, the app on the device gets responses from the Mockoon file, and after the run no Mockoon process and no reverse rule remain.
- With the Mockoon desktop app open on the same port, Run refuses to start and names the port.
- Cancelling a run in the middle leaves no Mockoon process behind.
- After force-quitting Jagra during a run, the next launch stops the leftover Mockoon process.

---

## 7. Running tests

A run takes the newest APK, puts it on one device, starts Mockoon if the project uses it, and runs the chosen flows one by one. Every flow starts from a clean app. A failure never stops the run; only the user, a lost device or a broken environment does.

### Order of a run

1. Check the tools this run needs (`ENV-7`), that an APK exists (`PRJ-4`), that its package matches (`PRJ-6`), that every secret used by the chosen flows has a value (`RUN-10`), and that the Mockoon port is free (`MCK-3`). If anything fails, the run does not start.
2. Prepare the device: start the emulator if it is off (`DEV-4`).
3. Install the APK.
4. Start Mockoon and set up `adb reverse`, if the project uses Mockoon (`MCK-2`, `MCK-4`).
5. For each chosen flow: clear the app's data, run the flow, save its result.
6. Stop Mockoon, remove `adb reverse`, show the Results screen.

### Requirements

- **RUN-1** Jagra lists the flows in `.jagra/flows`, top level only, sorted by file name. Helper flows in `flows/parts` are never listed or run on their own.
- **RUN-2** The user chooses which flows to run on the project page. All flows are chosen by default. The last choice is remembered as local data.
- **RUN-3** Jagra installs the APK over any existing version. If the install fails because the installed app was signed with a different key, Jagra asks the user whether to uninstall the existing app and try again. It never uninstalls without asking.
- **RUN-4** Jagra clears the app's data before every flow, so every flow starts as if freshly installed and flows never depend on each other. The flow template also starts with `launchApp` and `clearState: true` (see `FLOW-4`), so flows behave the same when run with plain Maestro.
- **RUN-5** Jagra runs Maestro once per flow. This gives Jagra control over the time limit, Cancel, the data clearing in `RUN-4` and saving each result as soon as it is known.
- **RUN-6** When a flow fails, Jagra records why and continues with the next flow. The same applies when the app crashes or stops responding: the flow fails with the reason "App crashed" or "App not responding", and Jagra keeps the crash or ANR report.
- **RUN-7** Each flow has a time limit, `run.flowTimeoutMinutes` in `config.yaml`, 5 minutes by default. A flow that passes the limit is stopped and fails with the reason "Timed out". The run continues.
- **RUN-8** The Running screen shows the overall progress, every chosen flow with its state (Waiting, Running, Passed, Failed) using the status styles in `design/system/README.md`, the name of the flow that is running, and its latest step when Maestro reports one. The screen must stay responsive the whole time.
- **RUN-9** Cancel is always available while a run is active and must respond at once. Jagra stops the current flow within a few seconds, marks it and all remaining flows as Cancelled, keeps every result already saved, stops Mockoon, removes `adb reverse` and leaves the emulator running. The run ends with the status Cancelled.
- **RUN-10** Before a run, Jagra looks for variables (`${NAME}`) in the chosen flows and the helper flows they call. If a variable has no value, Jagra asks for it before starting and stores it as a secret (`SEC-3`).
- **RUN-11** Jagra passes secret values to Maestro in a way that never shows them in logs, in the operating system's process list or in reports. The exact method is in `to-verify.md`.
- **RUN-12** Every run ends with one status: Completed (all chosen flows ran, whatever their results), Cancelled (`RUN-9`), Stopped (the device was lost or a required step failed, `DEV-9`) or Interrupted (Jagra closed or crashed during the run, `REL-2`).

### Done when

- Running the sample app's flows installs the APK, runs every flow from a clean app and ends with Completed, with the planted bug failing exactly one flow.
- A flow that loops forever is stopped at the time limit and marked "Timed out", and the next flow still runs.
- An app crash in one flow fails that flow with "App crashed" and a crash report, and the next flow still runs.
- Pressing Cancel during the third of five flows ends the run within a few seconds: two results kept, three flows marked Cancelled, no Mockoon process and no reverse rule left.
- A flow using `${PASSWORD}` with no saved value asks for it before the run, and the value never appears in the Running screen, the logs or the report.
- Changing the order of flow files does not change any result.

---

## 8. Results, history and reports

### Requirements

- **RES-1** Jagra saves everything Maestro produces for a flow (screenshots, step log, crash and ANR reports, report files) in Jagra's local data folder, one folder per run and one subfolder per flow. Nothing is saved in the project folder.
- **RES-2** The Results screen shows a summary at the top: number of flows passed, failed and cancelled, run status, duration, APK file and version, device name and Android version, and date and time.
- **RES-3** Below the summary, every flow is listed with its status (icon and word, per `design/system/README.md`), its duration and, for a failed flow, a one-line reason.
- **RES-4** Opening a flow shows its steps in plain language with a mark on each (passed, failed, not run), the same way as the Review flow screen in section 10. For a failed flow it also shows the failing step, Maestro's reason, the screenshot at the moment of failure, and any crash or ANR report. Maestro's raw output is available under "Show details". A button opens the flow file in the user's editor.
- **RES-5** If a failure screenshot is entirely or almost entirely black, Jagra shows a notice: the app probably uses `FLAG_SECURE`, which blocks screenshots; the fix is to turn it off in debug builds only.
- **RES-6** Every run produces an HTML report built from Maestro's own report output. Because Maestro runs once per flow (`RUN-5`), Jagra adds a small index page that lists every flow with its status and links to Maestro's report for that flow. "Open report" opens the index in the default browser. The whole report folder can be zipped and sent to QA.
- **RES-7** Secret values must be masked in every place Jagra shows or saves: Results, flow detail, logs and the HTML report. If Maestro's report includes secret values, Jagra replaces them before saving (`SEC-4`).
- **RES-8** Jagra keeps the last 20 runs per project. When a new run is saved, the oldest runs beyond 20 are deleted with all their files.
- **RES-9** The History screen lists a project's runs, newest first, with time, APK version, summary and status, including Cancelled, Stopped and Interrupted runs. Opening a run shows its Results screen.
- **RES-10** "Run again" on the Results screen starts a new run with the same flows on the same device, using the newest APK at that moment.

### Done when

- After a run of the sample app, the Results screen shows correct counts, the APK version and the device, and the failed flow shows its failing step, reason and screenshot.
- A test app with `FLAG_SECURE` on produces the black screenshot notice.
- "Open report" opens a page in the browser listing every flow with links to Maestro's report for each.
- After 21 runs, History shows 20 and the oldest run's files are gone from disk.
- An Interrupted run from a crash still shows the flows that finished before the crash.

---

## 9. Writing flows by hand

Flows are plain Maestro YAML. Jagra adds nothing that Maestro does not understand, so every flow also runs with the normal Maestro CLI, in CI or anywhere else.

### Example

```yaml
appId: com.company.appa
name: Login with wrong password
properties:
  condition: success
---
- launchApp:
    clearState: true
- runFlow: parts/open-login.yaml
- tapOn: "Password"
- inputText: ${WRONG_PASSWORD}
- tapOn: "Sign In"
- assertVisible: "Wrong password"
```

### Requirements

- **FLOW-1** Flows must be valid Maestro flows. Jagra must never require syntax that Maestro does not accept.
- **FLOW-2** Jagra's own data about a flow goes in the `properties` map in the flow header. Version 1 reserves `properties.condition` for backend conditions in a later version and does not read it. Jagra shows the flow's `name` from the header, or the file name if there is none.
- **FLOW-3** Helper flows live in `.jagra/flows/parts` and are called from other flows with `runFlow`. Jagra lists them on the project page under their own heading, separate from the test flows, so users know they exist and can reuse them.
- **FLOW-4** A New flow button asks for a name, creates a file in `.jagra/flows` from this template and opens it in the user's editor:

  ```yaml
  appId: <appId from config.yaml>
  name: <name the user typed>
  properties:
    condition: success
  ---
  - launchApp:
      clearState: true
  # Write the steps of this test below.
  ```

  The file name is the name in lowercase with spaces turned into hyphens (for example `login-wrong-password.yaml`). If the file exists, Jagra asks for another name.
- **FLOW-5** Jagra opens files with the operating system's default app for `.yaml`. Settings may hold an editor command instead (for example `code`).
- **FLOW-6** Before a run and whenever the flow list refreshes, Jagra checks every flow: it must be valid YAML, have a header with `appId`, the `---` separator and a list of steps. A broken flow is shown with its file, line and a plain explanation, and is left out of the run. If Maestro offers its own syntax check, Jagra uses it as well (see `to-verify.md`).
- **FLOW-7** Secrets are written in flows as variables (`${NAME}`). Values are set per project in Settings > Secrets and stored as in `SEC-3`. The Secrets page lists every variable name found in the project's flows, and marks the ones without a value.
- **FLOW-8** Jagra watches `.jagra/flows` and refreshes the list when files are added, changed or removed, for example after a `git pull` or an edit in the user's editor.
- **FLOW-9** The project page links to a short guide on finding element names with Maestro Studio, because guessing button text is the most common reason a new flow fails.
- **FLOW-10** Flows must not use Maestro commands that hand a result to an AI model: `assertWithAI`, `assertNoDefectsWithAI` and `extractTextWithAI`. The format check (`FLOW-6`) shows such a flow with its file, line and command, and leaves it out of the run. This includes helper flows and the `onFlowStart` and `onFlowComplete` hooks (`decisions.md` D-33).

### Done when

- A flow created with New flow has the template above, opens in the editor and runs.
- The same flow runs with plain `maestro test` outside Jagra and gives the same result.
- A flow with broken YAML is shown with its file and line and is skipped, while the other flows still run.
- A flow using `assertWithAI` is shown with its file and line and is skipped.
- A new flow file pulled from git appears in the list without restarting Jagra.
- The Secrets page shows `WRONG_PASSWORD` as missing until a value is set.

---

## 10. Writing flows with an agent

The user describes a test in plain language. An AI agent installed on the user's machine writes the flow. Jagra runs it and shows the result step by step. The user decides what happens next.

The rule behind this whole section: **the agent writes, Jagra runs, Maestro judges.** The agent never runs a flow, never touches a device and never decides whether a test passed.

### Agents and how Jagra talks to them

| Agent | Program | How Jagra connects |
|---|---|---|
| Claude Code | `claude` | Official command line, non-interactive mode (`claude -p`) |
| Codex | `codex` | Official command line, non-interactive mode (`codex exec`) |
| Gemini CLI | `gemini` | ACP, built into Gemini CLI (`gemini --acp`) |
| OpenCode | `opencode` | ACP, built into OpenCode (`opencode acp`) |
| Oh My Pi | `omp` | ACP, built into Oh My Pi (`omp acp`) |
| Any other ACP agent | set by the user | ACP, with the command the user enters |
| Any other agent | set by the user | A custom command the user enters |

ACP is the Agent Client Protocol, an open standard for apps to talk to coding agents. Claude Code and Codex are not used through ACP because they only support it through third-party adapters; see `decisions.md`. Exact commands and flags are in `to-verify.md`.

### Requirements: setup

- **AGT-1** Jagra detects the five known agents by looking for their programs. Settings > AI agent lists which are found and lets the user choose one. The choice is local data.
- **AGT-2** The user can add another ACP agent by entering a name and the command that starts it in ACP mode.
- **AGT-3** The user can add an agent that does not support ACP by entering a name, a start command containing `{instructions}`, and optionally a continue command containing `{session}` and `{instructions}`. Jagra replaces `{instructions}` with the path of a file holding the instructions, and `{session}` with the session id. The command is split into a program and arguments when it is saved, and placeholders are filled in as separate arguments. Jagra must never build a command by joining strings and passing them to a shell.
- **AGT-4** Jagra never handles an agent's login, token or API key, never reads an agent's credential files, and never offers a login of its own. Whatever login the user set up in the agent is what the agent uses.
- **AGT-5** Every call to an agent starts from a user action (Create flow or Ask agent to fix). Jagra never calls an agent in the background or repeats a call on its own.
- **AGT-6** The AI agent settings page carries a short note that each provider has its own terms for using its agent from other tools, with a link to the README section on this. For Codex on Windows, it notes that Codex recommends WSL.
- **AGT-7** If no agent is set up, the Create flow with AI button is disabled with the explanation: "Needs an AI agent installed on this computer, such as Claude Code. Set one up in Settings." Every other feature keeps working.

### Requirements: what the agent may do

- **AGT-8** The agent may read anything in the project folder. It may write only inside `.jagra/flows` (including `parts`). It must not run flows, Maestro, `adb` or any command that touches a device.
- **AGT-9** For ACP agents, Jagra answers the agent's permission requests: writes inside `.jagra/flows` are allowed, every other write and every terminal command is refused.
- **AGT-10** For Claude Code, Jagra uses its command line permission settings to allow reading and to allow writing only inside `.jagra/flows`. For Codex and custom agents, the rule is given in the instructions and enforced afterwards by the safety net (`AGT-19`).

### Requirements: first use

- **AGT-11** The first time a user creates a flow with AI in a project, Jagra shows a notice (screen 13): the agent will read the code in this folder and send it to its provider to write the flow; Jagra itself sends nothing; if this is a work app, check that the company allows it. Continue or Cancel. Continue is remembered for that project as local data.

### Requirements: asking for a flow

- **AGT-12** The Create flow with AI screen has a text field for the scenario, in any language, and an optional flow name. Create flow starts the agent.
- **AGT-13** While the agent works, Jagra shows that it is working, the time elapsed and a Cancel button. Cancel stops the agent process. If the agent is still working after 15 minutes, Jagra stops it and says so. The safety net (`AGT-19`) runs after any stop.
- **AGT-14** Jagra builds the instructions from three parts: the built-in template that ships with Jagra (in English), the team's `.jagra/agent-rules.md` if it has content, and the request itself. The request contains the scenario, the `appId`, whether the project folder contains source code, the list of helper flows with their names, and the list of existing flows so the agent does not duplicate one.
- **AGT-15** The built-in template tells the agent to: use plain Maestro format; start with `launchApp` and `clearState: true`; reuse helper flows when they fit; write secrets as variables and never as values; write only inside `.jagra/flows`; never run any command; never use Maestro's AI commands (`FLOW-10`); read the source code, when there is any, to use the exact text of buttons and fields; keep every check that comes from the scenario; and, if the code shows the app does not do what the scenario expects, keep the check and report a possible bug instead of changing the check.
- **AGT-16** The agent must end with a short report in a fixed JSON shape: the path of the flow it wrote, what the flow checks, any possible bug it noticed, and suggested extra tests. If Jagra cannot read the report, it still shows the flow file and the agent's raw final message.

### Requirements: sessions

- **AGT-17** Each flow request is one session. Ask agent to fix sends the user's note to the same session, so the agent keeps its context. ACP agents use ACP sessions. Claude Code and Codex use their own way of continuing a session. A custom agent uses its continue command if it has one.
- **AGT-18** If the agent cannot continue a session, Jagra starts a new one and sends the history itself: the original scenario, the current flow file, the result of the last run and the user's note. The session ends when the user saves or discards the flow. The session id is local data.

### Requirements: safety net

- **AGT-19** Right before the agent starts, Jagra records the state of the project folder. Right after the agent stops for any reason, Jagra compares. Any file created, changed or deleted outside `.jagra/flows` opens the warning (screen 14) listing those files, with View changes, Restore (the main button) and Keep. Restore puts every listed file back as it was right before the agent started. Changes the user made before the agent started are never counted and never undone. How the state is recorded, for folders with and without git, is in `architecture.md`.
- **AGT-20** If the agent changed or deleted flows in `.jagra/flows` other than the one it was asked to write, the Review flow screen lists them with their changes, and the user can undo each one.

### Requirements: review

- **AGT-21** After the agent stops and the safety net has run, Jagra runs the new flow once on the chosen device, with the same steps as a normal run (install, clear data, Mockoon, time limit, secrets). If no device is ready, Jagra shows the flow without a result and asks the user to choose a device and run it.
- **AGT-22** The Review flow screen shows the flow as steps in plain language. Actions (open, tap, type, scroll) and checks (something must be visible or not visible) look different, so the user can see at a glance what the flow really tests. The YAML can be shown instead.
- **AGT-23** After the run, every step has a mark: passed, failed or not run.
- **AGT-24** When the flow fails, Jagra explains it without AI. If an action step failed, the note says this is likely a problem in the flow, such as a wrong button name, though the app's screen may also have changed. If every action passed and a check failed, the note says this is more likely a bug in the app, though the scenario's expectation may also be wrong. Both notes say "likely", never "certainly".
- **AGT-25** For a failed flow, Jagra shows the screen at the moment of failure: the screenshot and a list of the texts and elements that were on the screen, captured by Jagra through Maestro right after the failure.
- **AGT-26** The screen also shows the agent's report: what the flow checks, any possible bug, and each suggested extra test with a "Create this too" button that starts a new request with that scenario.
- **AGT-27** The user chooses one of three actions. Save keeps the flow; a flow that fails because of an app bug is saved too and keeps failing until the bug is fixed. Ask agent to fix takes an optional note and sends it, with the failing step, the reason, the screenshot and the screen contents, to the same session (`AGT-17`). Discard deletes the flow file. Jagra never repeats a fix on its own.

### Done when

- With Claude Code set up, asking for "log in with a wrong password, an error must appear" on the sample app produces a flow that uses the app's real button text, runs once and shows every step with a mark.
- Asking for a scenario that hits the planted bug produces a flow that fails on a check, and the Review screen says it is more likely a bug in the app.
- A flow with a wrong button name fails on an action, the note points at the flow, and Ask agent to fix produces a working flow in the same session.
- An agent that edits `strings.xml` triggers the warning, and Restore puts the file back without touching the user's earlier uncommitted changes.
- An ACP agent that tries to write outside `.jagra/flows` is refused before the write happens.
- A custom agent command with a malicious scenario text such as `"; rm -rf ~"` runs no extra command.
- With no agent installed, the button is disabled with the explanation and everything else works.

---

## 11. Settings, About, updates and language

### Requirements

- **SET-1** Settings has these pages: AI agent (section 10), Secrets (per project, `FLOW-7`), Language (`LNG-1`), Tool locations (`ENV-6`) and Editor (`FLOW-5`). All settings are local data.
- **SET-2** Dark mode follows the operating system. Version 1 has no manual switch.
- **ABT-1** The About screen shows the Jagra version, "Created by Rifan Setiadi", the MIT license, a link to the GitHub repository, a Check for updates button and a Copy info for bug report button (`REL-7`).
- **UPD-1** On launch, and when the user presses Check for updates, Jagra asks GitHub Releases whether a newer version exists. Users of a stable version are only offered stable versions. Users of a pre-release (0.x) are offered newer pre-releases and stable versions.
- **UPD-2** On Windows, Jagra downloads the update in the background and asks whether to restart now or later. It never restarts during a run.
- **UPD-3** On macOS, Jagra shows a notice that a new version is available, with a button that opens the release page. Automatic updates on macOS need a signed app and come later.
- **UPD-4** The update check is the only network request Jagra makes (`SEC-1`). If it fails, Jagra shows no popup; the About screen says the last check failed.
- **LNG-1** The interface is in English and Indonesian. By default Jagra uses Indonesian when the operating system language is Indonesian, and English otherwise. The user can change it in Settings. Every piece of interface text comes from translation files; no text is written directly in components. Dates and numbers follow the chosen language.
- **LNG-2** Flow files, the built-in agent instructions and log messages are in English. Scenarios written by the user can be in any language.

### Done when

- Switching the operating system to Indonesian and starting Jagra shows the interface in Indonesian, and the Language setting switches it back to English without a restart.
- A search through the desktop source finds no interface text outside the translation files.
- With a newer release on GitHub, Windows offers to restart into it after downloading, and macOS shows the notice with a link.
- With the network off, Jagra starts and works normally, and About says the last update check failed.

---

## 12. Command line

The `jagra` command runs a project's flows without opening the app, for example in CI. It uses the same `core` package as the app, so results match.

### Requirements

- **CLI-1** `jagra run [project-folder]` runs all flows of the project in that folder, or in the current folder when none is given. It follows the same order and rules as a run in the app (section 7).
- **CLI-2** Options: `--device <id>` to choose the device (default: the only ready device, or an error if there are several), `--apk <path>` to choose the APK (default: `PRJ-4`), and `--output <folder>` for the results and HTML report (default: Jagra's local data folder).
- **CLI-3** Because a CI machine has no credential store with the user's secrets, the command line reads secret values from environment variables named `JAGRA_SECRET_<NAME>`, for example `JAGRA_SECRET_PASSWORD` for `${PASSWORD}`. It never prints them.
- **CLI-4** The command prints one line per flow as it finishes and a summary at the end. Exit code 0 means every flow passed, 1 means at least one flow failed, 2 means the run could not start or was stopped (missing tool, no device, lost device).
- **CLI-5** The command line has no agent features in version 1.
- **CLI-6** The command line is published to npm as the package `jagra`. Installing the desktop app does not add the command to the system path in version 1.

### Done when

- `jagra run` in the sample app folder runs every flow, prints one line per flow and exits with code 1 because of the planted bug.
- Fixing the planted bug locally makes the same command exit with 0.
- Running with no device connected exits with 2 and a clear message.
- A secret given through `JAGRA_SECRET_<NAME>` is used and never printed.

---

## 13. Sample app

The sample app lets someone who has never seen Jagra try it in a few minutes, without preparing an app, flows or a Mockoon file.

### Requirements

- **SMP-1** The repository has a `sample-app` folder with a small Android app written in Kotlin with Jetpack Compose. It has three screens: login, item list and item detail.
- **SMP-2** The app has built-in data. The debug build first tries Mockoon at `http://localhost:3000` with a short timeout and falls back to the built-in data if Mockoon is not there, showing a small "Built-in data" label. The built-in data and the Mockoon file hold the same items, so every flow gives the same result with or without Mockoon.
- **SMP-3** The sample app has its own `.jagra` folder with about five flows (login works, wrong password shows an error, the item list shows items, opening an item shows its detail, saving an item), a helper flow for logging in, a Mockoon file and an example `agent-rules.md`.
- **SMP-4** One bug is planted on purpose: the Save button disappears when an item's name is longer than a set length, so exactly one flow fails. The sample app's README explains the bug so nobody fixes it by mistake.
- **SMP-5** Every GitHub release includes the sample APK. The desktop app also bundles the sample project and its APK, so Try the sample app works offline.
- **SMP-6** Try the sample app (shown when the project list is empty) copies the sample project into a folder in the user's Documents, adds it as a project and opens its project page. If the folder already exists, Jagra opens the existing copy.

### Done when

- On a fresh install with a running emulator, Try the sample app followed by Run gives a result in a few minutes, with exactly one failed flow caused by the planted bug.
- The same run gives the same result with Mockoon on and off.
- The sample's flows pass `jagra run` in CI with the same single failure.

---

## 14. Non-functional requirements

### Compatibility

- **COMP-1** Windows 10 and 11, 64-bit, for as long as the Electron version in use supports Windows 10.
- **COMP-2** The last three macOS versions, on Apple silicon and Intel, within what the Electron version in use supports.
- **COMP-3** Devices: the Android versions Maestro supports (`DEV-7`).
- **COMP-4** No hardware requirement beyond what the Android Studio emulator needs.

The exact lower limits from Electron and Maestro are in `to-verify.md`.

### Performance

Targets for a typical developer laptop. They are guides, not promises; missing one by a wide margin means something needs fixing.

- **PERF-1** From clicking the app icon to the project list: under 3 seconds.
- **PERF-2** Full environment check: under 5 seconds (`ENV-1`).
- **PERF-3** Jagra's own time per flow, outside the time Maestro spends running it: about 2 seconds at most.
- **PERF-4** The interface stays responsive during a run, and Cancel responds at once.
- **PERF-5** Jagra's memory use, not counting the emulator, stays under about 500 MB during a run.

### Privacy and security

- **SEC-1** Jagra makes no network requests except the update check (`UPD-4`). Fonts and every other asset are bundled.
- **SEC-2** No telemetry. If it is ever added, it must be off by default and turned on by the user.
- **SEC-3** Secret values are stored in the operating system's credential store (Credential Manager on Windows, Keychain on macOS), never in plain files.
- **SEC-4** Secret values are masked everywhere Jagra shows or saves text: screens, step lists, logs and reports. A masked value is shown as `***` whatever its length, including where it appears inside longer text.
- **SEC-5** Jagra runs as a normal user and never asks for admin rights.
- **SEC-6** The Electron renderer is isolated: context isolation on, Node integration off, sandbox on. The preload script exposes a small set of named functions and nothing else. The main process checks every request from the renderer, for example that a file path is inside the project folder. Jagra never loads remote content into a window. These settings must never be turned off, not even to make development easier.
- **SEC-7** Text from outside Jagra (flow files, Maestro output, agent messages, app error messages) is always shown as text, never as HTML.
- **SEC-8** Jagra starts every external program with a program name and an argument list, never through a shell string (see `AGT-3`).

### Reliability

- **REL-1** Results are saved as soon as each flow ends, so a crash never loses finished results.
- **REL-2** Jagra keeps a small record of the processes and `adb reverse` rules it started. On launch after a crash, it stops leftover processes, removes leftover rules and marks the last run as Interrupted.
- **REL-3** Every process Jagra starts (Mockoon, Maestro, agents, emulators excepted) stops when Jagra quits, however it quits.
- **REL-4** Losing the device during a run ends the run cleanly (`DEV-9`).
- **REL-5** Every error message says what happened and what the user can do, in plain words. Technical details are under "Show details".
- **REL-6** A broken file in `.jagra` shows the file and the line and never crashes Jagra. The rest of the app stays usable.
- **REL-7** Jagra keeps technical logs in its local data folder, with secrets masked and a size limit of three files of 5 MB each (the oldest file is removed first). Copy info for bug report copies the Jagra version, operating system, the version of each tool and the latest part of the log.

---

## 15. Screens

The wireframes are in `design/wireframes.html`. Finished mockups will be in `design/screens/`. When a mockup exists, it wins over the wireframe on looks; this spec wins on behaviour.

| # | Screen | What it shows | Requirements |
|---|---|---|---|
| 1 | Environment check | Each tool with its state, install instructions, Check again, Tool locations | ENV |
| 2 | Project list | Environment status, projects with last result, Settings and About links | PRJ-7, PRJ-8, ENV-7 |
| 3 | Create project | Project folder, name, APK source, optional Mockoon file and tips | PRJ-1 to PRJ-6, MCK-6 |
| 4 | Project page | APK and version, device, chosen flows, helper flows, last result, Run, New flow, Create flow with AI, History | PRJ-5, DEV, RUN-2, FLOW-3, FLOW-4 |
| 5 | Running | Progress, each flow with its state, current step, Cancel | RUN-8, RUN-9 |
| 6 | Results | Summary, flow list, Run again, Open report | RES-2, RES-3, RES-6, RES-10 |
| 7 | Flow detail | Steps with marks, failing step, reason, screenshot, crash report, black screenshot notice | RES-4, RES-5 |
| 8 | Create flow with AI and Review flow | Scenario field, agent progress, steps with marks, failure note, screen contents, agent report, Save, Ask agent to fix, Discard | AGT-12 to AGT-27 |
| 9 | Empty project list | "No projects yet", Try the sample app, Create project | SMP-6 |
| 10 | History | Last 20 runs with time, APK version, summary and status | RES-8, RES-9 |
| 11 | Settings | AI agent, Secrets, Language, Tool locations, Editor | SET-1 |
| 12 | About | Version, creator, license, GitHub, Check for updates, Copy info for bug report | ABT-1 |
| 13 | First AI use notice | What the agent will read and send, Continue, Cancel | AGT-11 |
| 14 | File change warning | Files changed outside `.jagra/flows`, View changes, Restore, Keep | AGT-19 |
