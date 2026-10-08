# Voice for iPhone

The `/admin/voice` PWA — tap the orb, speak, hear the agent answer — as a
native app (`com.denizlg24.voice`). Single user, no explanatory copy. Same
install story and CI as Hours (`apps/hours-mobile/AGENTS.md`).

## A turn

1. `expo-audio` records m4a with metering; the PWA's voice-activity
   detection (calibration, 1.5 s of silence ends the utterance) runs on the
   meter (`voice-controller.tsx`).
2. `voice-notes/transcribe` (multipart through `File#upload`).
3. `chat` with `responseStyle: "voice"`, `executionMode: "yolo"` and
   `pageTools: false` — there is no page here. The UI message stream is read
   with `expo/fetch` and reduced by `features/voice/stream.ts`; no AI SDK
   client.
4. The text after the last tool call is spoken through `tts`, cut by
   `@repo/tts` `speechChunks`, the next chunk fetched while one plays.

A conversation idle for 15 minutes starts a new one. Long press the orb for
this session's turns, New conversation and Sign out.

## Native

- Recording and playback continue in the background (`audio` background
  mode); a background task covers the silent gap while the agent thinks.
- Live Activity (`VoiceAttributes`): listening / thinking (the tool at work) /
  replying, with Stop as a `LiveActivityIntent` that the module forwards to JS
  as `onStop`.
- `voice://listen` starts listening: `AskIntent` (Siri, Shortcuts, Action
  Button), the Control Center button, the Ask widgets.
- A reply that lands while the app is in the background is also posted as a
  passive notification; the last exchange feeds the widgets via the App Group.
- Session in SecureStore — nothing outside the app calls the API.
