# Jagra decisions

This file records the choices behind Jagra that are deliberate, and why. Some of them look like mistakes or missing features from the outside. Before "fixing" anything listed here, read the reason. To change a decision, add a new entry that replaces the old one and say why; do not edit history.

Format of each entry: what was decided, why, and what was considered instead.

---

## Product

### D-01. Windows and macOS, Android only, in version 1
**Decided:** Jagra runs on Windows and macOS. It only tests Android apps in version 1.
**Why:** iOS testing needs Xcode, which only runs on macOS, and adds a second device stack. Android works on both systems. Many mobile developers use Macs, so a Windows-only app would shut most of them out, and running the Android path on macOS costs little extra.
**Instead:** Windows only (rejected: loses Mac users), iOS in version 1 (rejected: too much for a first version).

### D-02. The input is an APK, not source code to build
**Decided:** Jagra takes a finished APK, found automatically in the debug build output or picked by hand. It does not build the app.
**Why:** Building is the most fragile part (flavors, environments, Gradle versions, signing). Developers already build in Android Studio.
**Instead:** Building from the project folder (moved to a later version).

### D-03. Everything works without AI
**Decided:** AI is an optional layer. With no agent installed, only the "Create flow with AI" button is unavailable.
**Why:** Test results must be repeatable, private and free to produce. Requiring AI would make every run cost tokens, depend on the network and send code outside.
**Instead:** AI required (rejected), no AI at all (rejected: leaves the "things get missed" problem untouched and makes writing flows the bottleneck).

### D-04. The agent writes, Jagra runs, Maestro judges
**Decided:** The agent only writes flow files. It never runs a flow, never runs Maestro or `adb`, and never decides whether a test passed. Jagra runs every flow, including the first try of a new one, and Maestro's assertions decide pass or fail.
**Why:** An earlier version of the design let the agent try its own flow while writing it. That made the agent's trial and the real test identical in practice, blurred who was testing, and gave the agent a chance to edit a check until it passed, which hides real bugs.
**Instead:** Agent tries and fixes its own flow (rejected for the reasons above).

### D-05. No automatic fix loop
**Decided:** When a new flow fails, the user decides whether it is a flow problem or an app bug. Every call to an agent starts from a user action. Jagra never asks the agent to fix and retry on its own.
**Why:** An automatic loop can turn an app bug into a "passing" test by changing the check. It also uses the user's agent quota in the background, which is the usage pattern providers are most wary of.
**Instead:** Retry until green (rejected).

### D-06. Only the user's own local agent, through the front door
**Decided:** Jagra uses agents already installed on the user's machine. It runs their official programs, exactly as a user would in a terminal. It never handles logins, tokens or API keys, never reads an agent's credential files, and never offers a login of its own.
**Why:** No API keys or AI costs for Jagra, any agent works, and it stays within provider rules. Providers forbid taking login tokens out of their programs to call their servers directly; Jagra never does that.
**Instead:** Jagra calling AI APIs with its own key (rejected: cost and key handling), a "Sign in with Claude" style login (forbidden by Anthropic for third-party tools).

### D-07. Claude Code and Codex through their own command lines, other agents through ACP
**Decided:** Claude Code is called with `claude -p` and Codex with `codex exec`. Gemini CLI, OpenCode, Oh My Pi and other agents that support it are used through ACP.
**Why:** Gemini CLI, OpenCode and Oh My Pi ship ACP themselves. Claude Code and Codex only reach ACP through third-party adapters. For Claude, that adapter is built on the Agent SDK, the area Anthropic regulates most strictly for third-party use. Their official command lines are the documented way to call them from other programs.
**Instead:** ACP for every agent (rejected for Claude Code and Codex).

### D-08. Flows are plain Maestro
**Decided:** Flows are standard Maestro YAML. Jagra's own data goes in the `properties` map of the flow header. `properties.condition` is reserved for backend conditions in a later version.
**Why:** Anyone who knows Maestro can write flows at once, flows run in CI with plain Maestro, and nobody is locked in to Jagra.
**Instead:** A Jagra flow format (rejected).

### D-09. Shared data in the repository, personal data on the machine
**Decided:** Flows, helper flows, the Mockoon file, `config.yaml` and `agent-rules.md` live in `.jagra` inside the app's repository. APK path, device, agent choice, secrets, history and logs stay on the user's machine.
**Why:** A teammate who pulls the repository gets a ready project. Flows change in the same pull request as the code they test. Personal and large data stays out of git.
**Instead:** Everything inside Jagra (rejected: nothing shared), everything in the repository (rejected: secrets and screenshots in git).

### D-10. English names inside repositories
**Decided:** Folder and field names that Jagra puts in a user's repository are English: `.jagra/flows/parts`, `properties.condition`, `agent-rules.md`.
**Why:** Jagra is open source and these names appear in other people's repositories. The design notes used Indonesian names (`flows/bagian`, `kondisi`), which were renamed before any code.

### D-11. Jagra clears app data before every flow
**Decided:** Before each flow, Jagra clears the app's data on the device. The flow template also starts with `launchApp` and `clearState: true`.
**Why:** Flows must never depend on each other. If one flow logs in and the next silently relies on it, one failure causes another and flow order starts to matter. Relying on the template alone breaks the moment someone removes that line. The template line remains so flows behave the same with plain Maestro.

### D-12. Maestro runs once per flow
**Decided:** Jagra calls Maestro separately for each flow.
**Why:** It gives Jagra control over the time limit, Cancel, clearing data before each flow and saving each result straight away. The cost is that Maestro writes one report per flow, so Jagra adds a small index page that links them.
**Instead:** One Maestro call for the whole folder (rejected: no per-flow control).

### D-13. A failure never stops the run
**Decided:** Failed, crashed and timed-out flows are recorded and the run continues. Only Cancel, a lost device or a broken environment stops a run.
**Why:** The point of a run is to see every problem at once, not fix one, rerun, and find the next.

### D-14. One run at a time, one device per run
**Decided:** Jagra runs one run at a time across all projects, on one device.
**Why:** Simpler progress, results and reports, and no two runs fighting over the same emulator. Maestro already supports running on several devices, so this can come later without a new engine.

### D-15. Mockoon: none, or the user's file as it is
**Decided:** Version 1 supports projects without Mockoon and projects with an existing Mockoon file, unchanged. Running one flow under several backend conditions comes later.
**Why:** People use Mockoon in very different ways. The simple case must work for everyone first. Backend conditions are one of Jagra's two planned differentiators and get their own version.

### D-16. Jagra never installs tools
**Decided:** Jagra checks for Java, `adb`, Maestro, Mockoon CLI and agents, explains what is missing and how to install it, and never installs, updates or removes anything.
**Why:** Installers differ per system, often need admin rights, and can leave a machine in a broken state. Bundling Maestro is possible later if setup turns out to be the main reason people give up.

---

## Technology

### D-17. Electron with TypeScript
**Decided:** The desktop app is Electron with TypeScript. The interface is React, Tailwind CSS v4 and shadcn/ui.
**Why:** Most of Jagra's work is running other programs and reading their output, where Node.js is strongest. Electron is proven on Windows and macOS (VS Code, Slack, and the Mockoon desktop app itself), with mature tools for installers, updates and signing. TypeScript has the largest pool of open source contributors. The tweakcn theme targets shadcn/ui.
**Instead:** Flutter desktop (rejected: strong at interfaces, weaker at process work; fewer large desktop apps), Tauri (rejected: core logic would ideally be Rust, fewer contributors).

### D-18. Monorepo with a core that has no Electron
**Decided:** One repository with `core`, `cli` and `desktop` packages. `core` cannot depend on Electron or React, enforced by a lint rule in CI.
**Why:** One feature usually touches several packages, they share types, and an AI coding agent sees everything in one session. The package boundary keeps the core usable from the command line and testable without a window.
**Instead:** Separate repositories (rejected), one package with no boundaries (rejected: the core/UI split would only be a promise).

### D-19. The renderer is isolated, always
**Decided:** Context isolation on, Node integration off, sandbox on. The renderer talks to the main process only through a small named API, and main checks every request.
**Why:** Jagra shows a lot of text from outside: flow files from repositories the user may not own, Maestro output, agent messages. If any of it ever ran as code in a renderer with Node access, it could take over the user's machine. These settings must never be turned off to make development easier.

### D-20. The core returns error codes, not sentences
**Decided:** `core` reports errors as codes with parameters. The renderer and the CLI turn them into text.
**Why:** The interface ships in English and Indonesian. Sentences written in the core would always be English.

### D-21. External programs are never started through a shell
**Decided:** Every program Jagra starts gets a program name and an argument list. Custom agent commands are split into arguments when saved, and placeholders are filled in as separate arguments.
**Why:** A scenario or a file name containing shell characters must never run an extra command.

---

## Privacy and security

### D-22. No network except the update check
**Decided:** Jagra's only network request is the update check to GitHub. No telemetry. Fonts and assets are bundled.
**Why:** Jagra is likely to be used on company apps, including banking apps. Users need to trust that nothing leaves their machine through Jagra.

### D-23. Secrets in the operating system's credential store
**Decided:** The desktop app stores secret values encrypted with a key from the operating system's credential store. The CLI reads them from `JAGRA_SECRET_<NAME>` environment variables. Secrets are masked everywhere.
**Why:** Flows go into git, so passwords can never be written in them, and a plain settings file is not safe enough.

### D-24. Security audits at milestones
**Decided:** The Cloudflare security-audit skill runs after the agent integration is done, after automatic updates are done, and more than once before 1.0.0. Day to day, Dependabot, GitHub secret scanning and Electron security checks in the test suite run automatically.
**Why:** The audit is thorough but heavy, and a single pass finds only part of what repeated passes find. Cheap automated checks cover the gaps between audits.

---

## Release and project

### D-25. Signed on Windows, unsigned on macOS for now
**Decided:** Version 1 ships a signed Windows installer (through a free open source signing service such as SignPath Foundation) and an unsigned macOS build. Windows updates automatically; macOS shows a notice with a download link.
**Why:** An unsigned Windows installer shows a warning that scares users. Signing on macOS needs a paid Apple Developer account, which is worth it once Jagra has many users. Automatic updates on macOS need a signed app.

### D-26. Release criteria are separate from usefulness checks
**Decided:** A version ships only when it meets the release criteria in `test-plan.md`. Whether Jagra actually saves the team time is checked separately and does not block a release.
**Why:** "Built correctly" and "actually useful" are different questions. Both matter; only the first can block a release.

### D-27. Name, license and repository
**Decided:** The project is called Jagra, from the Sanskrit *jāgara*, keeping watch. MIT license. The repository starts in the creator's personal GitHub account; the organization `jagra-dev` is reserved for a later move. The npm package name is `jagra`.
**Why:** The name is short, does not describe the function, and was not used by any comparable tool. Its npm name was free. The GitHub account `jagra` was taken, hence `jagra-dev`. Starting in the personal account keeps the creator visible, like fzf or lazygit; a later transfer keeps old links working.

### D-28. The repository's docs are the source of truth
**Decided:** Once the repository exists, `docs/` and `design/` in the repository are the only source of truth. Design discussions outside the repository end in a change to these files.
**Why:** Decisions that live only in a chat never reach the code.

---

## Added during implementation

### D-29. `yaml` for reading YAML
**Decided:** `config.yaml` and flow files are read with the `yaml` package.
**Why:** It keeps the position of every node, so errors can name the file, line and column (`PRJ-10`, `FLOW-6`). It reads a flow's header and steps as two YAML documents, follows YAML 1.2 like Maestro, and reports duplicate keys.
**Instead:** `js-yaml` (rejected: no positions for values, only for syntax errors).

### D-30. `zod` for the `config.yaml` schema
**Decided:** The `config.yaml` schema is written once with `zod`, which reads, fills defaults and explains errors.
**Why:** One definition covers types, defaults and messages. Its loose objects keep unknown fields, as the format rules require (`architecture.md` section 3).
**Instead:** Hand-written checks (rejected: defaults and checks drift apart).

### D-31. `.bat` and `.cmd` programs are refused on Windows
**Decided:** On Windows, `ProcessRunner` only starts `.exe` and `.com` files. A program that turns out to be a `.bat`, `.cmd` or other script returns the error code `PROGRAM_IS_SCRIPT`. Programs are found on `PATH` only, never in the working folder.
**Why:** Node.js refuses to start `.bat` and `.cmd` files without a shell since the fix for CVE-2024-27980, and starting them through `cmd.exe` brings back the argument injection that D-21 rules out. Searching the working folder, as Windows does by default, would let a project plant a program called `maestro.exe`.
**Consequence:** Maestro installs as `maestro.bat` on Windows, and tools installed with npm (Mockoon CLI, several agents) are `.cmd` shims. How each one is started without a shell is decided per tool in M2, once the install layout is confirmed (`to-verify.md`).
**Instead:** `cmd.exe /d /s /c` with escaped arguments (rejected: the escaping rules are the source of the CVE).

### D-32. Steps carry the command, not a sentence
**Decided:** A parsed `Step` holds its kind (`action` or `check`), the Maestro command, its arguments as written and its line. The renderer and the CLI write the plain language text.
**Why:** D-20. A sentence built in `core` would only ever be in English.

### D-33. Flows may not use Maestro's AI commands
**Decided:** A flow that uses `assertWithAI`, `assertNoDefectsWithAI` or `extractTextWithAI` fails the format check and is left out of runs (`FLOW-10`). The same applies to helper flows and hooks.
**Why:** Pass or fail must come from Maestro's own checks, so the same build gives the same result every time (`product.md`). These commands let an AI model decide a result or supply a value that a check then uses, and they send screenshots to an AI service.
**Instead:** Running them with a warning, or treating them as normal checks (both rejected: the result would no longer be repeatable).

### D-34. Maestro and Mockoon CLI are started through their runtimes on Windows
**Decided:** On Windows, Jagra finds `maestro.bat` and starts the Java that Maestro's launcher would use (`JAVA_HOME`, then `PATH`, or the path set in Settings) with `--enable-native-access=ALL-UNNAMED -classpath <maestro>\lib\* maestro.cli.AppKt` and the arguments. For Mockoon CLI it finds `mockoon-cli.cmd`, reads the entry file from the `bin` field of `node_modules\@mockoon\cli\package.json` next to it, and starts Node with that file, preferring a `node.exe` next to the shim as npm's shim does. On macOS the Maestro script is started directly, and Mockoon CLI's npm link is followed to the entry file, which Node starts.
**Why:** D-31 refuses `.bat` and `.cmd`. Maestro 2.12.1's `maestro.bat` does nothing more than this Java call, and npm's shim nothing more than this Node call (both read on 2026-11-07). Going through the runtimes keeps every argument out of `cmd.exe`.
**Consequence:** Maestro's launcher options `JAVA_OPTS` and `MAESTRO_OPTS` are not read on Windows. If a future Maestro release changes its launcher, this call must follow; the tested version range (`ENV-3`) is where that shows up.
**Instead:** Allowing `cmd.exe` for these two tools (rejected: D-21).

### D-35. A fifth tool state: Can't start
**Decided:** `ToolStatus` gains the state Can't start, for a tool that is found but does not run, with a reason: needs Java, needs Node, timed out, or failed. It also says whether the tool is required. `ToolProbe` returns what it saw (`ToolFinding`), and the `environment` module turns that into a state with the version rules. When Maestro fails and Java is missing or too old, the reason given is needs Java.
**Why:** Maestro installed without Java, a broken install or a tool that hangs fit none of the four states in `ENV-2`. Calling them Missing would send the user to reinstall the wrong tool.

### D-36. Maestro runs without analytics and without its update check
**Decided:** Every Maestro process Jagra starts gets `MAESTRO_CLI_NO_ANALYTICS=1`, `MAESTRO_DISABLE_UPDATE_CHECK=true` and `MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true`. The user's own Maestro settings are not touched.
**Why:** By default Maestro sends anonymous analytics and checks for a newer version on every start (Maestro 2.12.1 source). Jagra promises no telemetry (`SEC-1`), and the notices would mix into the output Jagra reads.

### D-37. Where Jagra looks for tools
**Decided:** A path set in Settings wins (`ENV-6`). Otherwise: Java in `JAVA_HOME`, then `PATH`. `adb` and `emulator` in `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then `PATH`, then the default SDK folder (`%LOCALAPPDATA%\Android\Sdk`, `~/Library/Android/sdk`). Maestro and Mockoon CLI on `PATH`, plus `~/.maestro/bin` for Maestro. On macOS `/opt/homebrew/bin` and `/usr/local/bin` are searched after `PATH`. On Windows, every check reads `PATH` and the other variables again from the registry with `reg.exe`.
**Why:** The SDK's own `adb` comes before a copy on `PATH` (scrcpy ships one), so the SDK that Android Studio updates is the one used. A running program keeps the environment it started with, so without the registry read a tool installed while Jagra is open would stay invisible to Check again (`ENV-5`). Apps opened from the Finder get a short `PATH` without Homebrew.
