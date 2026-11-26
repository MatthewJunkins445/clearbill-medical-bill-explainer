# Firebase setup (W1 console checklist)

This is the one-time setup you do yourself in the Firebase and Google Cloud consoles. Everything here works on the free **Spark** plan. Nobody else on the team handles your keys or tokens: you paste them into `.env.local` on your own machine, and that file is git-ignored.

Console labels change often. Where this guide is not sure of the exact wording, it says **(wording unverified)**; look for the nearest match.

Throughout, `<project>` means your Firebase project ID (for example `clearbill-demo-1a2b3`).

## Checklist

- [ ] 1. Create the project
- [ ] 2. Register the web app and fill in `.env.local`
- [ ] 3. Enable AI Logic with the Gemini Developer API
- [ ] 4. Create a reCAPTCHA Enterprise key and register it in App Check
- [ ] 5. Add an App Check debug token (enforcement stays off)
- [ ] 6. Enable Anonymous sign-in
- [ ] 7. Create the Remote Config parameters
- [ ] 8. Restrict the browser API key
- [ ] 9. Install the Firebase CLI and log in
- [ ] 10. Firestore: deferred, do nothing yet
- [ ] 11. Download Gemini Nano in Chrome

## 1. Create the project

1. Open the [Firebase console](https://console.firebase.google.com/) and choose **Create a project** (wording unverified; older consoles say **Add project**).
2. Name it, for example `clearbill`. Note the project ID it generates; that's `<project>`.
3. Google Analytics is optional; ClearBill doesn't need it. Leave it off unless you want it.
4. Confirm the project is on the **Spark** (no-cost) plan. Don't add billing.

## 2. Register a web app

1. In **Project settings > General > Your apps**, choose the web icon (`</>`) to add a web app. Name it `clearbill-web`.
2. You can tick **Also set up Firebase Hosting** now or later; the repo's `firebase.json` already configures Hosting from `dist/`.
3. Copy the `firebaseConfig` values shown into `.env.local`, not into any committed file:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   Then edit `.env.local` and replace each `your-...` placeholder with the matching value (`apiKey` to `VITE_FIREBASE_API_KEY`, `authDomain` to `VITE_FIREBASE_AUTH_DOMAIN`, and so on).

4. Never commit `.env.local`. The repo's `.gitignore` excludes every `.env*` file except `.env.example`, and CI runs gitleaks on every PR.

Optional: put your real project ID in `.firebaserc` in place of `your-firebase-project-id`, or run `firebase use --add` after step 9. A project ID isn't a secret, but keep that change out of PRs unless the team agrees to commit it.

## 3. Enable AI Logic with the Gemini Developer API

1. In the console's left menu, open **AI Logic** (wording unverified; it may sit under an **AI** or **Build** group).
2. Choose **Get started** and pick the **Gemini Developer API** provider. This is the provider that works on Spark; the Vertex AI provider needs billing.
3. Let the console enable the required APIs. It may offer to create a Gemini API key for you; the key is held by Firebase and must not be copied into the app or the repo.
4. If AI Logic offers an App Check enforcement setting, leave it **off** for now (see step 5).

## 4. reCAPTCHA Enterprise key and App Check

reCAPTCHA Enterprise works on the Spark plan.

1. Open **App Check** in the console and choose **Get started** (wording unverified).
2. Under **Apps**, select `clearbill-web` and choose the **reCAPTCHA Enterprise** provider.
3. Create the reCAPTCHA Enterprise key. The console links to the Google Cloud reCAPTCHA page (wording unverified). Create a **Website** key with these domains:
   - `<project>.web.app`
   - `<project>.firebaseapp.com`

   **Do not add `localhost`.** Local development uses the App Check debug token from step 5 instead. (This differs from the original plan, which listed localhost; the Fact Checker verified that localhost should not be added for the debug flow.)

4. Paste the key's **site key** (the public one) back into the App Check registration and save. Also put it in `.env.local` as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
5. Leave **enforcement off** for every service (AI Logic, Authentication, and the rest) until the app sends valid tokens in both development and production.

## 5. App Check debug token

The debug token lets `npm run dev` on localhost pass App Check without reCAPTCHA.

1. In **App Check > Apps**, open the overflow menu for `clearbill-web` and choose **Manage debug tokens**, then **Add debug token**. You can let the console generate a value.
2. Put that value in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`. Treat it like a password: anyone who has it can pass App Check for your project.
3. How the app uses it: in development builds only, `src/firebase` sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN` to this value **before** calling `initializeAppCheck`. Production builds never read it (`readClientEnv` drops it unless `import.meta.env.DEV` is true).
4. Keep enforcement **off** for now.
5. If the token ever leaks, delete it in the same **Manage debug tokens** dialog and add a new one.

## 6. Enable Anonymous sign-in

1. Open **Authentication** and choose **Get started** if prompted.
2. On the **Sign-in method** tab, choose **Anonymous** and turn it on. Save.

## 7. Remote Config parameters

1. Open **Remote Config** (wording unverified; it may be under **Run** or **Engage**) and choose **Create configuration**.
2. Add these parameters with these default values:

   | Parameter                | Type    | Default            |
   | ------------------------ | ------- | ------------------ |
   | `cloud_features_enabled` | Boolean | `true`             |
   | `cloud_model`            | String  | `gemini-3.8-flash` |
   | `prompt_version`         | String  | `v1`               |
   | `max_device_input_chars` | Number  | `16000`            |

3. Choose **Publish changes**. Nothing reaches clients until you publish.

`cloud_features_enabled=false` is the kill switch: it turns off every cloud call without a redeploy.

## 8. Restrict the browser API key

The web API key ships in the page, so restrict what it can do.

1. Open the [Google Cloud console credentials page](https://console.cloud.google.com/apis/credentials) for the same project. Pick the key named **Browser key (auto created by Firebase)** (wording unverified).
2. **Application restrictions:** choose **Websites** and add:
   - `http://localhost:5173/*` (Vite dev server)
   - `http://localhost:4173/*` (Vite preview, used by the Playwright tests)
   - `https://<project>.web.app/*`
   - `https://<project>.firebaseapp.com/*`
3. **API restrictions:** choose **Restrict key** and allow only the APIs the app calls. Expected list (verify against the **APIs & Services > Enabled APIs** page; names unverified):
   - Firebase AI Logic API
   - Generative Language API (if listed for AI Logic)
   - Firebase App Check API
   - Identity Toolkit API (Authentication)
   - Token Service API (Authentication)
   - Firebase Installations API
   - Firebase Remote Config API (and its Realtime API, if listed)
4. Save, wait a few minutes, then run `npm run dev` and check the browser console. A `403` or `API_KEY_HTTP_REFERRER_BLOCKED` / `API_KEY_SERVICE_BLOCKED` error means a referrer or an API is missing from the lists above.

## 9. Firebase CLI

```powershell
npm install -g firebase-tools
firebase login
firebase use --add   # choose <project>; this writes your local .firebaserc
```

`firebase login` opens a browser to sign in. Don't share or paste the CLI token anywhere.

## 10. Firestore: deferred

Don't create a Firestore database yet. When the store work item starts:

- Create it in **production mode** (locked rules); rules will live in `firestore/`.
- Choose its location carefully. It can't be changed later.

## 11. Gemini Nano in Chrome

On-device inference uses Chrome's built-in Gemini Nano through the Prompt API. Download the model before the demo, because the first download is several gigabytes.

1. Use a recent desktop Chrome on Windows, macOS, Linux or ChromeOS. Chrome documents hardware requirements (free disk space, and a capable GPU or enough RAM); check the current list in Chrome's built-in AI docs (requirements unverified here).
2. Open `chrome://on-device-internals` and check the model status (wording unverified). If the model isn't downloaded, the download starts once a page first calls the Prompt API. You can trigger it from DevTools on `http://localhost:5173` (after a click on the page, because creating a session may need a user gesture):

   ```js
   await LanguageModel.availability();
   await LanguageModel.create({
     monitor(m) {
       m.addEventListener('downloadprogress', (e) => console.log(e.loaded));
     },
   });
   ```

3. Confirm on `chrome://on-device-internals` that the model shows as ready, and that `await LanguageModel.availability()` returns `"available"`.

## When you're done

Tell the team which steps are complete. Don't send the values. The app reads everything from your `.env.local`.
