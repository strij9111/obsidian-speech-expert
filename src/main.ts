import { App, FuzzySuggestModal, Modal, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, TFile, TFolder, getLanguage, normalizePath, requestUrl } from 'obsidian';
import { MODELS, SUMMARY_PRESETS, SUPPORTED_EXTENSIONS, escapeMarkdown, renderNote, safeOperationId, type Operation, type RequestOptions } from './core';
import { ApiError, SpeechExpertClient } from './client';
import { MAX_FILE_BYTES, appendResult, draftMarker, folderPath, loadData, safeFilename, validateFile, type Job, type PluginData } from './state';

const tr = (en: string, ru: string): string => getLanguage().startsWith('ru') ? ru : en;
const statusText = (job: Job): string => ({
  uploading: tr('Uploading','Загрузка'), unknown: tr('Upload outcome unknown','Результат загрузки неизвестен'),
  processing: tr('Processing','Обработка'), paused: tr('Waiting paused','Ожидание приостановлено'),
  completed: tr('Saved','Сохранено'), failed: tr('Failed','Ошибка'),
})[job.status];

export default class SpeechExpertPlugin extends Plugin {
  data!: PluginData;
  private saving: Promise<void> = Promise.resolve();
  private active = new Set<string>();
  private paused = new Set<string>();
  private listeners = new Set<() => void>();
  private disposed = false;
  private waiters = new Set<() => void>();

  async onload(): Promise<void> {
    this.data = loadData(await this.loadData());
    await this.persist();
    this.addSettingTab(new SpeechExpertSettings(this.app, this));
    this.addCommand({ id: 'transcribe-audio', name: tr('Transcribe an audio attachment','Расшифровать аудиофайл'), callback: () => new AudioPicker(this.app, this).open() });
    this.addCommand({ id: 'show-jobs', name: tr('View transcription jobs','Открыть задания расшифровки'), callback: () => new JobsModal(this.app, this).open() });
    this.addRibbonIcon('audio-lines', tr('Speech Expert: audio to notes','Speech Expert: аудио в заметку'), () => new AudioPicker(this.app, this).open());
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase())) {
        menu.addItem(item => item.setTitle(tr('Transcribe with Speech Expert…','Расшифровать в Speech Expert…')).setIcon('audio-lines').onClick(() => new UploadModal(this.app, this, file).open()));
      }
    }));
  }
  onunload(): void { this.disposed = true; this.listeners.clear(); for (const wake of this.waiters) wake(); this.waiters.clear(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { if (!this.disposed) for (const fn of this.listeners) fn(); }
  persist(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Plugin unloaded.'));
    const snapshot = JSON.parse(JSON.stringify(this.data)) as PluginData;
    this.saving = this.saving.catch(() => undefined).then(() => {
      if (this.disposed) throw new Error('Plugin unloaded.');
      return this.saveData(snapshot);
    });
    return this.saving;
  }
  private async checkpoint(): Promise<void> { await this.persist(); this.changed(); }
  isActive(job: Job): boolean { return this.active.has(job.id); }
  isWaitingPaused(job: Job): boolean { return this.paused.has(job.id); }
  client(): SpeechExpertClient {
    const key = this.app.secretStorage.getSecret(this.data.settings.secretName);
    if (!key) throw new ApiError(401);
    return new SpeechExpertClient(async request => {
      const response = await requestUrl({ ...request, throw: false });
      return { status: response.status, text: response.text };
    }, key);
  }
  showError(error: unknown): void {
    if (this.disposed) return;
    if (error instanceof ApiError) {
      const ru: Record<number,string> = {401:'Проверьте API-ключ в настройках.',403:'Ключ не имеет доступа.',402:'Недостаточно средств на балансе Speech Expert.',413:'Сервер отклонил размер файла.',429:'Слишком много запросов. Продолжите проверку позже.',404:'Операция не найдена или недоступна этому ключу.',400:'Проверьте файл и параметры.',422:'Проверьте файл и параметры.'};
      new Notice(tr(error.message, ru[error.status] ?? (error.ambiguous ? 'Результат загрузки неизвестен. Проверьте задания перед повторной отправкой.' : 'Не удалось получить результат. Задание можно проверить позже.')), 9000);
    } else new Notice(tr('Could not save or process the file. Check the folder, available storage, and plugin settings.','Не удалось сохранить или обработать файл. Проверьте папку, свободное место и настройки плагина.'),9000);
  }
  async createNote(job: Job): Promise<TFile> {
    const folder = folderPath(this.data.settings.outputFolder);
    let current = '';
    for (const part of folder.split('/')) {
      current = current ? current + '/' + part : part;
      const entry = this.app.vault.getAbstractFileByPath(current);
      if (!entry) await this.app.vault.createFolder(current);
      else if (!(entry instanceof TFolder)) throw new Error('Output path is a file.');
    }
    const base = `${safeFilename(job.sourcePath.split('/').pop() ?? 'Recording')} ${job.createdAt.replace(/[:.]/g,'-')} ${job.id.slice(0,8)}`;
    let path = normalizePath(`${folder}/${base}.md`);
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${base} ${suffix++}.md`);
    const text = `${draftMarker(job.id)}\n\n# ${tr('Audio transcription','Расшифровка аудио')}\n\n${escapeMarkdown(job.sourcePath)}\n\n${tr('The result will be appended here. To check this job, use Speech Expert: View transcription jobs.','Результат будет добавлен ниже. Проверить задание можно командой Speech Expert: Открыть задания расшифровки.')}\n`;
    const file = await this.app.vault.create(path, text);
    job.notePath = file.path;
    return file;
  }
  async start(file: TFile, options: RequestOptions): Promise<void> {
    if (this.disposed) return;
    if ([...this.active].length) { new Notice(tr('Wait for the current job or pause waiting first.','Дождитесь текущего задания или приостановите ожидание.')); return; }
    if (this.data.jobs.some(job => job.sourcePath === file.path && job.status !== 'completed' && job.status !== 'failed')) {
      new Notice(tr('Check the existing job for this file first.','Сначала проверьте существующее задание для этого файла.')); return;
    }
    validateFile(file.stat.size, file.extension, SUPPORTED_EXTENSIONS);
    const client = this.client();
    const job: Job = { id:crypto.randomUUID(), sourcePath:file.path, notePath:'', createdAt:new Date().toISOString(), options, status:'uploading' };
    this.active.add(job.id);
    try {
      // Read before creating the persisted upload checkpoint: no network has happened yet.
      const audio = await this.app.vault.readBinary(file);
      if (this.disposed) return;
      validateFile(audio.byteLength, file.extension, SUPPORTED_EXTENSIONS);
      await this.createNote(job);
      this.data.jobs.push(job);
      await this.checkpoint(); // If this fails, do not send paid work.
      if (this.disposed) return;
      let op: Operation;
      try { op = await client.upload(audio, file.name, options); }
      catch (error) {
        job.status = error instanceof ApiError && !error.ambiguous ? 'failed' : 'unknown';
        if (error instanceof ApiError) job.errorCode = error.status;
        await this.checkpoint(); throw error;
      }
      if (this.disposed) return; // Durable checkpoint remains unknown; never replay the upload.
      job.operationId = op.id; job.status = 'processing';
      await this.checkpoint();
      await this.poll(job, client, op);
    } catch (error) {
      if (job.operationId && job.status !== 'completed' && job.status !== 'failed') job.status = 'paused';
      else if (!job.operationId && job.status === 'uploading') job.status = 'unknown';
      this.showError(error);
      try { await this.checkpoint(); } catch { /* ID remains available in the current jobs window. */ }
    } finally { this.active.delete(job.id); this.changed(); }
  }
  pause(job: Job): void { this.paused.add(job.id); this.changed(); }
  async resume(job: Job): Promise<void> {
    if (this.disposed || !job.operationId || this.active.has(job.id) || !this.data.jobs.includes(job)) return;
    this.active.add(job.id); this.paused.delete(job.id);
    try {
      const client = this.client(); job.status = 'processing'; await this.checkpoint();
      if (this.disposed) return;
      await this.poll(job, client);
    } catch (error) { job.status = 'paused'; this.showError(error); try { await this.checkpoint(); } catch { /* visible metadata stays */ } }
    finally { this.active.delete(job.id); this.changed(); }
  }
  private async poll(job: Job, client: SpeechExpertClient, first?: Operation): Promise<void> {
    let op = first;
    const deadline = Date.now() + 30 * 60 * 1000;
    while (!this.disposed && !this.paused.has(job.id)) {
      op ??= await client.getOperation(job.operationId!);
      if (this.disposed || this.paused.has(job.id)) break;
      job.progress = op.metadata?.progress_percent;
      if (op.done) {
        if (op.error) { job.status = 'failed'; job.errorCode = op.error.code; await this.checkpoint(); this.showError(new ApiError(op.error.code ?? 0)); return; }
        if (!op.response) throw new ApiError(0);
        let file = this.app.vault.getAbstractFileByPath(job.notePath);
        if (!(file instanceof TFile) || !(await this.app.vault.read(file)).includes(draftMarker(job.id))) {
          if (this.disposed) return;
          file = await this.createNote(job); await this.checkpoint();
        }
        if (this.disposed) return;
        const source = this.app.vault.getAbstractFileByPath(job.sourcePath);
        const sourceLink = source instanceof TFile ? this.app.fileManager.generateMarkdownLink(source, job.notePath) : escapeMarkdown(job.sourcePath);
        const note = renderNote(op.response, { sourcePath:job.sourcePath, sourceLink, model:job.options.model, operationId:job.operationId!, createdAt:job.createdAt, options:job.options, locale:getLanguage().startsWith('ru')?'ru':'en' });
        await this.app.vault.process(file as TFile, existing => appendResult(existing, job.id, note));
        job.status = 'completed'; await this.checkpoint();
        new Notice(tr('Transcription saved. Open it from Speech Expert jobs.','Расшифровка сохранена. Откройте её из списка заданий Speech Expert.'));
        return;
      }
      this.changed();
      if (Date.now() >= deadline) break;
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, 5000);
        this.waiters.add(wake);
      });
      op = undefined;
    }
    if (!this.disposed) { job.status = 'paused'; await this.checkpoint(); }
  }
}

class AudioPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: SpeechExpertPlugin) { super(app); this.setPlaceholder(tr('Choose an audio attachment','Выберите аудиофайл из хранилища')); }
  getItems(): TFile[] { return this.app.vault.getFiles().filter(file => SUPPORTED_EXTENSIONS.has(file.extension.toLowerCase())); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { new UploadModal(this.app, this.plugin, file).open(); }
}

class UploadModal extends Modal {
  constructor(app: App, private plugin: SpeechExpertPlugin, private file: TFile) { super(app); }
  onOpen(): void {
    const el = this.contentEl; el.empty();
    el.createEl('h2',{text:tr('Audio to note','Аудио в заметку')});
    el.createEl('p',{text:this.file.path,cls:'speech-expert-path'});
    el.createEl('p',{text:`${(this.file.stat.size / 1024 / 1024).toFixed(1)} MiB · ${tr('Russian audio · maximum 100 MiB','Русская речь · максимум 100 МиБ')}`});
    const options: RequestOptions = { model:this.plugin.data.settings.model,language:'ru-RU',diarization:false,summaryPreset:null };
    new Setting(el).setName(tr('Recognition model','Модель распознавания')).addDropdown(d => { for (const model of MODELS) d.addOption(model.id,model.label); d.setValue(options.model).onChange(v => options.model=v); });
    new Setting(el).setName(tr('Separate speakers','Разделять говорящих')).setDesc(tr('Adds the service speaker-separation charge. Speaker labels are anonymous.','Доплата по тарифу разделения говорящих. Метки говорящих анонимны.')).addToggle(t => t.setValue(false).onChange(v => options.diarization=v));
    new Setting(el).setName(tr('Summary','Резюме')).setDesc(tr('Optional. Sends the transcript to the service’s external AI providers. Review generated conclusions.','При включении текст передаётся внешним AI-провайдерам сервиса. Проверяйте сгенерированные выводы.')).addDropdown(d => {
      d.addOption('',tr('Transcript only','Только расшифровка'));
      const labels: Record<string,string> = {short:tr('Brief summary','Кратко'),notes:tr('Notes','Заметки'),conversation:tr('Conversation','Разговор'),action_items:tr('Decisions and tasks','Решения и задачи'),lecture:tr('Lecture','Лекция')};
      for (const p of SUMMARY_PRESETS) d.addOption(p,labels[p]); d.setValue('').onChange(v => options.summaryPreset=v||null);
    });
    const p = el.createEl('p');
    p.appendText(tr('The selected file and its filename are uploaded to speech-expert.ru. An account, API key and sufficient credits are required. Results are stored by the service under its privacy policy. ','Выбранный файл и его имя отправятся на speech-expert.ru. Нужны аккаунт, API-ключ и достаточный баланс. Результат хранится на сервере по политике сервиса. '));
    p.createEl('a',{text:tr('Service and pricing','Сервис и тарифы'),href:'https://speech-expert.ru/'});
    const valid = this.file.stat.size > 0 && this.file.stat.size <= MAX_FILE_BYTES;
    if (!valid) el.createEl('p',{text:tr('Choose a non-empty audio file up to 100 MiB.','Выберите непустой аудиофайл размером до 100 МиБ.'),cls:'speech-expert-warning'});
    const duplicate = this.plugin.data.jobs.some(j=>j.sourcePath===this.file.path && j.status!=='completed' && j.status!=='failed');
    if (duplicate) el.createEl('p',{text:tr('This file has an unresolved job. Check it first to avoid paying twice.','Для этого файла есть незавершённое задание. Сначала проверьте его, чтобы избежать повторной оплаты.'),cls:'speech-expert-warning'});
    let consent = false;
    new Setting(el).addButton(b => b.setButtonText(tr('View jobs','Открыть задания')).onClick(()=>{this.close();new JobsModal(this.app,this.plugin).open();}));
    const consentSetting = new Setting(el).setName(tr('I agree to upload this file with these options','Согласен отправить этот файл с выбранными настройками'));
    const sendSetting = new Setting(el);
    sendSetting.addButton(button => {
      button.setButtonText(tr('Upload and transcribe','Отправить и расшифровать')).setCta().setDisabled(true);
      consentSetting.addToggle(t=>t.setValue(false).onChange(v=>{consent=v;button.setDisabled(!consent||!valid||duplicate);}));
      button.onClick(()=>{if(!consent||!valid||duplicate)return;this.close();new JobsModal(this.app,this.plugin).open();void this.plugin.start(this.file,{...options}).catch(e=>this.plugin.showError(e));});
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

class JobsModal extends Modal {
  private unsubscribe?: ()=>void;
  constructor(app: App, private plugin: SpeechExpertPlugin) { super(app); }
  onOpen(): void { this.unsubscribe=this.plugin.subscribe(()=>this.render());this.render(); }
  render(): void {
    const el=this.contentEl;el.empty();el.createEl('h2',{text:tr('Transcription jobs','Задания расшифровки')});
    el.createEl('p',{text:tr('Pausing or closing Obsidian stops checking, not server processing or charges. Resume retrieves the same operation without uploading again.','Пауза и закрытие Obsidian останавливают ожидание, но не обработку и списания на сервере. Продолжение проверяет ту же операцию без повторной загрузки.')});
    if(!this.plugin.data.jobs.length)el.createEl('p',{text:tr('No jobs yet.','Заданий пока нет.')});
    for(const job of [...this.plugin.data.jobs].reverse()) {
      const row=el.createDiv({cls:'speech-expert-job'});
      row.createEl('strong',{text:job.sourcePath,cls:'speech-expert-path'});
      row.createEl('p',{text:`${statusText(job)}${job.status==='processing'&&job.progress!==undefined?` · ~${Math.round(job.progress)}%`:''}`});
      if (job.status === 'failed') row.createEl('p',{text:tr('Processing failed. Check the balance, file and API key before starting another job.','Обработка не завершена. Проверьте баланс, файл и API-ключ перед новой отправкой.')+(job.errorCode ? ` (${job.errorCode})` : ''),cls:'speech-expert-warning'});
      if(job.operationId)row.createEl('code',{text:job.operationId});
      const actions=new Setting(row);
      actions.addButton(b=>b.setButtonText(tr('Open note','Открыть заметку')).onClick(()=>{void this.app.workspace.openLinkText(job.notePath,'',true);}));
      if(this.plugin.isActive(job)) {
        if(job.operationId)actions.addButton(b=>b.setButtonText(this.plugin.isWaitingPaused(job)?tr('Pausing…','Пауза…'):tr('Pause waiting','Приостановить ожидание')).setDisabled(this.plugin.isWaitingPaused(job)).onClick(()=>this.plugin.pause(job)));
      } else if(job.operationId && job.status!=='completed' && job.status!=='failed') {
        actions.addButton(b=>b.setButtonText(tr('Resume checking','Продолжить проверку')).onClick(()=>{void this.plugin.resume(job);}));
      }
      if(job.status==='unknown' && !job.operationId && !this.plugin.isActive(job)) {
        row.createEl('p',{text:tr('The server may have accepted this upload. Check your account before sending it again. If you find its operation ID, attach it to retrieve the result.','Сервер мог принять загрузку. Проверьте аккаунт перед повторной отправкой. Если нашли номер операции, укажите его для получения результата.')});
        let id='';new Setting(row).setName(tr('Existing operation ID','Номер существующей операции')).addText(t=>t.setPlaceholder('UUID').onChange(v=>id=v.trim())).addButton(b=>b.setButtonText(tr('Attach and check','Привязать и проверить')).onClick(async()=>{
          try{const checked=safeOperationId(id);const op=await this.plugin.client().getOperation(checked);job.operationId=op.id;job.status='paused';await this.plugin.persist();this.render();await this.plugin.resume(job);}catch(e){this.plugin.showError(e);}
        }));
      }
      if(!this.plugin.isActive(job))actions.addButton(b=>b.setButtonText(tr('Remove from list','Убрать из списка')).onClick(()=>{this.close();new RemoveJobModal(this.app,this.plugin,job).open();}));
    }
  }
  onClose(): void { this.unsubscribe?.();this.contentEl.empty(); }
}

class RemoveJobModal extends Modal {
  constructor(app:App,private plugin:SpeechExpertPlugin,private job:Job){super(app);}
  onOpen():void{
    this.contentEl.createEl('h2',{text:tr('Remove job metadata?','Убрать задание из списка?')});
    this.contentEl.createEl('p',{text:tr('This removes the local recovery record. The note, original audio and server operation remain. Keep the operation ID if you need it.','Будет удалена локальная запись для восстановления. Заметка, исходное аудио и операция на сервере останутся. Сохраните номер операции, если он нужен.')});
    new Setting(this.contentEl).addButton(b=>b.setButtonText(tr('Keep','Оставить')).onClick(()=>this.close())).addButton(b=>b.setButtonText(tr('Remove','Убрать')).setWarning().onClick(async()=>{if(this.plugin.isActive(this.job))return;this.plugin.data.jobs=this.plugin.data.jobs.filter(j=>j.id!==this.job.id);try{await this.plugin.persist();this.close();new JobsModal(this.app,this.plugin).open();}catch(e){this.plugin.showError(e);}}));
  }
}

class SpeechExpertSettings extends PluginSettingTab {
  constructor(app:App,private plugin:SpeechExpertPlugin){super(app,plugin);}
  display():void {
    const el=this.containerEl;el.empty();
    el.createEl('p',{text:tr('Russian audio → transcript and optional summary. The plugin is free; Speech Expert processing uses your account credits.','Русское аудио → расшифровка и необязательное резюме. Плагин бесплатный; обработка расходует кредиты вашего аккаунта Speech Expert.')});
    new Setting(el).setName(tr('API key','API-ключ')).setDesc(tr('Select or create a secret. Only its name is stored in plugin settings.','Выберите или создайте секрет. В настройках плагина хранится только его имя.')).addComponent(container=>new SecretComponent(this.app,container).setValue(this.plugin.data.settings.secretName).onChange(async value=>{this.plugin.data.settings.secretName=value??'';try{await this.plugin.persist();}catch(e){this.plugin.showError(e);}}));
    new Setting(el).setName(tr('Check API key','Проверить ключ')).setDesc(tr('Reads the public service catalog with this key; does not submit paid processing.','Проверяет доступ к каталогу сервиса по ключу и не запускает платную обработку.')).addButton(b=>b.setButtonText(tr('Check','Проверить')).onClick(async()=>{b.setDisabled(true);try{await this.plugin.client().checkKey();new Notice(tr('API key works.','Ключ работает.'));}catch(e){this.plugin.showError(e);}finally{b.setDisabled(false);}}));
    new Setting(el).setName(tr('Output folder','Папка результатов')).setDesc(tr('Relative path inside this vault. Saved when you leave the field. Existing notes are preserved.','Путь внутри хранилища. Сохраняется при выходе из поля. Существующие заметки сохраняются.')).addText(t=>{
      t.setValue(this.plugin.data.settings.outputFolder);
      t.inputEl.addEventListener('blur',()=>{void (async()=>{try{this.plugin.data.settings.outputFolder=folderPath(t.getValue());await this.plugin.persist();}catch(e){t.setValue(this.plugin.data.settings.outputFolder);this.plugin.showError(e);}})();});
    });
    new Setting(el).setName(tr('Default model','Модель по умолчанию')).addDropdown(d=>{for(const m of MODELS)d.addOption(m.id,m.label);d.setValue(this.plugin.data.settings.model).onChange(async value=>{this.plugin.data.settings.model=value;try{await this.plugin.persist();}catch(e){this.plugin.showError(e);}});});
    new Setting(el).setName(tr('Transcription jobs','Задания расшифровки')).addButton(b=>b.setButtonText(tr('Open','Открыть')).onClick(()=>new JobsModal(this.app,this.plugin).open()));
    const p=el.createEl('p');p.createEl('a',{text:tr('Account, pricing and service privacy policy','Аккаунт, тарифы и политика сервиса'),href:'https://speech-expert.ru/'});
  }
}
