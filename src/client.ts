import { API_BASE, buildMultipart, parseOperation, safeOperationId, validateOptions, type Operation, type RequestOptions } from './core';

export type HttpRequest = { url: string; method: string; headers: Record<string,string>; body?: ArrayBuffer };
export type HttpResponse = { status: number; text: string };
export type Transport = (request: HttpRequest) => Promise<HttpResponse>;

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly ambiguous: boolean = false) {
    super(status === 401 || status === 403 ? 'Check your Speech Expert API key.'
      : status === 402 ? 'Insufficient Speech Expert balance.'
      : status === 413 ? 'The server rejected the file size.'
      : status === 429 ? 'Too many requests. Wait before checking again.'
      : status === 404 ? 'Operation not found or no longer available for this key.'
      : status === 400 || status === 422 ? 'The server rejected the file or options.'
      : ambiguous ? 'The upload outcome is unknown. Do not upload again automatically.'
      : 'Could not get a valid response. You can resume checking later.');
  }
}

export class SpeechExpertClient {
  constructor(private readonly transport: Transport, private readonly key: string, private readonly timeoutMs = 120_000) {
    if (!key.trim() || /[\r\n]/.test(key)) throw new ApiError(401);
  }
  private async request(path: string, method: 'GET'|'POST', body?: ArrayBuffer, contentType?: string): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: HttpResponse;
    try {
      response = await Promise.race([
        this.transport({ url: API_BASE + path, method, body, headers: {
          Authorization: `Api-Key ${this.key.trim()}`, Accept: 'application/json',
          ...(contentType ? {'Content-Type': contentType} : {}),
        }}),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs); }),
      ]);
    } catch { throw new ApiError(0, method === 'POST'); }
    finally { if (timer) clearTimeout(timer); }
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(response.status, method === 'POST' && (response.status >= 500 || response.status === 408));
    }
    try { return JSON.parse(response.text); }
    catch { throw new ApiError(0, method === 'POST'); }
  }
  async checkKey(): Promise<void> {
    const result = await this.request('/api/creator-research/presets', 'GET');
    if (!result || typeof result !== 'object' || !Array.isArray((result as {presets?: unknown}).presets)) throw new ApiError(0);
  }
  async upload(audio: ArrayBuffer, filename: string, options: RequestOptions): Promise<Operation> {
    validateOptions(options);
    const multipart = buildMultipart(audio, filename, options);
    const result = await this.request(`/api/stt/v1:recognizeAsync?model=${encodeURIComponent(options.model)}`, 'POST', multipart.body, multipart.contentType);
    try { return parseOperation(result); }
    catch { throw new ApiError(0, true); }
  }
  async getOperation(id: string): Promise<Operation> {
    safeOperationId(id);
    const result = await this.request(`/api/operations/${encodeURIComponent(id)}`, 'GET');
    let operation: Operation;
    try { operation = parseOperation(result); } catch { throw new ApiError(0); }
    if (operation.id !== id) throw new ApiError(0);
    return operation;
  }
}
