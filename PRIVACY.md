# Privacy and data handling

Applies to Speech Expert for Obsidian 0.1.0. Updated 13 November 2026.

## What leaves your device

The plugin contacts `https://speech-expert.ru` over HTTPS when you check your API key, explicitly start an upload, or check a saved operation. It does not scan your vault to upload its contents, send other notes as context, or monitor new files for automatic processing.

Starting transcription sends the selected audio file, its filename, the requested model, and the processing options. The API key authenticates requests to Speech Expert. The three recognition models in this version process audio in Speech Expert's infrastructure.

Summarization is off by default. If you enable it, the transcript is also processed by an external language-model provider configured by Speech Expert. The provider can change; processing may take place outside your country. The plugin does not receive or manage that provider's credentials.

The plugin contains no advertising, analytics SDK, or separate telemetry endpoint. Speech Expert still records the service information needed to process requests, account for credits, secure the service, and investigate failures, as described in its [data policy](https://speech-expert.ru/static/legal/privacy.html).

## What stays in Obsidian

- The API key is stored through Obsidian Secret storage. The plugin's saved settings reference a secret identifier instead of storing the key as plaintext in `data.json`. Secret availability on another device depends on Obsidian's secret-storage behavior and your setup; do not assume that sharing plugin settings shares the key.
- Plugin settings include your chosen model, output location, and processing preferences.
- Recovery records include source and output note paths, operation identifiers, timestamps, options, and job status. These records do not contain the audio, transcript, or summary.
- The generated transcript and summary are written to a normal Markdown note in your vault. The original audio remains where you placed it.

Your vault and plugin settings may be copied by Obsidian Sync, another sync service, backups, or your own sharing workflow. Manage those services separately. A transcript note can contain sensitive content even when it is stored locally.

## Server storage and deletion

This version uses ordinary asynchronous file transcription. Uploading the file does not automatically create an item in Speech Expert's **My recordings** archive. The input is a temporary processing upload; the operation and its text result remain available on the server according to the service's retention policy.

The plugin does not select the API's separate private mode and does not promise immediate deletion or a fixed retention period. It does not automatically purge the operation after creating a note. This allows an interrupted client to retrieve an already processed result without another upload.

Deleting a vault file, removing a local job, or uninstalling the plugin does not delete a server operation or stop its processing. Deleting a server result does not delete notes, sync copies, or backups you already created. For server deletion options, consult the [operations documentation](https://speech-expert.ru/documentation/api/operations/) or contact Speech Expert.

## Interrupted uploads and support

A network failure during upload can leave the outcome unknown: the server may have started a paid operation before the connection was lost. The plugin does not automatically repeat that upload. Closing Obsidian or stopping the wait also does not cancel server processing or billing.

Only send recordings you are entitled to process. Review the selected model and the summary option before starting. When requesting support, do not include API keys; share recordings or transcript excerpts only when necessary and by choice.

Service operator and privacy contact: **Sergey Komarov / Speech Expert**, [skomarov@speech-expert.ru](mailto:skomarov@speech-expert.ru). The service's [data policy](https://speech-expert.ru/static/legal/privacy.html) and [terms](https://speech-expert.ru/static/legal/offer.html) describe the operator and service-wide practices.

## Кратко по-русски

Плагин отправляет в Speech Expert выбранный вами файл, его имя и настройки обработки. При включённом резюме текст дополнительно обрабатывает внешний провайдер языковой модели. Остальное содержимое хранилища не отправляется. Собственных счётчиков и телеметрии в плагине нет; сервис ведёт необходимый учёт запросов и оплаты по своей политике.

Ключ хранится через Secret storage Obsidian. В данных плагина остаются настройки и сведения о заданиях для восстановления, без аудио и транскриптов. Текст и резюме сохраняются в отдельной заметке и могут попасть в ваши синхронизацию, резервные копии и общий доступ.

Используется обычный режим фонового распознавания: загрузка не создаёт элемент в «Моих записях», но операция и результат хранятся на сервере по правилам сервиса. Автоматической очистки серверного результата в этой версии нет. Закрытие Obsidian, остановка ожидания, удаление заметки или плагина не отменяют обработку, оплату и серверное хранение. При неизвестном результате загрузки сначала проверьте существующую операцию; повторная загрузка может создать отдельное платное задание.

Полная [политика обработки данных Speech Expert](https://speech-expert.ru/static/legal/privacy.html); обращения — [skomarov@speech-expert.ru](mailto:skomarov@speech-expert.ru).
