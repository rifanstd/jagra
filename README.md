# Jagra

[Bahasa Indonesia](README.id.md)

Jagra is a desktop app for Windows and macOS that tests an Android build before it goes to QA. Point it at your app and press Run. It installs the newest debug APK on an emulator or a USB phone, plays your saved [Maestro](https://maestro.dev) flows one by one, and shows what passed, what failed, and a screenshot of where it broke.

Flows are plain Maestro YAML kept in a `.jagra` folder inside your app's repository, so the team shares them through git and they also run with the normal Maestro CLI. Mockoon is optional. A coding agent already installed on your machine, such as Claude Code, can help write flows, but pass or fail always comes from Maestro.

## Status

Jagra is not ready to use yet. Nothing can be installed, and the repository holds only the project setup and the design documents. The build order is in [`docs/plan.md`](docs/plan.md).

## License

[MIT](LICENSE), created by Rifan Setiadi.
