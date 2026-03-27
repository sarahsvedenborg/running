# RunWalk Buddy

RunWalk Buddy is a simple mobile-first React app for beginner run/walk intervals with spoken cues.

## Features

- One main screen with a large start button and simple pause, resume, and stop controls
- Default beginner session: 5 minute warm-up, 30 second run, 2 minute walk, 6 cycles, 5 minute cool-down
- Custom settings stored locally in the browser
- Text-to-speech prompts for walking, running, and workout completion
- Timer logic based on real elapsed time so it stays accurate if the tab loses focus

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open the local URL shown by Vite, usually `http://localhost:5173`.

## Build for production

```bash
npm run build
```

## Notes on audio behavior

- The app uses the browser Web Speech API for text-to-speech.
- Spoken prompts usually continue when the browser is backgrounded, but this depends on the browser and mobile operating system.
- Playing over or interrupting music is also browser and device dependent, so this is supported only where the platform allows it.
