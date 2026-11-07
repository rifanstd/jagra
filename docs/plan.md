# Jagra version 1 plan

This is the order in which Jagra version 1 gets built. Each milestone is small, ends with something that can be run and checked, and builds on the one before.

## How to work through this plan

- Do one milestone at a time, in order. Do not start the next one until the current one meets its "Done when" and the project owner has looked at it.
- One milestone is one branch and one pull request, or a few if it is large. Every pull request names the requirement IDs from `spec-v1.md` it covers.
- Tests are written together with the code, not after. Layers are described in `test-plan.md`.
- Before relying on anything listed in `to-verify.md`, check it and write down what you found there. If it changes a decision, stop and ask.
- If something is unclear or not covered by the docs, ask. Do not guess, and do not add features that are not in the spec.
- Items marked **(owner)** are for the project owner, not for Claude Code.

---

## M0. Repository and tooling

Set up the empty monorepo so every later milestone has a home, tests and CI.

- pnpm workspace with `packages/core`, `packages/cli`, `packages/desktop` (empty shells), `sample-app/`, `design/`, `docs/`.
- TypeScript strict in every package. ESLint and Prettier. The dependency rule check from `architecture.md` section 1, failing CI when broken.
- Vitest in `core` and `cli`.
- GitHub Actions running lint, type check and tests on Windows and macOS for every pull request.
- `LICENSE` (MIT, Copyright Rifan Setiadi), a short `README.md` and `README.id.md` saying what Jagra is and that it is not ready yet.
- Dependabot and GitHub secret scanning turned on.
- **(owner)** Create the repository in the personal account. Apply for free Windows code signing for open source (for example SignPath Foundation) as soon as the repository is public, because approval takes time.

**Done when:** a pull request with a deliberate lint error, type error, failing test or forbidden import (for example `core` importing `electron`) fails CI on both systems.

---

## M1. Core foundations

The parts every other module stands on. No real tools yet.

- `ProcessRunner` port and adapter: start programs with an argument list and never a shell, stream output, stop a program and its children on Windows and macOS, and record running processes in `state/active.json` (SEC-8, REL-2, REL-3).
- Error codes (`architecture.md` section 2) and the logger with secret masking and size limit (REL-7, SEC-4).
- All ports from `architecture.md` section 2 as interfaces, with fake adapters for tests.
- `config.yaml` schema, reading with line-numbered errors, defaults and the `format` rule (PRJ-9, PRJ-10).
- Flow discovery, flow parsing into steps marked as action or check, helper flow detection, variable scan (RUN-1, FLOW-2, FLOW-3, FLOW-6, RUN-10).

**Done when:** layer 1 tests cover config reading, flow parsing (including broken files), variable scanning, masking and the no-shell rule, and they pass on both systems.

---

## M2. Environment check

- `environment` module and `ToolProbe` adapter for Java, `adb`, Maestro, the emulator and Mockoon CLI (ENV-1 to ENV-9).
- Minimum and newest tested versions kept in code (ENV-3), with the real numbers confirmed through `to-verify.md`.
- Install instructions per tool and per system as data the interface can show later (ENV-4).

**Done when:** a small script or test prints the state of every tool on the developer's machine in under 5 seconds, and fake adapters cover Ready, Untested version, Too old and Missing.

---

## M3. Sample app

The sample app comes early because every later milestone needs a real app to test against.

- `sample-app/` in Kotlin with Jetpack Compose: login, item list, item detail, built-in data, the Mockoon fallback and the "Built-in data" label (SMP-1, SMP-2).
- The planted bug (SMP-4) and the sample app README explaining it.
- `.jagra/` with `config.yaml`, about five flows, `parts/login.yaml`, the Mockoon file and an example `agent-rules.md` (SMP-3).
- A GitHub Actions job that builds the debug APK.

**Done when:** the sample's flows run with plain `maestro test` on an emulator, with exactly one failure from the planted bug, both with and without Mockoon running.

---

## M4. Devices and APK

- `DeviceBridge` adapter: list devices and emulators with their states, watch for changes, start an emulator and wait for boot, install with the signature mismatch question, clear app data, add and remove `adb reverse`, read the Android version (DEV-1 to DEV-9, RUN-3).
- `ApkReader` adapter and the APK search rule (PRJ-4 to PRJ-6).

**Done when:** against the sample APK, the module finds the APK, reads its package and version, starts an emulator that was off, installs, clears data, and sets and removes a reverse rule, and layer 2 tests cover an unplugged phone and an unauthorised phone with fakes.

---

## M5. Runs and the command line

The first complete path from APK to result.

- `FlowRunner` adapter (one Maestro call per flow), `ScreenInspector`, the `runner` module with the order in spec section 7, time limits, Cancel through one `AbortSignal`, and run statuses (RUN-1 to RUN-12).
- `results`: saving per flow, run records, the report index, history retention, masking, black screenshot detection (RES-1 to RES-10).
- `SecretStore` for the CLI through `JAGRA_SECRET_<NAME>` (CLI-3), and the safe way of passing secrets to Maestro (RUN-11, see `to-verify.md`).
- `jagra run` with its options, output and exit codes (CLI-1 to CLI-6).
- A GitHub Actions job running `jagra run` on the sample app with an emulator, expecting exit code 1.

**Done when:** `jagra run` on the sample app meets the "Done when" lists of spec sections 7, 8 and 12, and layer 2 tests cover Cancel, timeouts, a crashed app, a lost device and a crash of Jagra itself.

---

## M6. Mockoon

- `MockServer` and `PortChecker` adapters and the `mockoon` module (MCK-1 to MCK-7), wired into the run.
- Leftover cleanup after a crash (REL-2) covering Mockoon and reverse rules.

**Done when:** spec section 6 "Done when" passes with the sample app, through `jagra run`.

---

## M7. Desktop shell

The Electron app with nothing but its frame, its security settings and the plumbing every screen will use.

- Main, preload and renderer as in `architecture.md` section 7, with isolation on, Node integration off and sandbox on (SEC-6). A test that fails if any of these change.
- The preload API with schema checks in main.
- Renderer with React, Tailwind v4 and shadcn/ui, importing `design/system/theme.css`, with bundled fonts and dark mode following the system (SET-2, SEC-1).
- i18next with English and Indonesian files and the language rule (LNG-1, LNG-2). Error codes turned into text in the renderer.
- `SecretStore` for the desktop app with `safeStorage` (SEC-3).
- **(owner)** Mockups in `design/screens/` for every screen are finished and approved before M8 starts.

**Done when:** the app opens on Windows and macOS, shows a placeholder screen in the AstroVista theme in light and dark mode, switches language without restart, makes no network requests, and the security settings test passes.

---

## M8. Main screens

Screens 1 to 7, 9, 10, 11 (without the AI agent page) and 12, following the mockups and spec section 15.

- Environment check, project list and empty list with Try the sample app (bundling the sample project and APK, SMP-5, SMP-6), create project, project page, Running, Results, flow detail, History, Settings (Secrets, Language, Tool locations, Editor), About with Copy info for bug report.

**Done when:** a new user can install from a local build, try the sample app and see the planted bug fail within a few minutes, on both systems, without touching a terminal.

---

## M9. Writing flows by hand

- New flow with the template, opening in the editor, the format check in the interface, the file watcher, the Secrets page listing variables, and the Maestro Studio guide (FLOW-1 to FLOW-9).

**Done when:** spec section 9 "Done when" passes in the app.

---

## M10. Writing flows with an agent

The largest milestone. Split it into several pull requests in this order.

1. `CliAgent` for Claude Code and Codex, custom commands with the no-shell rule, agent detection and the AI agent settings page (AGT-1 to AGT-7, AGT-10).
2. `AcpAgent` for Gemini CLI, OpenCode, Oh My Pi and other ACP agents, with permission answers (AGT-9).
3. Instructions from template, team rules and request; the JSON report; sessions and the fallback history (AGT-14 to AGT-18).
4. The safety net for git and non-git folders, the warning screen, and changes to other flows (AGT-19, AGT-20).
5. The first-use notice, the request screen, the review run and the Review flow screen with the failure note, screen contents and agent report (AGT-11 to AGT-13, AGT-21 to AGT-27).

- Run the security audit (`test-plan.md`) once this milestone is done.

**Done when:** spec section 10 "Done when" passes with at least Claude Code and one ACP agent, and findings from the audit are fixed or recorded.

---

## M11. Packaging and updates

- electron-builder for a signed Windows installer and a macOS build for Apple silicon and Intel, built by GitHub Actions from a version tag (`release.md`).
- Automatic updates on Windows and the update notice on macOS, with stable and pre-release channels (UPD-1 to UPD-4).
- Publishing the CLI to npm as `jagra` (CLI-6).
- Run the security audit again, focused on updates and the release pipeline.

**Done when:** a test release installs on both systems, Windows updates itself to a second test release, and macOS shows the notice.

---

## M12. First release

- Repository files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue templates for bug reports (asking for the Copy info for bug report text) and feature requests.
- Full `README.md` and `README.id.md`: what Jagra is, how to install, the macOS "Open Anyway" steps, trying the sample app, the AI agent section with the note on provider terms, and the planned version 2 features (change awareness and backend conditions).
- Run the layer 3 checklist from `test-plan.md` on Windows and macOS.
- Release 0.1.0 as a pre-release.

**Done when:** 0.1.0 is published and meets the release criteria.

## After 0.1.0

- **(owner)** Use Jagra on every build of one real app for four weeks, and compare testing time with the times recorded before Jagra.
- Fix what the trial finds in 0.x releases.
- Ask developers outside the team to try it and check the assumptions in `to-verify.md`.
- Run the security audit more than once, then release 1.0.0 when the release criteria are met.
