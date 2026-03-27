# RunWalk Buddy Native

This folder contains an Expo React Native version of RunWalk Buddy.

## What is included

- The same Pre-Beginner and Couch to 5K plans as the web app
- Week and run selection with local progress tracking
- Custom workout mode with editable settings
- Interval timer that keeps time from real timestamps
- Spoken cues using Expo Speech
- Background-capable audio configuration using Expo AV
- Local notifications as backup cues if the app is backgrounded or the screen locks
- Optional haptic cues on transitions
- Session persistence so an active workout can be restored after reopening the app

## Background audio notes

- `expo-av` configures the audio session to stay active in the background
- iOS background audio is enabled through `UIBackgroundModes: ["audio"]` in `app.json`
- Android foreground-service style behavior for long-running user-visible work typically requires a custom native setup; this Expo version uses active audio mode plus scheduled local notifications as the most stable simple approach without adding a large native dependency stack
- Spoken TTS while the phone is locked depends on OS behavior, but this setup is much better suited for native mobile than the browser PWA version

## Install dependencies

```bash
cd native-app
npm install
```

## Run locally

```bash
npm start
```

Then press:

- `i` for iOS simulator
- `a` for Android emulator
- or scan the QR code with Expo Go if the APIs used are supported by your Expo runtime

## Install on your iPhone with EAS

This is the best path if you want RunWalk Buddy installed as a real app on your iPhone.

1. Install Expo and EAS tools:

```bash
npm install -g eas-cli
```

2. Log in to Expo:

```bash
eas login
```

3. Go to the native app folder:

```bash
cd native-app
```

4. If this is your first time, let Expo confirm native build setup:

```bash
npm run eas:configure
```

5. Create an internal iOS build you can install on your phone:

```bash
npm run eas:ios:preview
```

6. When the build finishes, open the Expo build link on your iPhone and install it.

Notes:

- You may need to register your Apple account/device the first time
- Internal builds are the easiest way to get the app onto your own iPhone for testing
- For repeated development, you can also make a development client build and then run:

```bash
npm run start:dev-client
```

## Install through TestFlight

If you want a cleaner install flow for yourself or other testers:

1. Build a production iOS app:

```bash
npm run eas:ios:production
```

2. Submit it to App Store Connect:

```bash
npm run eas:submit:ios
```

3. Add yourself as a tester in TestFlight and install from the TestFlight app on your iPhone.

## Build native apps

For local native runs:

```bash
npm run ios
npm run android
```

For production builds, use Expo Application Services (EAS) if desired.

## Notes on testing installability

- This is a native mobile app, so there is no service worker or PWA manifest in this folder
- Installation happens through iOS/Android app builds rather than browser home-screen install

## File overview

- `App.js` - main app UI, plan selection, timer engine, background-safe session logic
- `app.json` - Expo app config and native background audio settings
- `assets/` - placeholder icons and splash assets
