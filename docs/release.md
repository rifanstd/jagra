# Jagra release process

## Version numbers

Jagra uses Semantic Versioning: `MAJOR.MINOR.PATCH`.

| Change | Example | When |
|---|---|---|
| PATCH | 1.4.2 → 1.4.3 | Bug fixes only |
| MINOR | 1.4.2 → 1.5.0 | New features that do not break how things worked before |
| MAJOR | 1.4.2 → 2.0.0 | Changes that break how things worked before, for example a new `.jagra` format that needs old flows changed |

Versions `0.x` are the trial period: the team, then a few developers outside it. They are marked as pre-releases on GitHub. `1.0.0` is the first public release that meets every release criterion in `test-plan.md`.

The desktop app, the CLI package on npm and the `core` package always share one version number.

## The `.jagra` format

`config.yaml` holds `format: 1`. The format number only goes up when a change to `.jagra` would stop an older Jagra from reading a folder correctly. When that happens, the new Jagra must recognise older formats and offer to convert them. An older Jagra that sees a newer format refuses to touch the folder and asks the user to update (`PRJ-9`). A format change is always a MAJOR release.

## Release steps

1. Update `CHANGELOG.md` and the version number in every package.
2. Make sure layers 1 and 2 pass in CI on Windows and macOS.
3. Run the layer 3 checklist from `test-plan.md` on Windows and macOS with a build of this version.
4. For releases that include the milestones listed in `test-plan.md`, make sure the security audit was run and its findings handled.
5. Push a version tag, for example `v0.1.0`. GitHub Actions builds the signed Windows installer and the macOS build (Apple silicon and Intel) and creates a **draft** GitHub release with them, the sample APK, and the notes from `CHANGELOG.md`.
6. Download the installers from the draft and install them once more on both systems.
7. Publish the release, marking it as a pre-release for `0.x`. Publish the CLI package to npm with the same version.

Builds are always made by GitHub Actions, never on a personal machine, so every release is built the same way and signing happens in one place.

## Channels

- Users on a stable version are offered stable versions only.
- Users on a pre-release are offered newer pre-releases and stable versions.

On Windows, updates download in the background and Jagra asks when to restart. On macOS, Jagra shows a notice with a link to the release page until the macOS build is signed.

## Signing

- **Windows:** signed in GitHub Actions through a free code signing service for open source projects (for example SignPath Foundation). The application is made as soon as the repository is public.
- **macOS:** not signed in version 1. The README explains how to open an unsigned app (System Settings, Privacy & Security, Open Anyway). Signing and notarisation come when Jagra has enough users to justify the Apple Developer Program fee. Automatic updates on macOS start then.

## Changelog

`CHANGELOG.md` is in English. Every version has a heading with the version and date, and up to three sections:

```
## 0.2.0 (2027-01-15)

### Added
- ...

### Changed
- ...

### Fixed
- ...
```

Write entries for users, not for developers: what they will notice, not which file changed. The same text becomes the GitHub release notes. Minor known bugs that ship with a release are listed under a "Known issues" section.

## When a release goes wrong

Fix forward. Publish a PATCH release with the fix rather than deleting a release that users may already have updated to. If a release is dangerous (data loss, secrets exposed), also mark it clearly as broken in its release notes and in the README until the fix is out.
