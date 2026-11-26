# Firebase setup (W1 console checklist)

This is the one-time setup you do yourself in the Firebase and Google Cloud consoles. Everything here works on the free **Spark** plan. Nobody else on the team handles your keys or tokens: you paste them into `.env.local` on your own machine, and that file is git-ignored.

Console labels change often. Where this guide is not sure of the exact wording, it says **(wording unverified)**; look for the nearest match.

Throughout, `<project>` means your Firebase project ID (for example `clearbill-demo-1a2b3`).

## Checklist

- [ ] 1. Create the project
- [ ] 2. Register the web app and fill in `.env.local`
- [ ] 3. Enable AI Logic with the Gemini Developer API
- [ ] 4. Create a reCAPTCHA Enterprise key and register it in App Check
- [ ] 5. Add an App Check debug token for local development
- [ ] 6. Enable Anonymous sign-in
- [ ] 7. Create the Remote Config parameters and the region condition
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
4. The guided setup automatically enforces App Check for AI Logic. Keep it enforced and configure the debug token in step 5 for local development. [Firebase AI Logic setup guide](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started)

## 4. reCAPTCHA Enterprise key and App Check

reCAPTCHA Enterprise works on the Spark plan.

1. Open **App Check** in the console and choose **Get started** (wording unverified).
2. Under **Apps**, select `clearbill-web` and choose the **reCAPTCHA Enterprise** provider.
3. Create the reCAPTCHA Enterprise key. The console links to the Google Cloud reCAPTCHA page (wording unverified). Create a **Website** key with these domains:
   - `<project>.web.app`
   - `<project>.firebaseapp.com`

   **Do not add `localhost`.** Local development uses the App Check debug token from step 5 instead. (This differs from the original plan, which listed localhost; the Fact Checker verified that localhost should not be added for the debug flow.)

4. Paste the key's **site key** (the public one) back into the App Check registration and save. Also put it in `.env.local` as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.
5. In **Security > App Check > APIs**, confirm that **Firebase AI Logic** is enforced. If it shows **Unenforced**, enable enforcement. Leave the settings for other services as they are until their integrations send valid tokens. [Firebase AI Logic App Check guide](https://firebase.google.com/docs/ai-logic/app-check)

## 5. App Check debug token

Once Firebase initialization is wired up, `npm run dev` on localhost can use the debug token to pass App Check.

1. In **App Check > Apps**, open the overflow menu for `clearbill-web` and choose **Manage debug tokens**, then **Add debug token**. You can let the console generate a value.
2. Put that value in `.env.local` as `VITE_APPCHECK_DEBUG_TOKEN`. Treat it like a password: anyone who has it can pass App Check for your project.
3. In development builds, the Firebase initializer must set `self.FIREBASE_APPCHECK_DEBUG_TOKEN` to this value **before** calling `initializeAppCheck`. The value is read in one place only, `appCheckDebugToken()` in `src/firebase/index.ts`, as `import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN : undefined`. `vite build` replaces `import.meta.env.DEV` with `false`, so the minifier drops the branch and the token is never inlined into `dist/`. `readClientEnv` neither reads nor returns the token. CI enforces this: it builds with a canary token and fails if the canary appears anywhere in `dist/`, source maps included. Even so, never put a real debug token in a production or CI environment.
4. If the token ever leaks, delete it in the same **Manage debug tokens** dialog and add a new one.

## 6. Enable Anonymous sign-in

1. Open **Authentication** and choose **Get started** if prompted.
2. On the **Sign-in method** tab, choose **Anonymous** and turn it on. Save.

## 7. Remote Config parameters

1. Open **Remote Config** (wording unverified; it may be under **Run** or **Engage**) and choose **Create configuration**.
2. Add these parameters with these default values:

   | Parameter                | Type    | Server default     | In-app fallback    |
   | ------------------------ | ------- | ------------------ | ------------------ |
   | `cloud_features_enabled` | Boolean | `true`             | `true`             |
   | `cloud_region_allowed`   | Boolean | `true`             | `false`            |
   | `cloud_model`            | String  | `gemini-3.8-flash` | `gemini-3.8-flash` |
   | `prompt_version`         | String  | `v1`               | `v1`               |
   | `max_device_input_chars` | Number  | `16000`            | `16000`            |

   The server default is the value published from the console. The in-app fallback is what the app uses when the startup fetch fails or times out (five seconds), so cloud features fail closed.

3. Add a **Country/Region** condition (wording unverified) named `EEA, GB and CH` that sets `cloud_region_allowed` to `false`. Select these countries:

   Austria (AT), Belgium (BE), Bulgaria (BG), Croatia (HR), Cyprus (CY), Czechia (CZ), Denmark (DK), Estonia (EE), Finland (FI), France (FR), Germany (DE), Greece (GR), Hungary (HU), Ireland (IE), Italy (IT), Latvia (LV), Lithuania (LT), Luxembourg (LU), Malta (MT), Netherlands (NL), Poland (PL), Portugal (PT), Romania (RO), Slovakia (SK), Slovenia (SI), Spain (ES), Sweden (SE), Iceland (IS), Liechtenstein (LI), Norway (NO), United Kingdom (GB), Switzerland (CH).

   Use **GB** (United Kingdom), not `UK`; the Firebase docs example gets this wrong.

4. Choose **Publish changes**. Nothing reaches clients until you publish.

`cloud_features_enabled=false` is the single kill switch: it turns off every cloud call without a redeploy. There is no second kill-switch key.

`cloud_region_allowed` is the region gate for cloud features. Its in-app fallback is `false` (fail closed) and its server default is `true`, so a client can use cloud inference only after a successful fetch leaves the region condition unset. The condition is evaluated server-side from the request IP, so a VPN or proxy can defeat it, and cached config persists between fetches. Treat it as a client-side UX gate, not server enforcement. This follows the A7 finding that Remote Config country conditions are supported on Web and are IP-based.

`cloud_real_bills` is **not** a Remote Config parameter in Plan B. Cloud inference for real (imported) bills stays hardcoded off, and imported bills are device-only. Adding the key would imply a paid path that the free plan does not support; revisit it only with an explicit contract change.

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
