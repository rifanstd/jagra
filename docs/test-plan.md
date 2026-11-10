# Jagra test plan

A testing tool that is wrong is worse than no tool: if Jagra says "passed" when the app is broken, the bug goes to QA with a stamp of approval. This file describes how Jagra itself is tested, and what a version must pass before it ships.

## Release criteria

A version is released only when all of these are true:

1. Every feature in that version meets its "Done when" in `spec-v1.md`.
2. All automated tests (layers 1 and 2) pass in CI on Windows and macOS.
3. The layer 3 checklist below passes on a Windows machine and a macOS machine with the sample app.
4. There are no known severe bugs. Severe means: Jagra crashes, data is lost, a secret is shown, a result is wrong (passed when it failed or the other way round), or a process or reverse rule is left behind. Minor bugs, such as cut-off text or a misaligned element, may ship if they are listed in the release notes.

Whether Jagra saves the team time is checked separately and does not block a release (see the end of this file).

---

## Layer 1: logic tests

Fast tests of pure logic, no devices and no external programs. They run on every pull request in GitHub Actions on Windows and macOS, and should finish in seconds.

Must cover at least:

- Reading `config.yaml`: defaults, unknown fields kept, `format` rules, and line numbers in errors.
- Parsing flows into steps, telling actions from checks, finding helper flows and variables, and handling broken YAML.
- **Failure classification for the Review flow screen** (`AGT-24`). This decides whether the user trusts Jagra, so it gets the most cases: failure on each kind of action, failure on each kind of check, failure inside a helper flow, timeout, crash.
- Secret masking in text, logs and report files, including secrets that appear inside longer strings.
- Building process arguments without a shell, including scenarios and file names full of shell characters (`SEC-8`, `AGT-3`).
- The safety net's comparison and restore logic for git and non-git folders, using temporary folders (`AGT-19`).
- Parsing the agent's JSON report, including broken and missing reports (`AGT-16`).
- Report index building and history retention (`RES-6`, `RES-8`).
- Black screenshot detection with sample images (`RES-5`).
- **Electron security settings**: a test that fails if context isolation, the sandbox or the Node integration setting of any window changes (`SEC-6`).
- Translation files: every key exists in English and Indonesian, and no interface text sits outside them (`LNG-1`).

---

## Layer 2: flow tests with fake tools

The real `adb`, emulator, Maestro, Mockoon CLI and agents are replaced by fake adapters (see `architecture.md` section 2) that answer the way the real ones would, including failures. These tests check that Jagra behaves correctly when things go wrong, which is hard to reproduce with real devices. They run on every pull request on Windows and macOS.

Must cover at least:

- A full run with passing and failing flows, checking order, data clearing before each flow and saving after each flow.
- Cancel at every stage: while starting the emulator, installing, starting Mockoon, during a flow, between flows.
- A flow that never ends and hits the time limit.
- An app crash and an app that stops responding.
- The device disappearing mid-run.
- Jagra crashing mid-run, then starting again: leftover processes and reverse rules removed, the run marked Interrupted.
- Mockoon's port already in use; Mockoon never becoming ready.
- APK signature mismatch, with the user saying yes and no.
- A missing secret before a run.
- An environment with a missing tool, a too-old tool and an untested newer tool.
- An agent that writes only its flow; one that also writes outside `.jagra/flows`; one that edits another flow; one that never finishes; one that returns a broken report; one that cannot continue a session.
- An ACP agent asking for permission to write outside `.jagra/flows`, which must be refused.

## End-to-end check in CI

One GitHub Actions job runs `jagra run` against the sample app on a real Android emulator and expects exit code 1, from the planted bug. Android emulators run most reliably in CI on Linux runners, so this job may run on Linux even though Linux is not a supported desktop platform (see `to-verify.md`).

---

## Layer 3: manual checklist before every release

Done by a person on one Windows machine and one macOS machine, with an emulator and a real Android phone, using the installer built for the release.

**Install and first launch**
- [ ] Install from the release installer. On Windows, no unknown-publisher warning. On macOS, the "Open Anyway" steps in the README work.
- [ ] The environment check shows the right state for every tool, and install instructions for anything missing.
- [ ] With the network off, Jagra starts and works, and About says the update check failed.

**Sample app**
- [ ] Try the sample app creates the project and opens it.
- [ ] Run on an emulator that is off: it starts, the flows run, exactly one fails because of the planted bug.
- [ ] The failed flow shows the failing step, reason and screenshot.
- [ ] Open report shows the index and Maestro's report for each flow.
- [ ] The same run with Mockoon on gives the same result, and Mockoon is gone afterwards.

**Real phone**
- [ ] An unauthorised phone shows the right state and instruction.
- [ ] A run on the phone works.
- [ ] Unplugging the phone mid-run ends the run cleanly with "Device disconnected".

**Stopping and recovering**
- [ ] Cancel mid-run responds at once, keeps finished results, leaves no Mockoon process.
- [ ] Force-quitting Jagra mid-run, then starting it again, cleans up and shows the run as Interrupted.

**Own project**
- [ ] Creating a project in a real app repository creates only `.jagra/`.
- [ ] New flow creates a working flow from the template.
- [ ] A secret used in a flow is asked for, used, and never visible in any screen, log or report.
- [ ] An app with `FLAG_SECURE` on, failing a flow, shows the black screenshot notice (`RES-5`, D-52).

**Agents** (with at least two different agents, one of them ACP)
- [ ] The first-use notice appears once per project.
- [ ] A request produces a flow, the review run marks every step, and the failure note makes sense.
- [ ] Ask agent to fix continues the same session.
- [ ] An agent change outside `.jagra/flows` triggers the warning, and Restore works without undoing the user's earlier changes.

**Language and look**
- [ ] Every screen in English and Indonesian, light and dark mode.

**Updates**
- [ ] Windows updates from the previous release. macOS shows the notice.

---

## Security checks

**Every pull request:** Dependabot alerts, GitHub secret scanning, and the Electron security settings test from layer 1.

**At milestones:** the Cloudflare security-audit skill (`github.com/cloudflare/security-audit-skill`), run with Claude Code:

1. After the agent integration is done (`plan.md` M10).
2. After packaging and updates are done (M11).
3. At least twice before 1.0.0, because a single pass finds only part of what repeated passes find.

Give the audit these areas to look at in particular: the Electron main, preload and renderer split; custom agent commands; agent permission handling and prompt injection through code in the user's repository; the safety net; secret storage and masking; the update path and release pipeline. Findings marked "needs validation" are checked by hand. Every finding is either fixed or recorded with a reason before the release.

---

## Is it useful?

Not part of the release criteria, but the reason Jagra exists:

- The team uses Jagra on every build of one real app for four weeks in a row.
- Developer testing time per build goes down compared with manual testing. The team records manual testing time per build before starting to use Jagra, so there is something to compare against.
