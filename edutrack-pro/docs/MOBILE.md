# Mobile app (Android / iOS)

Expo / React Native app in `apps/mobile`, for the two field roles: **teachers** (today's lessons,
workload, assessments, notifications) and **guardians** (children, published results, class timetable,
handing in work from the camera or a file, notifications). Administration stays on the web workspace,
where a full class list and a keyboard make sense.

## 1. Structure

```
apps/mobile/
├── App.tsx                 role-aware shell (sign-in → tabbed workspace)
├── index.js                Expo entry point for both platforms
├── app.json                Expo config: name, slug, bundle ids, camera/photo permissions, API url
├── eas.json                build profiles (development / preview / production)
├── metro.config.js         monorepo-aware bundler config
├── babel.config.js         babel-preset-expo
└── src/
    ├── api/client.ts       fetch layer: envelope unwrapping, refresh-and-replay, upload
    ├── components/ui.tsx   small component kit (Screen, Card, Row, Button, Field, Banner…)
    ├── components/useApi.ts
    ├── lib/{session.tsx,theme.ts,format.ts,notifications.ts}
    └── screens/            SignIn, Home, Timetable, Results, HandIn, Notifications, Assessments
```

## 2. Install and run

```bash
# from the repository root
npm run mobile:install        # installs the app's own dependency tree (see note below)
npm run mobile:start          # Expo dev server: scan the QR code with Expo Go
npm run mobile:android        # open on a connected Android device / emulator
npm run mobile:ios            # open in the iOS simulator (macOS only)
npm run mobile:typecheck      # TypeScript, no emit
```

**Why the mobile app has its own `node_modules`.** React Native source contains Flow syntax that must be
transformed by the babel config in the app directory. If `react-native` were hoisted to the monorepo
root (as npm workspaces would do), Metro would transform those files *without* the app's babel config
and bundling fails with a parse error. Keeping the app's dependency tree local is the standard fix for
Expo apps inside an npm-workspaces monorepo. The app still imports the shared workspace packages
(`@edutrack/shared-config`, `shared-types`, `validation`) — `metro.config.js` maps them to
`packages/*` and `tsconfig.json` maps them for the type checker.

**Pointing the app at your API.** `app.json → expo.extra.apiUrl` defaults to
`http://10.0.2.2:4000/api/v1` (the Android emulator's path to your machine's localhost). For a physical
phone use your machine's LAN address (`http://192.168.1.20:4000/api/v1`) or your public API URL. The
API must be reachable and listed in `CORS_ORIGINS` if you serve the web app from the same host.

## 3. What the app does

| Role | Screens | Notes |
| --- | --- | --- |
| Teacher | Home (today's lessons, weekly load, assessment counts), Timetable, Assessments, Notifications | read-only views of the data a teacher needs between lessons; mark entry stays on web by design |
| Guardian | Home (children, latest published results, upcoming assignments), Results + progress, Timetable, Hand in, Notifications | sees only verified linked children; drafts never reach the app |
| Admin | Home (signpost to the web workspace), Notifications | administration is a desktop task |

Guardian hand-in (`src/screens/HandInScreen.tsx`): take a photo with the camera or pick a PDF/image,
with a client-side size/type pre-check using the **same** `MAX_UPLOAD_BYTES` / `ALLOWED_UPLOAD_TYPES`
policy the server enforces. The upload goes to private storage and the hand-in records that a guardian
submitted it on the learner's behalf.

Session handling: access + refresh tokens are kept in the platform keychain (SecureStore), refreshed
once on a 401 and replayed; a revoked session drops the user back to sign-in.

## 4. Building installable apps

```bash
npx eas login                     # an Expo account is required for cloud builds
npx eas build -p android --profile preview     # APK for internal testing
npx eas build -p ios --profile preview         # requires an Apple Developer account
npx eas build -p android --profile production   # store build (AAB)
```

Local production bundles can be produced without Expo's cloud, which is what was verified here:

```bash
cd apps/mobile
npx expo export --platform android --output-dir dist        # 1.8 MB Hermes bundle, 569 modules
npx expo export --platform ios     --output-dir dist-ios    # 1.8 MB Hermes bundle
```

Both commands succeed in this repository. Publishing to the Play Store / App Store additionally needs
your own developer accounts, `eas.json` `submit` profiles and store listings — those are commercial
steps, not code steps, and are **not** included.

## 5. Testing status

* `npm run mobile:typecheck` passes (strict TypeScript).
* Android and iOS bundles export successfully (see above) — the app is not a stub.
* There is **no automated UI test suite** for the mobile app yet (`jest-expo` + React Native Testing
  Library is the natural next step); the API behaviour it depends on is covered by the
  unit/integration/E2E suites in `apps/api/test`.
* The app has not been run on a real Android/iOS device from this development environment (no device or
  emulator attached). Run it on hardware before distributing.
