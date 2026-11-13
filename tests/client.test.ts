import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, SpeechExpertClient, type HttpRequest, type HttpResponse, type Transport } from "../src/client.ts";
import { API_BASE, type RequestOptions } from "../src/core.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const options: RequestOptions = { model: "Whisper-Large-v3-Turbo", language: "ru-RU", diarization: false, summaryPreset: null };
const secret = "test-key-not-a-real-credential";
const audio = new Uint8Array([0, 1, 255]).buffer;
const json = (value: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(value) });

test("upload sends one binary multipart POST with model query and Api-Key authorization", async () => {
  const requests: HttpRequest[] = [];
  const client = new SpeechExpertClient(async (request) => { requests.push(request); return json({ id, done: false }); }, secret);
  const operation = await client.upload(audio, "sample.wav", options);
  assert.equal(operation.id, id);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, `${API_BASE}/api/stt/v1:recognizeAsync?model=Whisper-Large-v3-Turbo`);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, `Api-Key ${secret}`);
  assert.match(request.headers["Content-Type"], /^multipart\/form-data; boundary=/);
  assert.ok(request.body instanceof ArrayBuffer);
  assert.match(new TextDecoder().decode(request.body), /name="audio"; filename="sample.wav"/);
  assert.doesNotMatch(new TextDecoder().decode(request.body), /name="model"/);
});

test("uncertain network failure is classified ambiguous and never retries upload", async () => {
  let calls = 0;
  const client = new SpeechExpertClient(async () => { calls++; throw new Error(`transport failed: ${secret}`); }, secret);
  await assert.rejects(client.upload(audio, "a.wav", options), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.ambiguous, true);
    assert.doesNotMatch(String(error), new RegExp(secret));
    return true;
  });
  assert.equal(calls, 1);
});

test("timeout marks a POST outcome unknown without replay", async () => {
  let calls = 0;
  const client = new SpeechExpertClient(() => { calls++; return new Promise<HttpResponse>(() => {}); }, secret, 5);
  await assert.rejects(client.upload(audio, "a.wav", options), (error: unknown) => error instanceof ApiError && error.ambiguous);
  assert.equal(calls, 1);
});

test("a successful HTTP upload with invalid JSON or malformed operation is still uncertain", async () => {
  for (const response of [{ status: 200, text: `<html>${secret}</html>` }, json({ id: "not-a-uuid", done: false }), json({ id, done: true, response: {} })]) {
    let calls = 0;
    const client = new SpeechExpertClient(async () => { calls++; return response; }, secret);
    await assert.rejects(client.upload(audio, "a.wav", options), (error: unknown) => {
      assert.ok(error instanceof ApiError && error.ambiguous);
      assert.doesNotMatch(String(error), new RegExp(secret));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("HTTP rejection messages are local, preserve status, and hide response details", async () => {
  for (const status of [401, 402, 403, 413, 429, 500]) {
    const client = new SpeechExpertClient(async () => ({ status, text: `backend secret ${secret}` }), secret);
    await assert.rejects(client.upload(audio, "a.wav", options), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.ambiguous, status === 500);
      assert.doesNotMatch(String(error), /backend secret|test-key-not/);
      assert.ok(error.message.length > 0);
      return true;
    });
  }
});

test("key checking is a read-only scoped GET and does not submit audio", async () => {
  const requests: HttpRequest[] = [];
  const client = new SpeechExpertClient(async (request) => { requests.push(request); return json({presets: []}); }, secret);
  await client.checkKey();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].body, undefined);
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/api/creator-research/presets");
  assert.equal(url.search, "");
});

test("invalid key, options, or operation ID fail before network access", async () => {
  let calls = 0;
  const transport: Transport = async () => { calls++; return json([]); };
  assert.throws(() => new SpeechExpertClient(transport, ""));
  assert.throws(() => new SpeechExpertClient(transport, "key\r\nInjected: value"));
  const client = new SpeechExpertClient(transport, secret);
  await assert.rejects(client.getOperation("../../another-account"));
  await assert.rejects(client.upload(audio, "a.wav", { ...options, language: "en-US" }));
  assert.equal(calls, 0);
});

test("status checking rejects operation ID mismatch and malformed success JSON", async () => {
  for (const response of [json({ id: otherId, done: false }), json({ id, done: "true" }), { status: 200, text: "not JSON" }]) {
    const client = new SpeechExpertClient(async () => response, secret);
    await assert.rejects(client.getOperation(id), (error: unknown) => error instanceof ApiError && !error.ambiguous);
  }
});

test("GET failure can be resumed without implying another upload", async () => {
  const requests: HttpRequest[] = [];
  const client = new SpeechExpertClient(async (request) => {
    requests.push(request);
    if (requests.length === 1) throw new Error("offline");
    return json({ id, done: true, response: { result: "Complete" } });
  }, secret);
  await assert.rejects(client.getOperation(id), (error: unknown) => error instanceof ApiError && !error.ambiguous);
  assert.equal((await client.getOperation(id)).response?.result, "Complete");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET"]);
});
