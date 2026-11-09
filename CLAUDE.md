# Jagra

Jagra is an open source desktop app (Windows and macOS) that tests Android builds before they go to QA. It runs saved Maestro flows on an emulator or a USB phone, optionally with Mockoon, and shows what passed and what failed. A local AI agent can help write flows. Electron and TypeScript, in a pnpm monorepo.

## Current state

- Current milestone: **M3** (see `docs/plan.md`). Update this line when a milestone is approved.

## Read before working

| File | Read it when |
|---|---|
| `docs/product.md` | First, once. Why Jagra exists and its principles |
| `docs/spec-v1.md` | Before any feature. Requirements have IDs like `RUN-7` |
| `docs/architecture.md` | Before adding a module, a port, an IPC call or a dependency |
| `docs/decisions.md` | Before changing anything that looks odd. Most odd things are deliberate |
| `docs/plan.md` | At the start of every session, to see what the current milestone needs |
| `docs/test-plan.md` | When writing tests and before any release |
| `docs/release.md` | When preparing a release |
| `docs/to-verify.md` | Before relying on any command, flag, version or library behaviour |
| `design/system/README.md` | Before any interface work |
| `design/screens/`, `design/wireframes.html` | When building a screen |

The docs in this repository are the source of truth. If the code and the docs disagree, or something is not covered, stop and ask. Do not guess.

## Rules that must never be broken

1. **The agent writes, Jagra runs, Maestro judges.** Agents only write files inside `.jagra/flows`. They never run flows, Maestro, `adb` or any command, and never decide pass or fail. Jagra never asks an agent to fix and retry on its own. (`D-04`, `D-05`)
2. **Never touch agent logins.** Never read agent credential files, tokens or API keys, never offer a login. Call agents only through their official programs or ACP. (`D-06`, `D-07`)
3. **No shell.** Start every external program with a program name and an argument list. Never build a command string for a shell. (`SEC-8`, `D-21`)
4. **The renderer stays isolated.** Context isolation on, Node integration off, sandbox on, for every window. Never turn these off, not even temporarily. The renderer talks to main only through the preload API, and main validates every call. (`SEC-6`, `D-19`)
5. **Outside text is text.** Flow files, Maestro output, agent messages and app errors are rendered as text, never as HTML. (`SEC-7`)
6. **No network** except the update check. No telemetry. No fonts or assets from a CDN. (`SEC-1`, `SEC-2`)
7. **Secrets** are stored only through `SecretStore`, never in plain files, and masked in every screen, log and report. (`SEC-3`, `SEC-4`)
8. **`core` never imports Electron, React, `cli` or `desktop`.** CI enforces this. (`D-18`)
9. **Never write in a user's project folder outside `.jagra`**, except a Restore the user asked for in the safety net. Never change the user's Mockoon file. (`PRJ-11`, `MCK-1`)
10. **Never install, update or remove tools** on the user's machine, and never ask for admin rights. (`ENV-9`, `SEC-5`)

## Conventions

- TypeScript strict everywhere. No `any` without a comment explaining why.
- Code, comments, commit messages, pull requests and log messages are in English.
- `core` returns error codes with parameters, never sentences. The renderer and the CLI turn codes into text. (`D-20`)
- Every piece of interface text lives in the translation files, in English and Indonesian. No text written directly in components. (`LNG-1`)
- Colors, fonts, radius and shadows come only from `design/system/theme.css` through Tailwind tokens. Never copy a token value. Use shadcn/ui components first.
- Status is shown with an icon and a word, never color alone. `primary` (orange) is for main actions only, never for status. (`design/system/README.md`)
- Long operations take an `AbortSignal`. Cancel, Ctrl+C and timeouts all use it.
- Modules call ports, not programs. New external programs get a port in `core/src/ports` and an adapter in `core/src/adapters`, plus a fake for tests.
- Folder and field names Jagra writes into users' repositories are English (`.jagra/flows/parts`, `properties.condition`). (`D-10`)

## How to work

- Talk to the project owner in Indonesian: plans, questions, explanations and summaries. Code, comments, commit messages, pull request titles and descriptions, and files in `docs/` stay in English.
- One milestone at a time, in the order of `docs/plan.md`. Do not start the next milestone until the owner approves the current one.
- Never commit to `main` directly. Work on a branch named after the milestone, for example `m0-repo-setup` or `m10-acp-agents`, and open a pull request to `main`.
- Use the antislop skills in `during` mode for all work, when they are installed: `antislop` at the start of every task, `antislop-code` for code and comments, `antislop-copywriting` for docs, READMEs and interface text, and `antislop-ui`, `antislop-human` and `antislop-layoutmobile` for interface work.
- antislop filters the owner's direction, it does not replace it. When antislop disagrees with `docs/` or `design/` (for example SET-2 has no theme switch, and shadcn/ui ships Lucide icons), name the element and the rule, ask the owner to keep or drop it, and record the answer in `docs/decisions.md`. Never change the owner's design on your own.
- Every pull request lists the requirement IDs it covers.
- Write tests with the code (layers in `docs/test-plan.md`). A feature without its tests is not done.
- Do not add features, settings or dependencies the spec does not ask for. If one seems needed, ask.
- Before using a command, flag or library behaviour listed in `docs/to-verify.md`, check it and fill in "Found". If it changes a decision, stop and ask.
- When a decision changes, add a new entry to `docs/decisions.md` instead of editing the old one, and update the spec.
- Keep this file short. Detail belongs in `docs/`.

## Commands

Set up in M0. Keep this list correct as the repository grows.

```
pnpm install
pnpm lint                   ESLint, the package dependency rules, Prettier check, sample theme check
pnpm format                 Prettier write
pnpm typecheck
pnpm test
pnpm --filter jagra build   the CLI package is named `jagra` (CLI-6)
pnpm --filter @jagra/core test:tools   check the tools on this machine (not in CI)
pnpm theme:sample           regenerate the sample app's theme after changing design/
cd sample-app && ./gradlew assembleDebug   build the sample APK
pnpm --filter desktop dev   from M7
```

## Repository layout

```
packages/core      all of Jagra's work, no Electron
packages/cli       the `jagra` command
packages/desktop   Electron app: main, preload, renderer
sample-app/        Android sample app (Kotlin), built with Gradle
scripts/           repository scripts (the sample app's theme generator)
design/            theme, fonts, mockups, wireframes
docs/              product, spec, architecture, decisions, plan, tests, release, to-verify
```
