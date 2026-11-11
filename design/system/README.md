# Jagra design system

Jagra's interface is built with React, Tailwind CSS v4 and shadcn/ui. The look comes from one file, `theme.css`, which holds every color, font, radius and shadow token for light and dark mode.

## Source

The theme is the tweakcn theme "AstroVista":

```
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/cmlk6zefr000004lbe9jygsqc
```

`theme.css` is that theme written out by hand, plus two Jagra additions (`success` and `warning`) and contrast fixes to some of tweakcn's values (`decisions.md` D-41). If the theme is ever updated from tweakcn, keep both.

## Rules

`theme.css` is the only place theme values live. The desktop app imports this file directly. Mockups in `design/screens/` link to it too. Never copy a token value into a component, a stylesheet or a config file. If a component needs a color, it uses the token (`bg-primary`, `text-destructive`, `var(--border)`).

Use shadcn/ui components before writing custom ones. Buttons, dialogs, inputs, selects, tabs, tooltips and toasts all come from shadcn/ui and pick up the theme automatically.

## Color roles

| Token | Use it for | Never use it for |
|---|---|---|
| `primary` (orange) | The main action on a screen: Run, Create project, Save flow | Any kind of status |
| `secondary` (navy) | Secondary actions and selected navigation items | Status |
| `destructive` (red) | Failed flows, errors, destructive actions such as Discard | Anything that is not an error or a removal |
| `success` (green) | Passed flows, healthy environment checks | Buttons |
| `warning` (amber) | Tool versions not yet tested, interrupted runs, cancelled flows, soft warnings | Errors that block the user |
| `muted`, `muted-foreground` | Secondary text, timestamps, flows waiting in the queue | Anything the user must read to act |
| `input` | The border of text fields and selects | Card borders and dividers, which use `border` |

Orange and red sit close together on the color wheel. That is why `primary` is never used to show status, and why a red failure mark never sits on an orange background.

## Contrast

Every text color reaches 4.5:1 against `background`, `card` and `muted`, and every `*-foreground` reaches 4.5:1 on its own color, in both modes. `input` and `ring` reach 3:1 against `background` and `card`. `border` is lighter on purpose, because cards and dividers are not controls. Check any new or changed token against these pairs before using it.

## Status is never color alone

Every status shows an icon and a word, with color as a third signal:

| Status | Icon | Label (EN / ID) | Token |
|---|---|---|---|
| Passed | ✓ | Passed / Lolos | `success` |
| Failed | ✕ | Failed / Gagal | `destructive` |
| Running | spinner | Running / Berjalan | `foreground` |
| Waiting | ○ | Waiting / Antre | `muted-foreground` |
| Interrupted | ! | Interrupted / Terputus | `warning` |
| Cancelled | – | Cancelled / Dibatalkan | `warning` |
| Stopped (a run that stopped because the device was lost or a required step failed) | ! | Stopped / Berhenti | `warning` |
| Not run (a flow the run never reached) | – | Not run / Tidak dijalankan | `muted-foreground` |
| Not tested yet (tool version) | ! | Untested version / Versi belum dites | `warning` |

This keeps Jagra readable for colorblind users and in screenshots pasted into chat or bug reports.

Colored text is only for short status labels next to their icon. Paragraphs, step descriptions and error explanations use `foreground` or `muted-foreground`.

## Fonts

| Token | Font | Use |
|---|---|---|
| `font-sans` | Outfit | All interface text |
| `font-mono` | Fira Code | YAML, file paths, logs, command output, package names |
| `font-serif` | Merriweather | Not used in version 1. Kept so the theme matches tweakcn |

Font files are bundled inside the app. Jagra makes no network calls except the update check, so the app must never load fonts from Google Fonts or any other CDN. Outfit and Fira Code are released under the SIL Open Font License, which allows bundling.

## Light and dark mode

Dark mode uses the `.dark` class on the root element, as shadcn/ui expects. By default Jagra follows the operating system setting. Every screen and mockup must be checked in both modes.

## Spacing, radius and shadows

Use Tailwind's spacing scale, which is based on the theme's `--spacing` of 0.25rem. Use the radius tokens (`rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`) and shadow tokens (`shadow-sm` and so on) from the theme. Do not invent new values.
