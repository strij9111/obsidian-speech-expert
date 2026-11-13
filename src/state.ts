import { MODELS, safeOperationId, validateOptions, type RequestOptions } from './core';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export type JobStatus = 'uploading'|'unknown'|'processing'|'paused'|'completed'|'failed';
export interface Job {
  id: string; sourcePath: string; notePath: string; createdAt: string;
  options: RequestOptions; status: JobStatus; operationId?: string;
  progress?: number; errorCode?: number;
}
export interface Settings { secretName: string; outputFolder: string; model: string; }
export interface PluginData { settings: Settings; jobs: Job[]; }
export const DEFAULT_SETTINGS: Settings = { secretName: 'speech-expert-api-key', outputFolder: 'Speech Expert', model: MODELS[0].id };

export function folderPath(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path || path.startsWith('/') || /[:\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Choose a relative folder inside the vault.');
  }
  return path;
}

export function safeFilename(value: string): string {
  const result = value.replace(/[\\/:*?"<>|\x00-\x1f\[\]#^]/g, '_').replace(/[. ]+$/, '').slice(0, 80).trim();
  return result || 'Recording';
}

export function validateFile(size: number, extension: string, supported: Set<string>): void {
  if (!supported.has(extension.toLowerCase())) throw new Error('Choose a supported audio attachment.');
  if (!Number.isFinite(size) || size <= 0) throw new Error('The audio file is empty or unavailable.');
  if (size > MAX_FILE_BYTES) throw new Error('The plugin supports files up to 100 MiB.');
}

/** Never resume an upload on startup. Discard unknown properties, including legacy keys. */
export function loadData(value: unknown): PluginData {
  const data = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  const raw = data.settings && typeof data.settings === 'object' ? data.settings as Record<string,unknown> : {};
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw.secretName === 'string' && /^(?:[a-z0-9-]{1,100})?$/.test(raw.secretName)) settings.secretName = raw.secretName;
  if (typeof raw.model === 'string' && MODELS.some(m => m.id === raw.model)) settings.model = raw.model;
  if (typeof raw.outputFolder === 'string') { try { settings.outputFolder = folderPath(raw.outputFolder); } catch { /* default */ } }
  const jobs: Job[] = [];
  for (const v of Array.isArray(data.jobs) ? data.jobs : []) {
    if (!v || typeof v !== 'object') continue;
    try {
      const j = v as Job;
      safeOperationId(j.id);
      if (jobs.some(existing => existing.id === j.id) || typeof j.sourcePath !== 'string' || typeof j.notePath !== 'string'
        || !Number.isFinite(Date.parse(j.createdAt))) continue;
      folderPath(j.sourcePath); folderPath(j.notePath);
      if (!j.notePath.endsWith('.md')) continue;
      validateOptions(j.options);
      if (!['uploading','unknown','processing','paused','completed','failed'].includes(j.status)) continue;
      const operationId = j.operationId ? safeOperationId(j.operationId) : undefined;
      const status: JobStatus = ['uploading','processing','paused','unknown'].includes(j.status) ? (operationId ? 'paused' : 'unknown') : j.status;
      jobs.push({ id:j.id, sourcePath:j.sourcePath, notePath:j.notePath, createdAt:j.createdAt,
        options: { model:j.options.model, language:j.options.language, diarization:j.options.diarization, summaryPreset:j.options.summaryPreset },
        status, ...(operationId ? { operationId } : {}), ...(typeof j.errorCode === 'number' ? {errorCode:j.errorCode} : {}),
      });
    } catch { /* Ignore malformed or unsupported job metadata; never execute it. */ }
  }
  return { settings, jobs };
}

export function resultMarker(id: string): string { return `<!-- speech-expert-result:${safeOperationId(id)} -->`; }
export function draftMarker(id: string): string { return `<!-- speech-expert-job:${safeOperationId(id)} -->`; }
export function appendResult(existing: string, id: string, result: string): string {
  if (!existing.includes(draftMarker(id))) throw new Error('The destination note no longer belongs to this job.');
  if (existing.includes(resultMarker(id))) return existing;
  return `${existing.trimEnd()}\n\n${resultMarker(id)}\n\n${result}\n`;
}
