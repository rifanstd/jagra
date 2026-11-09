# Sample app

A small Android app that Jagra tests against: a coffee shop's stock room. You sign in, see the stock list, open an item and change its name or quantity. Kotlin and Jetpack Compose.

The `.jagra` folder holds five flows, a login helper, a Mockoon file and example agent rules. Run them and exactly one flow fails, because of a bug planted on purpose.

## The planted bug

The Save button disappears when an item's name is longer than 20 characters. The `save-item` flow renames "Oat milk 1 L" to "Oat milk 1 L, barista edition" (29 characters), can no longer find Save, and fails.

The bug is there so anyone trying Jagra sees a real failure, with its step, reason and screenshot. **Do not fix it.** The limit is `SAVE_BUTTON_NAME_LIMIT` in `app/src/main/java/dev/jagra/sample/ui/ItemDetailScreen.kt`. If you change the app or the flows, the sample must still end with exactly one failed flow (SMP-4).

## Demo account

Username `demo`, password `jagra123`. The account is made up and only exists inside this app, so `.jagra/flows/parts/login.yaml` writes it as plain text. A real app's flows write passwords as variables, such as `${PASSWORD}`, and Jagra keeps the value as a secret.

## Data and Mockoon

The debug build first asks `http://localhost:3000/items`. If nothing answers within 1.5 seconds, it uses the copy inside the APK and shows a "Built-in data" label next to the title. Both come from the same file, `app/src/main/assets/items.json`: the app reads it as an asset, and `.jagra/mockoon.json` serves it as a file body. Every flow gives the same result with or without Mockoon.

Only the debug build calls the network. It has the `INTERNET` permission and allows plain HTTP to `localhost` through `src/debug/res/xml/network_security_config.xml`. The release build has neither and always uses the built-in data.

## Build

You need JDK 17 or newer and the Android SDK with API 37 (Android Studio installs both). Open this folder in Android Studio, or run:

```
./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug`, where `.jagra/config.yaml` tells Jagra to look.

## Run the flows without Jagra

The flows are plain Maestro flows. With an emulator running and the APK installed (`adb install -r app/build/outputs/apk/debug/app-debug.apk`), from this folder:

```
maestro test .jagra/flows
```

With Mockoon, start it first and forward the port to the emulator:

```
mockoon-cli start -d .jagra/mockoon.json -p 3000
adb reverse tcp:3000 tcp:3000
maestro test .jagra/flows
```

Both runs end with four flows passed and `save-item` failed.

## Theme

Colors, radius and the Outfit font come from Jagra's design system in `design/system/theme.css` and `design/fonts`. `app/src/main/java/dev/jagra/sample/ui/theme/Tokens.kt` and `app/src/main/res/font/outfit.ttf` are generated from them. Do not edit them. After changing the theme, run `pnpm theme:sample` from the repository root. `pnpm lint` fails when they are out of date.
