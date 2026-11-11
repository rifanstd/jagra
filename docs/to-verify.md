# Things to verify

This file lists everything the design depends on but nobody has confirmed yet: exact commands, version limits, library behaviour, and assumptions about users and providers. Tools change between versions, so none of this should be taken from memory.

**How to use it:** before writing code that relies on an item, check it against the official documentation or by trying it, and fill in "Found" with what you learned, the date and the source. If what you find changes a decision, stop and ask before going on, then record the outcome in `decisions.md`.

---

## Platforms and versions

| Item | Why it matters | Found |
|---|---|---|
| Lowest Windows and macOS versions supported by the Electron version we pick | `COMP-1`, `COMP-2` | 2026-11-10, README of Electron v45.2.3: Windows 10 and up, `x64` and `arm64` only (no 32-bit build); macOS Ventura (13) and up, Intel and Apple silicon. Both cover `COMP-1` and `COMP-2`. Electron follows Chromium's platform support, so check again whenever Electron is updated (D-73). |
| Lowest Android version Maestro supports on a device | `DEV-7`, `COMP-3` | Partly, 2026-11-07. The CLI docs state no minimum. docs.maestro.dev/getting-started/installing-maestro lists API levels 29, 30, 31, 33 and 34 as supported, without calling 29 a minimum. 2026-11-09: Maestro's Android driver has `minSdk = 24` at v2.12.1 (github.com/mobile-dev-inc/Maestro, `maestro-android/build.gradle.kts`), so it cannot install below API 24. Jagra warns below 24 (`MAESTRO_MIN_ANDROID_SDK`). Not tried on an API 24 to 28 image: that needs a system image download on the owner's machine. |
| Java version Maestro needs | `ENV-3` | 2026-11-07. Java 17 or newer: docs.maestro.dev/maestro-cli/how-to-install-maestro-cli, and the 2.12.1 launcher refuses older versions. |
| Smoothest way to install Maestro on Windows: native or through WSL | `ENV-4`, the most likely place for new users to get stuck | 2026-11-07. Native. The docs say to use WSL "only if it is strictly necessary": download `maestro.zip` from GitHub releases, extract it (for example to `C:\maestro`) and add its `bin` to `PATH`. Done this way on the owner's machine. The docs' `setx PATH "%PATH%;..."` can cut a long `PATH`, so Jagra's steps point to the Environment Variables window instead. |
| Whether `jagra run` should work on Linux for CI, and what it costs | Users' CI and our own end-to-end job usually run on Linux (`test-plan.md`) | |

## Tools

| Item | Why it matters | Found |
|---|---|---|
| Exact command and output format for reading the version of Java, `adb`, Maestro and Mockoon CLI on both systems | `ENV-1` | Windows, 2026-11-07, real output on the owner's machine: `java -version` on stderr, `java version "17.0.12" 2024-07-16 LTS` (OpenJDK says `openjdk version`). `adb version`, second line `Version 37.0.0-14910828`. `emulator -version`, `Android emulator version 36.5.11.0 (build_id ...)`. `maestro --version`, only `2.12.1` once D-36's variables are set (otherwise an analytics notice on stdout the first time and an update box on stderr; Maestro source). `mockoon-cli --version`, `@mockoon/cli/9.10.0 win32-x64 node-v24.22.1`. All five together take about 2 s. macOS output is expected to match (same programs) and is still to be seen. |
| Name of the Mockoon CLI program and its flags for data file and port | `MCK-2` | Partly, 2026-11-07. npm package `@mockoon/cli` (9.10.0), program `mockoon-cli`, entry `bin/run.js`, Node 18 or newer (README: tested on 18 to 24). Other installs: Docker image and a GitHub Action, no standalone binary (mockoon.com/cli). `mockoon-cli start -d <file> -p <port>` serves the sample's file (2026-11-09). 2026-11-10, `mockoon-cli start --help`: `--data`, `--port`, `--hostname` (overrides the file's), `--disable-admin-api`, `--disable-log-to-file` (otherwise it writes `~/.mockoon-cli/logs/<name>.log`), and `--repair`, which migrates an old or broken file without asking, so Jagra never passes it (MCK-1). Led to D-61. |
| How to tell when Mockoon CLI is ready to accept requests | `MCK-2` | Partly, 2026-11-09. It logs JSON lines on stdout, including `"message":"Server started on port 3000"` once it listens. It also logs an auto-generated admin API token at `warn` level, so its admin API is on by default; Jagra turns it off (D-61). 2026-11-10 on Windows: the port accepted connections 6.4 s after the first start and 2.2 s after later ones. Jagra waits for the port itself rather than the log line (MCK-2). When the process that started Mockoon was killed, Mockoon exited too, since its output pipe closed. It logs `"message":"Transaction recorded"` for every request it answers. |
| How to list existing emulators and detect when one has finished booting | `DEV-1`, `DEV-4` | 2026-11-07 and 2026-11-09. `emulator -list-avds` lists them, one name per line (developer.android.com/studio/run/emulator-commandline). The same page now calls the `emulator` tool deprecated in favour of the Android CLI's `android emulator`, which is not installed with Android Studio; Jagra keeps `emulator` (D-42). A running emulator's AVD name comes from `adb -s <serial> emu avd name` (prints the name, then `OK`). Boot is done when `adb shell getprop sys.boot_completed` prints `1`. Started from Jagra with `emulator -avd Pixel_8`, the owner's emulator was ready in 33 s, and its window was visible. |
| How to watch for devices being connected and disconnected | `DEV-2` | 2026-11-09, adb 37.0.0. `adb track-devices -l` keeps running and prints the whole list on every change, as 4 hex digits of length followed by the `adb devices -l` lines. An empty list is `0000` with no newline, so the output is read in chunks, not lines. AVDs created or deleted are not reported; the refresh button covers that. |
| When a freshly booted emulator is ready for a run, beyond `sys.boot_completed` | `DEV-4`, `RUN-5` | Found a problem, 2026-11-09. On the owner's Pixel 8 AVD (API 35, 2 GB RAM, 4 cores), flows run in the first minutes after boot failed: the low memory killer stopped the app and Maestro's on-device server (`DeviceServerDiedException`, `device offline`) while Google services were still busy (load average about 11). The same flows passed once the load average dropped below 3. Led to D-44: wait until the 1-minute load average is below the core count. No warning for 2 GB emulators. |
| Error text `adb` gives when an install fails because of a signature mismatch | `RUN-3` | 2026-11-09, adb 37.0.0, API 35. The sample APK re-signed with another key: exit code 1 and `adb.exe: failed to install other.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package dev.jagra.sample signatures do not match newer version; ignoring!]`. Other messages Jagra reads: `adb.exe: device '<serial>' not found` for an unplugged device, `adb.exe: error: listener 'tcp:<port>' not found` when removing a reverse rule that is gone, `Success` or `Failed` from `pm clear`. On macOS the prefix is `adb:`. |
| What clearing app data does to runtime permissions, and whether flows need to grant them again | `RUN-4` | |
| A Node library that reads package name, version name and version code from an APK | `PRJ-5` | 2026-11-09. `@devicefarmer/adbkit-apkreader` 4.0.0 (Apache-2.0, released 2026-10-24, about 85,000 downloads a week, dependencies `yauzl` and `debug`) read `dev.jagra.sample`, `1.0`, `1` from the sample APK in 11 ms. Led to D-46. |
| How long Maestro takes to start the first time after install | `ENV-1`, `PERF-2` | 2026-11-07, Windows: 11 s for the first `--version` after install (cold Java, many jars scanned by antivirus), about 1.9 s after that. The probe allows 20 s before reporting Timed out. 2026-11-10: every `maestro test` call takes about 6 s before the first step (Java start, then about 4.4 s to reach the device), with or without `--no-reinstall-driver`. That is Maestro's own time per flow under `RUN-5`, not Jagra's (`PERF-3`). 2026-11-11, desktop app on Windows: the full check took 9.8 s on the first start after a long pause and 2.3 to 2.5 s after that, so a cold first check can pass the 5 s of `PERF-2`. |
| Minimum and newest tested versions of Maestro and Mockoon CLI | `ENV-3` | Set to 2.12.1 and 9.10.0, the only versions tested so far. 2026-11-10: the flags Jagra uses (D-49, D-61) exist in both. Raise the newest tested version only after trying a newer release. |
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
| What Maestro writes to the output folder: screenshots, step log, crash and ANR reports, report files | `RES-1`, `RES-4` | 2026-11-10, Maestro 2.12.1 on Windows. With `--format HTML-DETAILED --output <file> --debug-output <folder> --flatten-debug-output`, Maestro writes the HTML report (every step with its status and duration) and, in `<folder>`, a `maestro.log` plus one folder per flow named after the flow, holding `commands.json`, `manifest.json`, `logs/maestro.log`, `logs/device-logcat.txt`, and for a failed step `screenshots/step-NNN-<command>.png` and `screen-hierarchy/step-NNN-<command>.json`. Nothing goes to `~/.maestro/tests`, which is where the logs go without `--debug-output`. `commands.json` lists every command as it ran, with `status` (`COMPLETED`, `FAILED`, `RUNNING`, `SKIPPED`), `depth`, `error.message` and `error.debugMessage`, and the paths of the failure's screenshot and hierarchy. It is written only when the flow ends. With `--format`, Maestro stops printing steps on stdout and prints one summary line per flow; `logs/maestro.log` is written as the flow runs, with a `CliConsoleListener.onCommandStart: <step> RUNNING` line per step. Maestro reports no crash or ANR of its own: when the sample app was crashed with `adb shell am crash` during a flow, the flow failed on its next check, and the `FATAL EXCEPTION` block for `Process: dev.jagra.sample` was in `device-logcat.txt`. ANR not tried. Led to D-49 to D-51. |
| Which report formats Maestro can produce per flow, and their file names | `RES-6` | 2026-11-10, `maestro test --help` (2.12.1): `--format` takes `JUNIT`, `HTML`, `HTML-DETAILED` or `NOOP` (the default), written to the file given with `--output`. Jagra uses `HTML-DETAILED` (D-49). |
| Whether Maestro's reports or logs show the values of variables, or only their names | `RES-7`, `SEC-4` | 2026-11-10, Maestro 2.12.1. Values. `commands.json` and both `maestro.log` files hold every variable's value and every `MAESTRO_*` environment variable, and typed text appears in step names (`Input text <value>`) in the logs and the HTML report. Led to D-48. |
| How to pass secret values to Maestro without them appearing in the process list | `RUN-11` | 2026-11-10, Maestro 2.12.1 source (`maestro-orchestra-models/.../util/Env.kt`) and tries on the sample. `-e NAME=value` puts the value in the command line. Maestro adds every environment variable whose name starts with `MAESTRO_` to the flow's variables under that same name, so `${NAME}` stays empty. `-e NAME=${MAESTRO_X}` does not help: the `-e` values are evaluated before the environment variables are defined. A wrapper flow with `env: NAME: ${MAESTRO_X}` in its header that calls the real flow with `runFlow` works, as does `runFlow` with an `env` block. Led to D-47. |
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
| Electron `safeStorage` behaviour and guarantees on Windows and macOS | `SEC-3` | Partly, 2026-11-10, Electron 45.2.3 on the owner's Windows 11: `isEncryptionAvailable()` is true after the app is ready; `encryptString("hunter2")` gives 38 bytes starting with `v10`, without the value in them, and `decryptString` returns it. Electron's docs: on Windows the key is protected with DPAPI for the current user; on macOS it is kept in the Keychain. Not tried on a Mac yet. Jagra refuses to store a value when encryption is not available (D-72). |
| electron-updater with GitHub Releases: stable and pre-release channels, and showing a notice only on unsigned macOS builds | `UPD-1` to `UPD-3` | |
| Effect of moving the repository to the `jagra-dev` organisation on update checks from installed versions | `decisions.md` D-27 | |
| Requirements and process of the free Windows code signing service | `release.md` | |
| Best GitHub Actions runner for an Android emulator in the end-to-end job | `test-plan.md` | 2026-11-10. `ubuntu-latest` with KVM and `reactivecircus/android-emulator-runner` v2.38.0, API 35 `google_apis` x86_64, 4 GB, 4 cores: boot in about 35 s, the whole job about 7.5 min, `jagra run` 4 min 37 s with the planted bug as the only failure. Jagra waited about 2.5 min for the emulator's load to drop (D-44) and then ran. With 2 cores and error dialogs shown, every flow failed behind a "Pixel Launcher isn't responding" dialog. `hide_error_dialogs` and 4 cores passed once, but the same failure came back on `main`: `hide_error_dialogs` does not hide that dialog. Moved to the `aosp_atd` image (D-60). |

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
