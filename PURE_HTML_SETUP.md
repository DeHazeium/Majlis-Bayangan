# Pure HTML/CSS/JavaScript setup

## What changed

The live website now uses only four source files in the `vanilla` folder:

1. `index.html`
2. `styles.css`
3. `game.js`
4. `app.js`

There is no React, Next.js, TypeScript, bundler, or Firebase JavaScript package in the deployed website.

## Firebase Console

1. Create a Firebase project.
2. Add a Web app and copy its Web API key.
3. Create Realtime Database in Locked mode and copy its URL.
4. Enable Anonymous Authentication.
5. Enable Email/Password Authentication.
6. Create one email/password user for the Overseer.

## Website configuration

Edit `vanilla/firebase-config.js`:

```js
window.MB_FIREBASE_CONFIG = {
  apiKey: "paste-the-web-api-key",
  databaseURL: "paste-the-realtime-database-url",
  adminEmail: "paste-the-overseer-email",
  overseerName: "F4nz2005"
};
```

Edit `database.rules.json` and replace every `YOUR_ADMIN_EMAIL@example.com` with the same Overseer email.

## Local test

Open `vanilla/index.html` through VS Code Live Server. Use a normal browser window for the Overseer and a phone or private window for a participant.

## Manual deployment

Run these commands from the project root:

```bash
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only database,hosting
```

Firebase deploys the existing files directly. There is no `npm install` and no website build command.

## GitHub deployment

The included `.github/workflows/firebase-hosting.yml` also deploys the same static files without building them. Add these GitHub repository secrets:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT`

Alternatively, after pushing the repository, run:

```bash
npx firebase-tools init hosting:github
```

Firebase will create its own GitHub service account and deployment workflow.

