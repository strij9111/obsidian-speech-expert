import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { buildSync } from "esbuild";
import { draftMarker, resultMarker, type Job, type PluginData } from "../src/state.ts";
import type { RequestOptions } from "../src/core.ts";

// Execute the real bundled lifecycle against an in-memory Obsidian API contract.
// These tests do not launch Obsidian or send traffic to Speech Expert.
const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true, write: false, format: "cjs", platform: "node", target: "es2022", external: ["obsidian"],
}).outputFiles[0].text;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const options: RequestOptions = { model: "SpeechExpert-STT-RU", language: "ru-RU", diarization: false, summaryPreset: null };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class MockFile {
  readonly name: string;
  readonly extension: string;
  readonly stat = { size: 4, ctime: 0, mtime: 0 };
  constructor(public path: string) {
    this.name = path.split("/").pop()!;
    this.extension = this.name.split(".").pop()!;
  }
}
class MockFolder { constructor(public path: string) {} }
type Request = { method: string; url: string; body?: ArrayBuffer; headers: Record<string, string> };
type Response = { status: number; text: string };
type PluginInstance = {
  data: PluginData;
  onload(): Promise<void>;
  onunload(): void;
  start(file: MockFile, options: RequestOptions): Promise<void>;
  resume(job: Job): Promise<void>;
};
const success = (extra: Record<string, unknown> = {}): Response => ({
  status: 200, text: JSON.stringify({ id: operationId, done: true, response: { result: "The complete spoken content.", ...extra } }),
});

function setup(initial?: unknown) {
  const files = new Map<string, MockFile | MockFolder>();
  const notes = new Map<string, string>();
  const requests: Request[] = [];
  const saves: PluginData[] = [];
  const events: string[] = [];
  const notices: string[] = [];
  const audio = new MockFile("Audio/interview.wav");
  files.set(audio.path, audio);
  let stored: unknown = initial;
  let saveFailure: (snapshot: PluginData) => boolean = () => false;
  let processFailure = false;
  let network: (request: Request) => Promise<Response> = async () => success();
  let readBinary = async (): Promise<ArrayBuffer> => new Uint8Array([0, 1, 2, 3]).buffer;

  const app = {
    secretStorage: { getSecret: () => "test-key-not-a-real-credential" },
    workspace: { on: () => ({}), openLinkText: async () => {} },
    fileManager: { generateMarkdownLink: (file: MockFile) => `[[${file.path}]]` },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getFiles: () => [...files.values()].filter((file) => file instanceof MockFile),
      readBinary: async () => { events.push("read-audio"); return readBinary(); },
      createFolder: async (path: string) => { files.set(path, new MockFolder(path)); },
      create: async (path: string, content: string) => {
        assert.equal(files.has(path), false, "Creating a draft must not overwrite an existing file");
        const file = new MockFile(path); files.set(path, file); notes.set(path, content); events.push("create-draft"); return file;
      },
      read: async (file: MockFile) => notes.get(file.path) ?? "",
      process: async (file: MockFile, updater: (current: string) => string) => {
        if (processFailure) throw new Error("Simulated disk-full error");
        // Obsidian's atomic process operation supplies the latest text to the callback.
        notes.set(file.path, updater(notes.get(file.path) ?? "")); events.push("append-result");
      },
    },
  };
  class Plugin {
    app = app;
    async loadData() { return stored === undefined ? undefined : clone(stored); }
    async saveData(snapshot: PluginData) {
      events.push(`persist:${snapshot.jobs.at(-1)?.status ?? "empty"}`);
      if (saveFailure(snapshot)) throw new Error("Simulated metadata storage error");
      stored = clone(snapshot); saves.push(clone(snapshot));
    }
    addSettingTab() {}
    addCommand() {}
    addRibbonIcon() {}
    registerEvent() {}
  }
  class EmptyUi { constructor(..._args: unknown[]) {} }
  const obsidian = {
    Plugin, TFile: MockFile, TFolder: MockFolder, App: EmptyUi,
    FuzzySuggestModal: EmptyUi, Modal: EmptyUi, PluginSettingTab: EmptyUi, Setting: EmptyUi, SecretComponent: EmptyUi,
    Notice: class { constructor(message: string) { notices.push(message); } },
    getLanguage: () => "en",
    normalizePath: (path: string) => path.replace(/\\/g, "/"),
    requestUrl: async (request: Request) => { requests.push(request); events.push(`network:${request.method}`); return network(request); },
  };
  const module = { exports: {} as { default?: new () => PluginInstance } };
  runInNewContext(bundle, {
    module, exports: module.exports,
    require: (name: string) => { assert.equal(name, "obsidian"); return obsidian; },
    crypto: webcrypto, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, URL, setTimeout, clearTimeout,
  }, { filename: "speech-expert-lifecycle-under-test.cjs" });
  const Instance = module.exports.default!;
  const instance = new Instance();
  return {
    instance, audio, notes, files, requests, saves, events, notices,
    stored: () => clone(stored as PluginData),
    setNetwork: (handler: typeof network) => { network = handler; },
    setReadBinary: (handler: typeof readBinary) => { readBinary = handler; },
    failSaveWhen: (predicate: typeof saveFailure) => { saveFailure = predicate; },
    failProcess: (value: boolean) => { processFailure = value; },
  };
}

test("lifecycle persists draft and upload intent before the first paid POST", async () => {
  const env = setup();
  await env.instance.onload();
  env.setNetwork(async (request) => {
    assert.equal(request.method, "POST");
    const durable = env.stored().jobs[0];
    assert.equal(durable.status, "uploading");
    assert.ok(env.notes.get(durable.notePath)?.includes(draftMarker(durable.id)));
    assert.ok(env.events.indexOf("persist:uploading") < env.events.indexOf("network:POST"));
    return success();
  });
  await env.instance.start(env.audio, options);
  assert.equal(env.requests.length, 1);
  assert.equal(env.stored().jobs[0].status, "completed");
  assert.equal(env.stored().jobs[0].operationId, operationId);
});

test("failed metadata checkpoint prevents paid upload entirely", async () => {
  const env = setup();
  await env.instance.onload();
  env.failSaveWhen((snapshot) => snapshot.jobs.length > 0);
  await env.instance.start(env.audio, options);
  assert.equal(env.requests.length, 0);
  assert.equal(env.stored().jobs.length, 0);
  assert.equal(env.notes.size, 1, "The local draft remains available even when metadata storage fails");
  assert.ok(env.notices.length > 0);
});

test("successful result appends to the latest draft and preserves user edits", async () => {
  const env = setup();
  await env.instance.onload();
  env.setNetwork(async () => {
    const job = env.instance.data.jobs[0];
    env.notes.set(job.notePath, env.notes.get(job.notePath) + "\nMy manual meeting notes.\n");
    return success();
  });
  await env.instance.start(env.audio, options);
  const job = env.instance.data.jobs[0];
  const note = env.notes.get(job.notePath)!;
  assert.match(note, /My manual meeting notes/);
  assert.match(note, /The complete spoken content/);
  assert.ok(note.indexOf("My manual meeting notes") < note.indexOf(resultMarker(job.id)));
  assert.equal(job.status, "completed");
});

test("failed optional summary still saves the full transcript successfully", async () => {
  const env = setup();
  await env.instance.onload();
  env.setNetwork(async () => success({ summarization_status: "failed", summarization: null }));
  await env.instance.start(env.audio, { ...options, summaryPreset: "notes" });
  const job = env.instance.data.jobs[0];
  const note = env.notes.get(job.notePath)!;
  assert.equal(job.status, "completed");
  assert.match(note, /Summary unavailable/);
  assert.match(note, /The complete spoken content/);
});

test("disk failure while saving a result retains operation ID and resumes via GET only", async () => {
  const env = setup();
  await env.instance.onload();
  env.failProcess(true);
  await env.instance.start(env.audio, options);
  const job = env.instance.data.jobs[0];
  assert.equal(job.status, "paused");
  assert.equal(env.stored().jobs[0].operationId, operationId);
  assert.doesNotMatch(env.notes.get(job.notePath)!, /The complete spoken content/);
  env.failProcess(false);
  await env.instance.resume(job);
  assert.deepEqual(env.requests.map((request) => request.method), ["POST", "GET"]);
  assert.ok(env.requests[1].url.endsWith(`/api/operations/${operationId}`));
  assert.equal(job.status, "completed");
  assert.match(env.notes.get(job.notePath)!, /The complete spoken content/);
});

test("unknown upload outcome survives restart without any automatic upload or retry", async () => {
  const env = setup();
  await env.instance.onload();
  env.setNetwork(async () => { throw new Error("Connection dropped after bytes were sent"); });
  await env.instance.start(env.audio, options);
  assert.deepEqual(env.requests.map((request) => request.method), ["POST"]);
  assert.equal(env.stored().jobs[0].status, "unknown");
  assert.equal(env.stored().jobs[0].operationId, undefined);
  const restarted = setup(env.stored());
  await restarted.instance.onload();
  await restarted.instance.resume(restarted.instance.data.jobs[0]);
  assert.equal(restarted.requests.length, 0);
  assert.equal(restarted.instance.data.jobs[0].status, "unknown");
});

test("restart normalizes persisted uploading and processing jobs without network activity", async () => {
  const first: Job = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sourcePath: "Audio/one.wav", notePath: "Speech Expert/one.md",
    createdAt: "2026-11-13T00:00:00Z", options, status: "uploading",
  };
  const second: Job = { ...first, id: "c31005b8-8bb6-472a-b918-94ca7a7f88fe", sourcePath: "Audio/two.wav", notePath: "Speech Expert/two.md", status: "processing", operationId };
  const env = setup({ settings: {}, jobs: [first, second] });
  await env.instance.onload();
  assert.deepEqual(Array.from(env.instance.data.jobs, (job) => job.status), ["unknown", "paused"]);
  assert.equal(env.stored().jobs[1].operationId, operationId);
  assert.equal(env.requests.length, 0);
});

test("a user-repurposed draft is preserved and result goes into a new note", async () => {
  const env = setup();
  await env.instance.onload();
  let originalPath = "";
  env.setNetwork(async () => {
    originalPath = env.instance.data.jobs[0].notePath;
    env.notes.set(originalPath, "An unrelated note I intentionally wrote instead.");
    return success();
  });
  await env.instance.start(env.audio, options);
  assert.equal(env.notes.get(originalPath), "An unrelated note I intentionally wrote instead.");
  assert.notEqual(env.instance.data.jobs[0].notePath, originalPath);
  assert.match(env.notes.get(env.instance.data.jobs[0].notePath)!, /The complete spoken content/);
});

test("terminal operation error does not publish a partial response as completed transcript", async () => {
  const env = setup();
  await env.instance.onload();
  env.setNetwork(async () => ({ status: 200, text: JSON.stringify({ id: operationId, done: true, error: { code: 13, message: "internal backend details" }, response: { result: "Only partial content" } }) }));
  await env.instance.start(env.audio, options);
  const job = env.instance.data.jobs[0];
  assert.equal(job.status, "failed");
  assert.doesNotMatch(env.notes.get(job.notePath)!, /Only partial content|internal backend details/);
  assert.ok(env.notices.every((notice) => !notice.includes("internal backend details")));
});

test("unloading during the local read prevents an upload and result-note creation", async () => {
  const env = setup();
  await env.instance.onload();
  env.setReadBinary(async () => {
    env.instance.onunload();
    return new Uint8Array([1, 2, 3]).buffer;
  });
  await env.instance.start(env.audio, options);
  assert.equal(env.requests.length, 0);
  assert.equal(env.notes.size, 0);
  assert.equal(env.stored().jobs.length, 0);
});

test("a late POST reply after unload cannot overwrite durable state or append results", async () => {
  const env = setup();
  await env.instance.onload();
  let releaseResponse!: (value: Response) => void;
  let signalEntered!: () => void;
  const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const lateResponse = new Promise<Response>((resolve) => { releaseResponse = resolve; });
  env.setNetwork(async () => { signalEntered(); return lateResponse; });
  const pending = env.instance.start(env.audio, options);
  await entered;
  const savesBeforeUnload = env.saves.length;
  const snapshotBeforeUnload = env.stored();
  env.instance.onunload();
  releaseResponse(success());
  await pending;
  assert.equal(env.saves.length, savesBeforeUnload);
  assert.deepEqual(env.stored(), snapshotBeforeUnload);
  assert.equal(env.stored().jobs[0].status, "uploading");
  assert.equal(env.stored().jobs[0].operationId, undefined);
  assert.doesNotMatch(env.notes.get(env.stored().jobs[0].notePath)!, /The complete spoken content/);
  const restarted = setup(env.stored());
  await restarted.instance.onload();
  assert.equal(restarted.instance.data.jobs[0].status, "unknown");
  assert.equal(restarted.requests.length, 0);
});

test("restart after completion-metadata failure retrieves the same job without duplicating saved text", async () => {
  const env = setup();
  await env.instance.onload();
  env.failSaveWhen((snapshot) => snapshot.jobs.some((job) => job.status === "completed"));
  await env.instance.start(env.audio, options);
  const durable = env.stored().jobs[0];
  assert.equal(durable.status, "processing");
  assert.equal(durable.operationId, operationId);
  const alreadySaved = env.notes.get(durable.notePath)!;
  assert.ok(alreadySaved.includes(resultMarker(durable.id)));
  const restarted = setup(env.stored());
  for (const [path, entry] of env.files) restarted.files.set(path, entry);
  for (const [path, content] of env.notes) restarted.notes.set(path, content);
  await restarted.instance.onload();
  await restarted.instance.resume(restarted.instance.data.jobs[0]);
  assert.deepEqual(restarted.requests.map((request) => request.method), ["GET"]);
  assert.equal(restarted.notes.get(durable.notePath), alreadySaved);
  assert.equal(restarted.stored().jobs[0].status, "completed");
});
