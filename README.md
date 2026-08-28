# Majlis Bayangan — Pure HTML/CSS/JavaScript

This is the complete deployable website. It uses no React, Next.js, npm packages, build command, or Firebase SDK.

## Files

- `index.html` — website structure
- `styles.css` — complete responsive design
- `game.js` — missions, role assignment, powers, voting, and victory engine
- `app.js` — interface, Firebase REST connection, registration, and admin controls
- `firebase-config.js` — the three Firebase values you must replace

## Configure Firebase

Open `firebase-config.js` and replace:

```js
apiKey: "YOUR_FIREBASE_WEB_API_KEY",
databaseURL: "YOUR_REALTIME_DATABASE_URL",
adminEmail: "YOUR_OVERSEER_EMAIL",
```

Never put the Overseer password into a file. Create the password in Firebase Authentication and type it only on the Overseer login screen.

## Run locally

You can use the VS Code **Live Server** extension:

1. Open this `vanilla` folder in VS Code.
2. Right-click `index.html`.
3. Select **Open with Live Server**.

Without Firebase values, the website automatically enters local setup mode. Use `F4nz2005` and any non-empty temporary password, then load 35 demo participants.

## Deploy

From the project root—the folder containing `firebase.json`—run:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only database,hosting
```

Firebase Hosting publishes the `vanilla` folder directly. No build step is required.

