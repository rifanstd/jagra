# Rules for agents in the sample app

- Log in with `parts/login.yaml` instead of repeating the login steps.
- The demo account (`demo`, password `jagra123`) only exists in this sample app, which is why `parts/login.yaml` writes it as plain text. Any other password goes in a variable.
- Item names, quantities and descriptions come from `app/src/main/assets/items.json`. Use them exactly as written there.
- Screen texts are in `app/src/main/res/values/strings.xml`.
