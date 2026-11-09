# Things to verify

This file lists everything the design depends on but nobody has confirmed yet: exact commands, version limits, library behaviour, and assumptions about users and providers. Tools change between versions, so none of this should be taken from memory.

**How to use it:** before writing code that relies on an item, check it against the official documentation or by trying it, and fill in "Found" with what you learned, the date and the source. If what you find changes a decision, stop and ask before going on, then record the outcome in `decisions.md`.

---

## Platforms and versions

| Item | Why it matters | Found |
|---|---|---|
| Lowest Windows and macOS versions supported by the Electron version we pick | `COMP-1`, `COMP-2` | |
| Lowest Android version Maestro supports on a device | `DEV-7`, `COMP-3` | Partly, 2026-11-07. The CLI docs state no minimum. docs.maestro.dev/getting-started/installing-maestro lists API levels 29, 30, 31, 33 and 34 as supported, without calling 29 a minimum. Try older images in M4. |
| Java version Maestro needs | `ENV-3` | 2026-11-07. Java 17 or newer: docs.maestro.dev/maestro-cli/how-to-install-maestro-cli, and the 2.12.1 launcher refuses older versions. |
| Smoothest way to install Maestro on Windows: native or through WSL | `ENV-4`, the most likely place for new users to get stuck | 2026-11-07. Native. The docs say to use WSL "only if it is strictly necessary": download `maestro.zip` from GitHub releases, extract it (for example to `C:\maestro`) and add its `bin` to `PATH`. Done this way on the owner's machine. The docs' `setx PATH "%PATH%;..."` can cut a long `PATH`, so Jagra's steps point to the Environment Variables window instead. |
| Whether `jagra run` should work on Linux for CI, and what it costs | Users' CI and our own end-to-end job usually run on Linux (`test-plan.md`) | |

## Tools

| Item | Why it matters | Found |
|---|---|---|
| Exact command and output format for reading the version of Java, `adb`, Maestro and Mockoon CLI on both systems | `ENV-1` | Windows, 2026-11-07, real output on the owner's machine: `java -version` on stderr, `java version "17.0.12" 2024-07-16 LTS` (OpenJDK says `openjdk version`). `adb version`, second line `Version 37.0.0-14910828`. `emulator -version`, `Android emulator version 36.5.11.0 (build_id ...)`. `maestro --version`, only `2.12.1` once D-36's variables are set (otherwise an analytics notice on stdout the first time and an update box on stderr; Maestro source). `mockoon-cli --version`, `@mockoon/cli/9.10.0 win32-x64 node-v24.22.1`. All five together take about 2 s. macOS output is expected to match (same programs) and is still to be seen. |
| Name of the Mockoon CLI program and its flags for data file and port | `MCK-2` | Partly, 2026-11-07. npm package `@mockoon/cli` (9.10.0), program `mockoon-cli`, entry `bin/run.js`, Node 18 or newer (README: tested on 18 to 24). Other installs: Docker image and a GitHub Action, no standalone binary (mockoon.com/cli). `mockoon-cli start -d <file> -p <port>` serves the sample's file (2026-11-09). Other flags still open, M6. |
| How to tell when Mockoon CLI is ready to accept requests | `MCK-2` | Partly, 2026-11-09. It logs JSON lines on stdout, including `"message":"Server started on port 3000"` once it listens. It also logs an auto-generated admin API token at `warn` level, so its admin API is on by default; decide in M6 whether Jagra turns it off. |
| How to list existing emulators and detect when one has finished booting | `DEV-1`, `DEV-4` | Partly, 2026-11-07. `emulator -list-avds` lists them (developer.android.com/studio/run/emulator-commandline). The same page now calls the `emulator` tool deprecated in favour of the Android CLI's `android emulator`. Decide which to use in M4. |
| How to watch for devices being connected and disconnected | `DEV-2` | |
| When a freshly booted emulator is ready for a run, beyond `sys.boot_completed` | `DEV-4`, `RUN-5` | Found a problem, 2026-11-09. On the owner's Pixel 8 AVD (API 35, 2 GB RAM), flows run in the first minutes after boot failed: the low memory killer stopped the app and Maestro's on-device server (`DeviceServerDiedException`, `device offline`) while Google services were still busy (load average about 11). The same flows passed once the load average dropped below 3. Decide in M4 how Jagra waits, and whether it warns about a 2 GB emulator. |
| Error text `adb` gives when an install fails because of a signature mismatch | `RUN-3` | |
| What clearing app data does to runtime permissions, and whether flows need to grant them again | `RUN-4` | |
| A Node library that reads package name, version name and version code from an APK | `PRJ-5` | |
| How long Maestro takes to start the first time after install | `ENV-1`, `PERF-2` | 2026-11-07, Windows: 11 s for the first `--version` after install (cold Java, many jars scanned by antivirus), about 1.9 s after that. The probe allows 20 s before reporting Timed out. |
| Minimum and newest tested versions of Maestro and Mockoon CLI | `ENV-3` | Set to 2.12.1 and 9.10.0, the only versions tested so far. Review Maestro in M5 and Mockoon CLI in M6, once the flags Jagra needs are known. |
| What `/usr/bin/java` does on a Mac without a JDK, and what the probe then reports | `ENV-2` | Not yet. Check on a Mac. |
| Whether `/opt/homebrew/bin` and `/usr/local/bin` are enough for a Finder-opened app to find the tools, or the desktop app needs the user's full `PATH` some other way, without starting a shell | `ENV-1`, D-37 | Not yet, M7. |
| Whether Node can start `.bat` and `.cmd` files without a shell | `SEC-8`, D-21 | 2026-11-07. No. Since the fix for CVE-2024-27980 (nodejs.org April 2024 security releases), `spawn` throws `EINVAL` for them without `shell: true`; tried on Node 24.22.1 on Windows. Led to D-31. |
| How Maestro, Mockoon CLI and each agent are installed on Windows: a real `.exe`, a `.bat`, or an npm `.cmd` shim, and how to start each without a shell | `ENV-1`, D-31 | Maestro and Mockoon CLI, 2026-11-07: Maestro 2.12.1 ships `bin\maestro.bat` (a Gradle launcher that runs Java with `lib\*`) and a Unix `bin/maestro`. Mockoon CLI is an npm `.cmd` shim that runs `node <shim folder>
ode_modules\@mockoon\cliin
un.js`. Both started without a shell as in D-34. Agents still open, M10. |

## Maestro

| Item | Why it matters | Found |
|---|---|---|
| Flags for running one flow on a chosen device with an output folder and variables | `RUN-5` | |
| What Maestro writes to the output folder: screenshots, step log, crash and ANR reports, report files | `RES-1`, `RES-4` | |
| Which report formats Maestro can produce per flow, and their file names | `RES-6` | |
| Whether Maestro's reports or logs show the values of variables, or only their names | `RES-7`, `SEC-4` | |
| How to pass secret values to Maestro without them appearing in the process list | `RUN-11` | |
| Whether Maestro has a command to check flow syntax | `FLOW-6` | |
| The command to capture the texts and elements on screen | `AGT-25` | |
| How Maestro behaves on apps with `FLAG_SECURE`: does it still read the screen, and are screenshots black | `RES-5` | |
| How to stop a running flow cleanly on Windows and macOS, including child processes | `RUN-7`, `RUN-9` | Partly, 2026-11-07. Stopping a process tree works with `taskkill /PID <pid> /T /F` on Windows and a signal to the process group (`detached: true`, then `process.kill(-pid)`) on macOS, shown by the `NodeProcessRunner` tests in CI on both systems. Whether Maestro shuts down cleanly this way, and what it leaves in the output folder, is still open for M5. |
| Which keys a flow header accepts | `FLOW-2`, `FLOW-4` | 2026-11-07, Maestro source `maestro-orchestra/.../yaml/YamlConfig.kt` (release cli-2.12.1): `name`, `appId` (or `url` for web), `tags`, `env`, `onFlowStart`, `onFlowComplete`, `properties` (a map of strings). `appId` or `url` is required. Other keys are accepted and kept. The docs site does not list `name` or `properties`. |
| Maestro's commands, and which of them are checks | `AGT-22`, `AGT-24` | 2026-11-07, `YamlFluentCommand.kt` and docs.maestro.dev/reference/commands-available. Checks: `assertVisible`, `assertNotVisible`, `assertTrue`, `assertScreenshot`, `assertDarkMode`, `assertLightMode`. AI commands: `assertWithAI`, `assertNoDefectsWithAI`, `extractTextWithAI` (D-33). Nested commands sit under `commands:` in `runFlow`, `repeat` and `retry`; `runFlow` and `retry` can take `file:` instead. |
| How variables are defined and which names are Maestro's own | `RUN-10` | 2026-11-07, docs.maestro.dev parameters-and-constants and JavaScript pages. `${NAME}` comes from `-e NAME=value`, the header `env:` or a `runFlow` `env:`. Built-in: `MAESTRO_FILENAME`, `MAESTRO_DEVICE_UDID`, `MAESTRO_SHARD_ID`, `MAESTRO_SHARD_INDEX`, shell variables starting with `MAESTRO_`, `output.*`, `maestro.copiedText`, `maestro.platform`. `${...}` may hold JavaScript; Jagra only counts a plain name as a variable. |
| Whether a helper flow called with `runFlow` also needs a header with `appId` | `FLOW-3`, `FLOW-6` | Yes. 2026-11-09, Maestro 2.12.1: a helper without the header fails with `Config Section Required at <file>:<line>:<col>`. `maestro test <folder>` runs only the top-level flows, in file name order, and skips `parts/`. |

## Agents

| Item | Why it matters | Found |
|---|---|---|
| Claude Code: non-interactive flags, how to get a session id, how to continue a session | `AGT-10`, `AGT-17` | |
| Claude Code: permission flags to allow reading and to allow writing only inside `.jagra/flows` | `AGT-10` | |
| Codex: non-interactive flags and how to continue a session | `AGT-17` | |
| Codex on Windows: current support status and the WSL recommendation | `AGT-6` | |
| Exact commands that start Gemini CLI, OpenCode and Oh My Pi in ACP mode | Spec section 10 | |
| ACP TypeScript SDK: current version, how sessions are created and loaded, how permission requests and file writes reach the client | `AGT-9`, `AGT-17` | |
| Whether each ACP agent supports loading an earlier session | `AGT-18` | |

## Desktop app

| Item | Why it matters | Found |
|---|---|---|
| Electron `safeStorage` behaviour and guarantees on Windows and macOS | `SEC-3` | |
| electron-updater with GitHub Releases: stable and pre-release channels, and showing a notice only on unsigned macOS builds | `UPD-1` to `UPD-3` | |
| Effect of moving the repository to the `jagra-dev` organisation on update checks from installed versions | `decisions.md` D-27 | |
| Requirements and process of the free Windows code signing service | `release.md` | |
| Best GitHub Actions runner for an Android emulator in the end-to-end job | `test-plan.md` | |

## Provider terms

Agent providers change their rules for using their agents from other tools, sometimes without notice. Check again before every release, Anthropic first.

| Item | Why it matters | Found |
|---|---|---|
| Anthropic's current terms for third-party tools that run Claude Code through `claude -p` | `decisions.md` D-06, D-07 | |
| Whether `claude -p` still uses the user's subscription or now requires an API key | `decisions.md` D-06 | |
| OpenAI's current terms for running Codex from other tools | `decisions.md` D-07 | |
| Google's current terms for Gemini CLI used from other tools | `decisions.md` D-07 | |

---

## Assumptions about users

These are guesses made during design. Check them with developers outside the team during the 0.x trial, before 1.0.0.

| Assumption | Decision it supports | Found |
|---|---|---|
| Many mobile developers use Macs | Version 1 runs on macOS too (D-01) | |
| Teams use Mockoon in very different ways; it is unknown how many use several responses and rules | Mockoon levels in version 1 (D-15) | |
| Developers are comfortable writing Maestro YAML by hand, or with an agent | Plain Maestro flows (D-08) and no built-in editor | |
| Setting up Maestro is where most new users get stuck | Instructions only, with bundling later (D-16) | |
