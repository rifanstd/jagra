# Jagra

[Bahasa Indonesia](README.id.md)

Jagra is a desktop app for Windows and macOS that tests an Android build before it goes to QA. Point it at your app and press Run. It installs the newest debug APK on an emulator or a USB phone, plays your saved [Maestro](https://maestro.dev) flows one by one, and shows what passed, what failed, and a screenshot of where it broke.

Flows are plain Maestro YAML kept in a `.jagra` folder inside your app's repository, so the team shares them through git and they also run with the normal Maestro CLI. Mockoon is optional. A coding agent already installed on your machine, such as Claude Code, can help write flows, but pass or fail always comes from Maestro.

## AI agents and provider terms

Jagra can ask a coding agent that is already installed on your computer, such as Claude Code, Codex, Gemini CLI, OpenCode or Oh My Pi, to write a flow. Jagra starts the agent's own program, the way you would in a terminal, and the agent uses the login you set up in it. Jagra never asks for, reads or stores a login, token or API key, and Jagra itself sends nothing to any AI provider.

To write the flow, the agent reads your project's code and sends it to its provider. Each provider has its own terms for using its agent from other tools, and those terms change. Read your provider's current terms before you use its agent with Jagra, and if this is a work project, check that your company allows sending the code to that provider.

The agent may write only in `.jagra/flows`, and Jagra warns you about any other file it changed. Pass or fail always comes from Maestro.

## Status

Jagra is not ready to use yet. Nothing can be installed, and the repository holds only the project setup and the design documents. The build order is in [`docs/plan.md`](docs/plan.md).

## License

[MIT](LICENSE), created by Rifan Setiadi.
