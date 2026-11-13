# Changelog

## 0.1.0 — Unreleased

Initial development version; not yet listed in Obsidian Community plugins.

- Transcribe selected Russian audio attachments through Speech Expert.
- Choose SpeechExpert-STT-RU, GigaAM v3 RNNT, or Whisper Large v3 Turbo.
- Optionally request speaker separation and one of five summary formats.
- Save a separate Markdown note with the source link and available timestamps.
- Resume retrieval of a saved operation without repeating its upload.
- Keep unknown upload outcomes for review instead of automatically retrying a potentially paid request.
- Store the API key through Obsidian Secret storage, with only its identifier in plugin settings.
- Provide Russian and English interface text.

Current limits: Russian speech, files up to 100 MiB, no microphone recording, no server cancellation or automatic server-result deletion. Mobile device behavior has not yet been verified.
