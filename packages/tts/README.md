# Text to speech

`@repo/tts` holds the model and voice defaults, text chunking, and browser playback used by the desktop app and voice PWA.

The authenticated `POST /api/admin/tts` route in `apps/web` generates one audio chunk with the [AI Gateway speech API](https://vercel.com/docs/ai-gateway/modalities/text-to-speech). It reads the model, voice, and delivery instructions from the shared app settings. The route requires `AI_GATEWAY_API_KEY` on the web server and returns WAV for Gemini or MP3 for OpenAI.

Client features use `useAdminSpeech(client)` from `@repo/admin/tts/use-admin-speech` when they have an `AdminClient`. Its `play` method accepts a string or an async iterable of strings. It splits long text into 2,000-character requests and plays the clips in order; `stop` aborts generation and playback. Call `prime` synchronously from a user tap when speech will begin after microphone capture or another delay on mobile.

The PDF reader supplies one page at a time, so it can read a long document without generating the whole book up front. Playback is session-only; there is no persisted audio file.
