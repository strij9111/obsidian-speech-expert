import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMultipart, parseOperation, parseTranscriptionResponse, renderNote, safeOperationId, validateOptions, type RequestOptions } from "../src/core.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const options: RequestOptions = { model: "SpeechExpert-STT-RU", language: "ru-RU", diarization: false, summaryPreset: null };
const context = { sourcePath: "Audio/meeting.wav", sourceLink: "[[Audio/meeting.wav]]", model: options.model, operationId: id, createdAt: "2026-11-13T00:00:00Z", options };

test("multipart preserves binary bytes and UTF-8 filename, rejects header injection", () => {
  const bytes = new Uint8Array([0, 255, 123, 13, 10]);
  const multipart = buildMultipart(bytes.buffer, 'разговор\r\nX-Evil: yes".wav', options, "test-boundary");
  const encoded = new Uint8Array(multipart.body);
  const text = new TextDecoder().decode(encoded);
  assert.match(text, /filename="разговор__X-Evil: yes_\.wav"/);
  assert.doesNotMatch(text, /\r\nX-Evil/);
  assert.match(text, /name="lang"\r\n\r\nru-RU/);
  assert.match(text, /name="includeTimings"\r\n\r\ntrue/);
  assert.doesNotMatch(text, /name="model"|name="summarizationPreset"/);
  const footerLength = new TextEncoder().encode("\r\n--test-boundary--\r\n").length;
  assert.deepEqual(encoded.slice(-footerLength - bytes.length, -footerLength), bytes);
  assert.throws(() => buildMultipart(bytes.buffer, "a.wav", options, "x\r\n"));
});

test("summary is only added to multipart when explicitly requested", () => {
  const text = new TextDecoder().decode(buildMultipart(new ArrayBuffer(1), "a.wav", { ...options, summaryPreset: "notes" }, "test").body);
  assert.match(text, /name="summarizationPreset"\r\n\r\nnotes/);
});

test("all selectable models are Russian only and invalid presets fail locally", () => {
  assert.doesNotThrow(() => validateOptions({ ...options, model: "Whisper-Large-v3-Turbo" }));
  assert.throws(() => validateOptions({ ...options, language: "en-US" }));
  assert.throws(() => validateOptions({ ...options, summaryPreset: "run_me" }));
  assert.throws(() => validateOptions({ ...options, model: "other" }));
});

test("operation validates ID, state, result schema and does not reveal remote error messages", () => {
  assert.equal(parseOperation({ id, done: false }).id, id);
  assert.throws(() => safeOperationId("../../etc?secret"));
  assert.throws(() => parseOperation({ id, done: "false" }));
  assert.throws(() => parseOperation({ id, done: true }));
  assert.throws(() => parseOperation({ id, done: true, response: { result: [] } }));
  const failed = parseOperation({ id, done: true, error: { code: 401, message: "private-key-secret" }, response: { result: "partial" } });
  assert.equal(failed.response?.result, "partial");
  assert.equal(failed.error?.code, 401);
  assert.doesNotMatch(failed.error?.message ?? "", /private-key-secret/);
});

test("full transcript survives incomplete timing coverage and millisecond times stay correct", () => {
  const response = parseTranscriptionResponse({ result: "Beginning. The ending must also survive.", segments: [{ text: "Beginning.", start_ms: 61000, end_ms: 62500 }] });
  const note = renderNote(response, context);
  assert.match(note, /The ending must also survive/);
  assert.match(note, /01:01–01:02/);
  assert.match(note, /Timestamps may cover only part/);
});

test("summary failure preserves transcript and invalid timing ranges are not invented", () => {
  const response = parseTranscriptionResponse({ result: "Keep this full transcript", summarization_status: "failed", segments: [{ text: "bad", start_ms: 2, end_ms: 1 }, { text: "bad", start_ms: -1, end_ms: 4 }, { text: "bad", start_ms: 2, end_ms: Infinity }] });
  const note = renderNote(response, { ...context, options: { ...options, summaryPreset: "notes" } });
  assert.match(note, /Summary unavailable/);
  assert.match(note, /Keep this full transcript/);
  assert.doesNotMatch(note, /Timestamped excerpts/);
});

test("untrusted text cannot turn into embeds, HTML, frontmatter, code or completed tasks", () => {
  const malicious = '---\nsecret: yes\n---\n![[other-note]]\n<img src="https://evil">\n```dataviewjs\napp.vault.delete(file)\n```\n- [x] fake\n#tag $$math$$ %%hide%%';
  const response = parseTranscriptionResponse({ result: malicious, summarization_status: "ready", summarization: { summary: malicious, action_items: ['Do this\n- [x] not actually done'], sections: [{ title: "![[bad]]", points: ["safe"] }] } });
  const note = renderNote(response, context);
  assert.doesNotMatch(note, /!\[\[|<img|```|\nsecret:|\n- \[x\]|\n#tag|\$\$|%%/);
  assert.match(note, /- \[ \] Do this/);
  assert.match(note, /&#33;&#91;&#91;/);
});

test("utterances win over duplicate segments while full text remains", () => {
  const response = parseTranscriptionResponse({ result: "Complete text", utterances: [{ text: "Utterance", start_ms: 0, end_ms: 2000, speaker: 0 }], segments: [{ text: "Duplicate segment", start_ms: 0, end_ms: 2000 }] });
  const note = renderNote(response, context);
  assert.match(note, /Complete text/);
  assert.match(note, /Speaker 1/);
  assert.doesNotMatch(note, /Duplicate segment/);
});
