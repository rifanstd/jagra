# Jagra: product brief

Jagra is a desktop app that tests an Android build before it goes to QA. You point it at your app, press Run, and it plays your saved test flows on an emulator or a phone, then shows what passed, what failed, and a screenshot of where it broke.

This file explains why Jagra exists and what it is trying to be. The detailed behaviour lives in `spec-v1.md`. Reasons behind specific choices live in `decisions.md`.

## The problem

Mobile teams usually test their own work before handing a build to QA. It happens for interim builds, full builds, and every new feature. Someone installs the app, opens it, and taps through every feature, either against the real backend or against a mock backend in Mockoon. Only when nothing looks broken does the build go to QA.

This has two costs. It takes hours of developer time per build. And because a person is doing it from memory, things get skipped: the screen nobody touched this sprint, the error state that only shows when the server fails, the feature that broke because it shares code with the one that changed.

## What Jagra does

Each app gets a set of test flows written in Maestro's YAML format. The flows live in a `.jagra` folder inside the app's own repository, so the whole team shares them through git and they change in the same pull request as the code they test.

When a new build is ready, Jagra picks up the newest debug APK, installs it on the chosen emulator or USB phone, starts Mockoon if the project uses it, and runs every flow. Each flow starts from a clean app. If one fails, Jagra records why and moves on to the next. At the end you get a summary, the failing step for each failed flow, a screenshot, any crash report, and an HTML report you can send to QA.

Writing flows can be done by hand or with help from an AI coding agent that is already installed on the developer's laptop, such as Claude Code, Codex, Gemini CLI, OpenCode or Oh My Pi. You describe a scenario in plain language. The agent reads the app's code and writes the flow file. Jagra then runs it and shows each step with a pass or fail mark, plus a guess at whether a failure looks like a mistake in the flow or a bug in the app. You decide whether to keep it, ask the agent to fix it, or throw it away.

## Who it is for

The main user is a mobile developer who tests builds before handing them to QA, usually as part of a team that will share flows through git. Native, Flutter and React Native apps all work, because Jagra tests what is on the screen, not how the app was built.

QA engineers can use Jagra too, even with only an APK and no source code. They can write flows by hand or with an agent, but the agent cannot suggest extra test cases from the code.

Jagra is not a good fit for apps that draw their own interface, such as games, because Maestro reads the text and buttons on screen. iOS is not supported in version 1.

## Principles

AI writes tests. It never decides whether a test passed. Pass or fail always comes from the assertions inside the flow, run by Maestro, so the same build gives the same result every time.

Everything works without AI. If a developer has no agent installed, the only thing missing is the button that asks an agent to write a flow.

Nothing leaves the laptop. Jagra makes no network calls except checking GitHub for a new version, and it has no telemetry. Secrets are kept in the operating system's credential store and masked everywhere they would appear. When an agent is used, the agent sends code to its own provider, and Jagra tells the user about this the first time.

Flows stay plain Maestro. They run with the normal Maestro CLI outside Jagra, so nobody is locked in.

The simple path comes first. A project with no Mockoon and no agent must work fully. Anything more advanced is opt in.

## How Jagra is different

Writing Maestro flows with AI is already possible without Jagra. Maestro has its own desktop studio, coding agents can drive Maestro directly, and Google offers an AI testing agent in Firebase that takes goals in plain language and runs them in the cloud. Jagra does not try to beat these at generating tests.

Jagra is built around one moment: the developer's last check before handing a build to QA. Version 1 lays the ground for that with local projects shared through git, a choice of any local agent, results that do not change between runs, and a report QA can read.

Two features planned for version 2 are what should make Jagra worth choosing:

1. **Change awareness.** Jagra reads what changed in a build and points to the features that need testing, the flows that should run, and the features that have no flow at all.
2. **Backend conditions.** One flow runs against several responses from Mockoon, such as success, server error and empty data, because error states are the ones manual testing skips most often.

The version 1 README should name both as the direction of the project.

## Version 1 in short

Windows and macOS app with a basic `jagra` command line. Android only, from an APK picked up from the debug build output. Emulator or USB phone, one device per run. Optional Mockoon using the user's existing file as it is. Flows written by hand or by a local agent. Automatic updates on Windows and an update notice on macOS. Open source on GitHub, with a signed Windows installer and an unsigned macOS build for now.

The full list of what is in and out of version 1 is in `spec-v1.md`.

## How we will know it worked

A version is only released when it meets the release criteria in `test-plan.md`: every feature meets its definition of done, automated tests pass, a manual run on Windows and macOS with the sample app passes, and there are no known severe bugs.

Two further checks tell us whether Jagra solves the original problem. They do not block a release:

1. The team uses Jagra on every build of one real app for four weeks in a row.
2. Developer testing time per build goes down compared with testing by hand. To have something to compare against, the team records how long manual testing takes per build, starting now.

## Name and ownership

Jagra comes from the Sanskrit *jāgara*, meaning awake or keeping watch. The Indonesian word *jaga* shares the same root. Jagra is the one keeping watch before a build leaves the team.

Jagra is created by Rifan Setiadi and released under the MIT license. The repository starts in the creator's personal GitHub account. The organization `jagra-dev` is reserved for a later move if the project grows. Code, comments, commits and the main README are in English. A README in Indonesian (`README.id.md`) sits next to it, and the app ships in English and Indonesian.
