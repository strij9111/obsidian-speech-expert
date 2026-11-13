/** Pure protocol and Markdown helpers. No vault, credentials, or network access. */
export const API_BASE = "https://speech-expert.ru";
export const SUPPORTED_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "webm", "flac", "aac", "opus"]);
export const MODELS = [
  { id: "SpeechExpert-STT-RU", label: "SpeechExpert-STT-RU" },
  { id: "GigaAM-v3-RNNT", label: "GigaAM v3 RNNT" },
  { id: "Whisper-Large-v3-Turbo", label: "Whisper Large v3 Turbo" },
] as const;
// All three selectable models currently use the Russian recognition route.
export const LANGUAGES = [{ id: "ru-RU", label: "Русский / Russian" }] as const;
export const SUMMARY_PRESETS = ["short", "notes", "conversation", "action_items", "lecture"] as const;

export interface RequestOptions {
  model: string;
  language: string;
  diarization: boolean;
  summaryPreset: string | null;
}

export interface TimedSegment {
  text: string;
  start_ms: number;
  end_ms: number;
  speaker?: number;
  timing_estimated?: boolean;
}

export interface Summary {
  title: string;
  summary: string;
  key_points: string[];
  sections: { title: string; points: string[] }[];
  decisions: string[];
  action_items: string[];
  open_questions: string[];
  risks: string[];
}

export interface TranscriptionResponse {
  result: string;
  model?: string;
  utterances?: TimedSegment[];
  segments?: TimedSegment[];
  timing_estimated?: boolean;
  summarization?: Summary;
  summarization_status?: "ready" | "failed" | "unavailable";
}

export interface Operation {
  id: string;
  done: boolean;
  metadata?: { progress_percent?: number; progress_stage?: string; status?: string };
  response?: TranscriptionResponse;
  error?: { code?: number; message: string };
}

export interface JobMetadata {
  sourcePath: string;
  model: string;
  operationId: string;
  createdAt: string;
  options?: RequestOptions;
}

export interface NoteContext extends JobMetadata {
  /** A vault-local link produced by Obsidian's generateMarkdownLink. */
  sourceLink: string;
  locale?: "ru" | "en";
}

export function validateOptions(options: RequestOptions): void {
  if (!MODELS.some((model) => model.id === options.model)) throw new Error("Unsupported recognition model.");
  if (!LANGUAGES.some((language) => language.id === options.language)) throw new Error("The selected models currently support Russian only.");
  if (typeof options.diarization !== "boolean") throw new Error("Invalid speaker separation option.");
  if (options.summaryPreset !== null && !SUMMARY_PRESETS.some((preset) => preset === options.summaryPreset)) {
    throw new Error("Unsupported summary preset.");
  }
}

export function safeOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("The service returned an invalid operation ID.");
  }
  return value;
}

/** Error text is intentionally local; do not expose raw HTTP responses or keys. */
export function safeErrorMessage(status?: number): string {
  if (status === 401 || status === 403) return "Check the Speech Expert API key and its permissions.";
  if (status === 402) return "Insufficient Speech Expert balance. Check your account.";
  if (status === 413) return "The audio file exceeds the service upload limit.";
  if (status === 429) return "The service is busy or a request limit was reached. Try checking the operation later.";
  if (status === 499) return "The operation was cancelled.";
  if (status === 404) return "The operation was not found. Check the account and operation ID.";
  return "The request could not be completed. Check the service and your connection; an upload may already have been accepted.";
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseSegments(value: unknown): TimedSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): TimedSegment[] => {
    const segment = object(item);
    if (!segment || typeof segment.text !== "string" || typeof segment.start_ms !== "number" || typeof segment.end_ms !== "number"
      || !Number.isSafeInteger(segment.start_ms) || !Number.isSafeInteger(segment.end_ms)
      || segment.start_ms < 0 || segment.end_ms < segment.start_ms) return [];
    const parsed: TimedSegment = { text: segment.text, start_ms: segment.start_ms, end_ms: segment.end_ms };
    if (typeof segment.speaker === "number" && Number.isSafeInteger(segment.speaker) && segment.speaker >= 0) parsed.speaker = segment.speaker;
    if (typeof segment.timing_estimated === "boolean") parsed.timing_estimated = segment.timing_estimated;
    return [parsed];
  });
}

function parseSummary(value: unknown): Summary | undefined {
  const summary = object(value);
  if (!summary || typeof summary.summary !== "string") return undefined;
  return {
    title: typeof summary.title === "string" ? summary.title : "",
    summary: summary.summary,
    key_points: strings(summary.key_points),
    sections: Array.isArray(summary.sections) ? summary.sections.flatMap((item) => {
      const section = object(item);
      return section && typeof section.title === "string" ? [{ title: section.title, points: strings(section.points) }] : [];
    }) : [],
    decisions: strings(summary.decisions), action_items: strings(summary.action_items),
    open_questions: strings(summary.open_questions), risks: strings(summary.risks),
  };
}

export function parseTranscriptionResponse(value: unknown): TranscriptionResponse {
  const response = object(value);
  if (!response || typeof response.result !== "string") throw new Error("The service returned an invalid transcription result.");
  const parsed: TranscriptionResponse = { result: response.result };
  if (typeof response.model === "string") parsed.model = response.model;
  parsed.utterances = parseSegments(response.utterances);
  parsed.segments = parseSegments(response.segments);
  if (typeof response.timing_estimated === "boolean") parsed.timing_estimated = response.timing_estimated;
  if (response.summarization_status === "ready" || response.summarization_status === "failed" || response.summarization_status === "unavailable") {
    parsed.summarization_status = response.summarization_status;
  }
  parsed.summarization = parseSummary(response.summarization);
  return parsed;
}

export function parseOperation(value: unknown): Operation {
  const operation = object(value);
  if (!operation || typeof operation.done !== "boolean") throw new Error("The service returned an invalid operation response.");
  const parsed: Operation = { id: safeOperationId(operation.id), done: operation.done };
  const error = object(operation.error);
  if (error) {
    const code = typeof error.code === "number" && Number.isInteger(error.code) ? error.code : undefined;
    parsed.error = { code, message: safeErrorMessage(code) };
  } else if (operation.error !== undefined && operation.error !== null) {
    throw new Error("The service returned an invalid operation error.");
  }
  if (operation.response !== undefined && operation.response !== null) parsed.response = parseTranscriptionResponse(operation.response);
  if (parsed.done && !parsed.response && !parsed.error) throw new Error("The completed operation has no transcription result.");
  const metadata = object(operation.metadata);
  if (metadata) {
    parsed.metadata = {};
    if (typeof metadata.progress_percent === "number" && Number.isFinite(metadata.progress_percent)) {
      parsed.metadata.progress_percent = Math.min(100, Math.max(0, metadata.progress_percent));
    }
    // Only allow protocol tokens: arbitrary server text must not enter notices or notes.
    if (typeof metadata.progress_stage === "string" && /^[a-z_]{1,40}$/.test(metadata.progress_stage)) parsed.metadata.progress_stage = metadata.progress_stage;
    if (typeof metadata.status === "string" && /^[a-z_]{1,40}$/.test(metadata.status)) parsed.metadata.status = metadata.status;
  }
  return parsed;
}

/** Audio stays binary. The model is sent as an encoded URL query by the caller. */
export function buildMultipart(audio: ArrayBuffer, filename: string, options: RequestOptions, boundary?: string): { body: ArrayBuffer; contentType: string } {
  validateOptions(options);
  const delimiter = boundary ?? `----speech-expert-${crypto.randomUUID()}`;
  if (!/^[A-Za-z0-9_-]{1,70}$/.test(delimiter)) throw new Error("Invalid multipart boundary.");
  // RFC 7578 file names use UTF-8 directly; remove header/path metacharacters.
  const safeFilename = filename.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f"\\]/g, "_") || "recording.wav";
  const extension = safeFilename.split(".").pop()?.toLowerCase() ?? "";
  const mimeTypes: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm", flac: "audio/flac", aac: "audio/aac", opus: "audio/ogg" };
  const fields: Record<string, string> = {
    lang: options.language, channelMode: "mono", diarization: String(options.diarization),
    includeTimings: "true", llmCorrection: "false", entityExtraction: "false",
  };
  if (options.summaryPreset !== null) {
    fields.summarizationPreset = options.summaryPreset;
    fields.summarizationDetail = "standard";
  }
  const encoder = new TextEncoder();
  const header = encoder.encode(Object.entries(fields).map(([key, value]) => `--${delimiter}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("")
    + `--${delimiter}\r\nContent-Disposition: form-data; name="audio"; filename="${safeFilename}"\r\nContent-Type: ${mimeTypes[extension] ?? "application/octet-stream"}\r\n\r\n`);
  const footer = encoder.encode(`\r\n--${delimiter}--\r\n`);
  const body = new Uint8Array(header.byteLength + audio.byteLength + footer.byteLength);
  body.set(header); body.set(new Uint8Array(audio), header.byteLength); body.set(footer, header.byteLength + audio.byteLength);
  return { body: body.buffer, contentType: `multipart/form-data; boundary=${delimiter}` };
}

/** Entities prevent Markdown, HTML, Obsidian embeds, properties, tags, and math execution. */
export function escapeMarkdown(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/[\\`*_{}\[\]()<>#+.!|~^$%:=@/\-]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function quote(value: string): string {
  return escapeMarkdown(value.replace(/\r\n?/g, "\n")).split("\n").map((line) => `> ${line}`).join("\n");
}

function inline(value: string): string { return escapeMarkdown(value.replace(/[\r\n\t]+/g, " ")); }

export function formatTimestamp(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function renderNote(result: TranscriptionResponse, context: NoteContext): string {
  const ru = context.locale === "ru";
  const labels = ru ? {
    heading: "Расшифровка", source: "Запись", model: "Модель", created: "Создано", operation: "Операция",
    summary: "Резюме", ai: "Резюме подготовлено ИИ. Проверьте выводы и задачи по исходной записи.",
    keys: "Ключевые мысли", decisions: "Решения", tasks: "Задачи для проверки", questions: "Открытые вопросы", risks: "Риски",
    failed: "Резюме недоступно. Полный текст расшифровки сохранён ниже.", empty: "Речь не распознана.",
    full: "Полный текст", timing: "Фрагменты с временными метками", timingNote: "Метки могут охватывать только часть записи; полный текст находится выше.",
    estimated: "Временные метки приблизительные.", speaker: "Говорящий",
  } : {
    heading: "Transcription", source: "Recording", model: "Model", created: "Created", operation: "Operation",
    summary: "Summary", ai: "AI-generated summary. Verify conclusions and tasks against the recording.",
    keys: "Key points", decisions: "Decisions", tasks: "Tasks to review", questions: "Open questions", risks: "Risks",
    failed: "Summary unavailable. The full transcript is preserved below.", empty: "No speech was recognized.",
    full: "Full transcript", timing: "Timestamped excerpts", timingNote: "Timestamps may cover only part of the recording; the full transcript is above.",
    estimated: "Timestamps are approximate.", speaker: "Speaker",
  };
  const source = /[\r\n]/.test(context.sourceLink) ? inline(context.sourcePath) : context.sourceLink;
  const lines = [`# ${labels.heading}`, "", `${labels.source}: ${source}`, `${labels.model}: ${inline(context.model)}`,
    `${labels.created}: ${inline(context.createdAt)}`, `${labels.operation}: ${inline(safeOperationId(context.operationId))}`, ""];
  if (result.summarization_status === "ready" && result.summarization) {
    const summary = result.summarization;
    lines.push(`## ${labels.summary}`, "", labels.ai, "");
    if (summary.title) lines.push(`### ${inline(summary.title)}`, "");
    if (summary.summary) lines.push(quote(summary.summary), "");
    const list = (title: string, values: string[], tasks = false) => {
      if (!values.length) return;
      lines.push(`### ${title}`, "", ...values.map((value) => `${tasks ? "- [ ] " : "- "}${inline(value)}`), "");
    };
    list(labels.keys, summary.key_points);
    for (const section of summary.sections) list(inline(section.title), section.points);
    list(labels.decisions, summary.decisions); list(labels.tasks, summary.action_items, true);
    list(labels.questions, summary.open_questions); list(labels.risks, summary.risks);
  } else if (context.options?.summaryPreset || result.summarization_status) {
    lines.push(`## ${labels.summary}`, "", labels.failed, "");
  }
  // Never substitute potentially incomplete timestamps for the authoritative full text.
  lines.push(`## ${labels.full}`, "", result.result ? quote(result.result) : labels.empty, "");
  const segments = result.utterances?.length ? result.utterances : result.segments ?? [];
  if (segments.length) {
    lines.push(`## ${labels.timing}`, "", labels.timingNote, "");
    if (result.timing_estimated || segments.some((segment) => segment.timing_estimated)) lines.push(labels.estimated, "");
    for (const segment of segments) {
      lines.push(`- ${formatTimestamp(segment.start_ms)}–${formatTimestamp(segment.end_ms)}${segment.speaker === undefined ? "" : ` · ${labels.speaker} ${segment.speaker + 1}`}: ${inline(segment.text)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
