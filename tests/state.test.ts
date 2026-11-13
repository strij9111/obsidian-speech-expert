import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SUPPORTED_EXTENSIONS } from '../src/core.ts';
import { MAX_FILE_BYTES, appendResult, draftMarker, folderPath, loadData, validateFile } from '../src/state.ts';

const id = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const options = {model:'SpeechExpert-STT-RU',language:'ru-RU',diarization:false,summaryPreset:null};
const job = {id,sourcePath:'Audio/meeting.mp3',notePath:'Notes/meeting.md',createdAt:'2026-11-13T00:00:00Z',options,status:'uploading'};

test('recovery stores only metadata and never restores legacy secrets or transcript fields',()=>{
  const result = loadData({key:'secret',settings:{apiKey:'secret',secretName:'chosen-key'},jobs:[{...job,transcript:'private text',audio:'private bytes',options:{...options,apiKey:'secret'}}]});
  assert.equal(result.settings.secretName,'chosen-key');
  assert.equal(result.jobs[0].status,'unknown');
  assert.doesNotMatch(JSON.stringify(result),/private|apiKey|"key"/);
  assert.equal(result.jobs[0].options.summaryPreset,null);
});

test('explicitly clearing the secret selection survives restart',()=>{
  assert.equal(loadData({settings:{secretName:''}}).settings.secretName,'');
});

test('known operations pause after restart; unidentified operations remain unknown',()=>{
  for(const status of ['uploading','processing','paused','unknown']) {
    assert.equal(loadData({jobs:[{...job,status,operationId}]}).jobs[0].status,'paused');
    assert.equal(loadData({jobs:[{...job,status}]}).jobs[0].status,'unknown');
  }
});

test('invalid and duplicate recovery records cannot run or target outside the vault',()=>{
  const candidates = [job,{...job},{...job,id:'bad'}, {...job,id:operationId,notePath:'../../elsewhere.md'}, {...job,id:operationId,sourcePath:'C:/private.wav'}, {...job,id:operationId,operationId:'../other'}, {...job,id:operationId,options:{...options,model:'untrusted'}}];
  assert.equal(loadData({jobs:candidates}).jobs.length,1);
  for(const value of ['/absolute','../up','ok/../../up','C:\\outside','foo//bar','foo\nbar']) assert.throws(()=>folderPath(value));
  assert.equal(folderPath('Notes\\Speech Expert/'),'Notes/Speech Expert');
});

test('result insertion preserves manual text and is idempotent across resumed checks',()=>{
  const draft = `${draftMarker(id)}\n\nMy annotations: keep me.\n`;
  const first = appendResult(draft,id,'The transcript.');
  assert.ok(first.startsWith(draft.trimEnd()));
  assert.match(first,/My annotations: keep me/);
  assert.equal(appendResult(first,id,'A repeated result.'),first);
  assert.throws(()=>appendResult('A different note.',id,'Do not overwrite'));
});

test('file limits enforce exact bytes, supported formats and nonempty content',()=>{
  validateFile(MAX_FILE_BYTES,'MP3',SUPPORTED_EXTENSIONS);
  for(const size of [0,-1,NaN,Infinity,MAX_FILE_BYTES+1]) assert.throws(()=>validateFile(size,'mp3',SUPPORTED_EXTENSIONS));
  assert.throws(()=>validateFile(10,'exe',SUPPORTED_EXTENSIONS));
});
