# Speech Expert for Obsidian

Turn a Russian audio attachment into a transcript in your vault, with optional summaries, action items, lecture notes, and speaker separation.

[Русская версия](README.ru.md) · [Privacy and data handling](PRIVACY.md)

This is the first development version, **0.1.0**. It is not yet listed in Obsidian Community plugins. A Speech Expert account, API key, internet connection, and sufficient service credits are required. The plugin is free and open source; audio processing is a paid service.

## What it does

- Processes an audio file you choose from your vault, after showing the model and processing options.
- Creates a separate Markdown note with a link to the original recording and the transcript.
- Includes speaker labels and timestamps when the selected model returns them. Timestamp availability and precision vary by model.
- Optionally adds a short summary, notes, a conversation summary, action items, or lecture notes. Summaries are off by default.
- Remembers the server operation so you can resume checking its result after closing Obsidian or losing the connection.

Version 0.1.0 supports Russian speech and files up to **100 MiB**: WAV, MP3, M4A, OGG, Opus, FLAC, AAC, and WebM. It does not record the microphone or continuously watch your vault. Mobile compatibility has not yet been verified on devices.

## Install the development version

Requires Obsidian **1.11.4 or later**, including its Secret storage API.

1. Build the plugin as described below, or use a trusted build provided by the maintainer.
2. Create `<your-vault>/.obsidian/plugins/speech-expert/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Reload Obsidian and enable **Speech Expert** in **Settings → Community plugins**. Enable community plugins first if they are disabled.

Keep your API key out of the plugin files and any shared build or support report.

## First transcript

1. Create an account at [Speech Expert](https://speech-expert.ru/) and generate an API key in the [API keys section](https://speech-expert.ru/?section=keys).
2. Open the Speech Expert settings in Obsidian and select or create a secret for your API key. Enter the key itself, without `Api-Key` or `Bearer`.
3. Use the connection check. It does not start paid audio processing.
4. Choose the Speech Expert transcription command, or use its context menu on a supported audio attachment.
5. Select the model and any optional processing. Review the data-sharing information and start the upload.
6. When processing finishes, open the generated Markdown note. The original audio attachment remains in your vault.

The interface follows the Obsidian language setting, with Russian and English translations. This changes interface text, not the supported speech language.

## Models and pricing

The following reference prices are dated **13 November 2026**, for uploaded Russian audio mixed to mono:

| Model | Basic transcription | With speaker separation |
| --- | ---: | ---: |
| SpeechExpert-STT-RU | 10.08 ₽/hour | 19.08 ₽/hour |
| GigaAM v3 RNNT | 21 ₽/hour | 30 ₽/hour |
| Whisper Large v3 Turbo | 21 ₽/hour | 30 ₽/hour |

Billing uses the duration of the source recording, rounded up to a second. Rates depend on the service's current pricing and credit value; this table is not a quote for an individual upload. Check the [current tariffs](https://speech-expert.ru/#pricing) before processing.

The optional summary requested together with transcription uses the bundled recognition tariff. It sends the transcript to an external language-model provider. Standalone text actions elsewhere in the service may have separate pricing. See the [API documentation](https://speech-expert.ru/documentation/api/stt-v1/).

Whisper in this integration currently supports Russian only. Speaker labels describe automatically separated voices; they do not identify people. Review important names, numbers, quotations, tasks, and deadlines against the original recording.

## Interrupted jobs

Open the Speech Expert jobs command and resume checking the saved operation. This retrieves the existing result; it does not upload the audio again.

Closing a progress window, stopping the wait, disabling the plugin, or closing Obsidian **does not cancel server processing or billing**. This version does not provide server cancellation. It also does not automatically delete server results after saving a note.

If the upload times out before an operation ID is returned, the server may still have accepted it. The plugin marks the outcome as unknown and does not retry the upload automatically. Check the existing operation in Speech Expert before starting another paid job. If you find its ID, attach it to the pending job to retrieve that result.

Transcription and summarization can have different outcomes. If recognition succeeds but the summary fails, the transcript can still be saved. Resuming result retrieval does not regenerate a failed summary.

## Privacy

Only the selected recording is uploaded when you start a job. Enabling a summary additionally allows external processing of the transcript. The API key uses Obsidian Secret storage; plugin settings store its secret identifier, not the key itself. The plugin contains no analytics or advertising telemetry.

Job metadata is saved locally to support recovery. Generated transcripts and summaries are normal vault notes and follow your own sync, backup, and sharing settings. Server processing and retention are governed by Speech Expert's policy. Read [PRIVACY.md](PRIVACY.md) for the complete data flow and deletion limitations.

## Build from source

From the plugin directory, with Node.js 22 or later:

```sh
npm ci
npm run check
```

`check` runs TypeScript checking, the automated tests, and the production build. The output is `main.js`; installation also needs `manifest.json` and `styles.css`. This command does not make real paid requests to Speech Expert.

For a production build without the other checks, use `npm run build`.

## Support

Contact [skomarov@speech-expert.ru](mailto:skomarov@speech-expert.ru) with the plugin and Obsidian versions, platform, and a description of the problem. Do not include your API key or recordings and transcripts unless they are needed and you choose to share them.

Licensed under [MIT](LICENSE). Speech Expert service use is subject to its [service terms](https://speech-expert.ru/static/legal/offer.html) and [data policy](https://speech-expert.ru/static/legal/privacy.html).
