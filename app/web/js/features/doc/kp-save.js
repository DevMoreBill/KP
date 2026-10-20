import { DocImages } from './doc-images.js';
import { KpDocx } from './kp-docx.js';
import { KpFile } from './kp-file.js';
import { PdfExport } from './pdf-export.js';
import { Templates } from './templates.js';

/**
 * Сохранение КП: номер, файл Word по шаблону, состояние КП в журнал (с номером правки), каталог и клиент, файл на сервер,
 * описание для журнала и сделки, PDF рядом — по галочке. Пробный файл — без номера и записи в журнал.
 */
export class KpSave {
  static busy = false;
  static JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
  static ERRORS = new Map([
    ['declined', 'Сохранение отменено.'],
    ['rate_limited', 'Окно сохранения уже открыто.'],
  ]);
  static TRIAL_KEEP = 30000;

  static _declined(message) {
    return Object.assign(new Error(message), { code: 'declined' });
  }

  /**
   * Пробный файл: текущее КП по шаблону с несохранёнными настройками — без номера и записи в журнал.
   * @param {string} id шаблон
   * @param {object} [settings] настройки шаблона (пусто — сохранённые)
   */
  static async trial(id, settings) {
    if (!S.items.length) throw new Error('добавьте в КП хотя бы одну позицию — пробный файл строится по текущему КП');
    const pack = await Templates.pack(id);
    await StationImages.syncAll();
    const state = KpDocx.state();
    if (!state.number) state.number = 'ПРОБНЫЙ';
    const blob = await KpDocx.render(state, pack, settings || pack.settings);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Пробный_${KpFile.name(settings || pack.settings)}`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, this.TRIAL_KEEP);
  }

  /** «Сохранить КП»: второе нажатие (кнопка панели телефона) — не второе КП. */
  static async run() {
    const message = $('#dlmsg');
    const button = document.querySelector('[data-a="download"]');
    if (problems().length || this.busy) return;
    if (!window.JSZip) {
      message.className = 'msg err';
      message.textContent = 'Не загрузился модуль сборки файла. Обновите страницу.';
      return;
    }
    const all = [...document.querySelectorAll('[data-a="download"]')];
    this.busy = true;
    all.forEach(item => {
      item.disabled = true;
    });
    button.textContent = 'Собираю файл…';
    message.textContent = '';
    try {
      await this._save(button);
    } catch (error) {
      message.className = 'msg err';
      message.textContent =
        this.ERRORS.get(error && error.code) || `Не удалось собрать файл: ${(error && error.message) || error}`;
    }
    Drafts.paused = false;
    this.busy = false;
    all.forEach(item => {
      item.disabled = false;
    });
    button.textContent = S.kpId ? `Сохранить изменения КП № ${S.number}` : 'Сохранить КП';
  }

  static async _save(button) {
    await StationImages.syncAll(); // 3D-вид и чертёж станций — по текущему составу
    if (!StationImages.confirmSave()) throw this._declined('изображения станции не готовы');
    MgrLock.apply(); // вход по паролю: в КП — контакты вошедшего менеджера
    if (MgrLock.on()) {
      clearTimeout(mgrT);
      await saveManager(true); // свежие правки своих контактов — в карточку до записи КП
    }
    const state = KpDocx.state();
    const isNew = !S.kpId;
    const pack = await this._pack();
    await this._number(state);
    const blob = await KpDocx.render(state, pack, pack.settings);
    button.textContent = 'Сохраняю в журнал…';
    Drafts.paused = true; // автосохранение черновика не вмешивается в сохранение КП
    await this._uploadImages();
    if (!S.managerId && String(S.manager.name || '').trim()) await saveManager(true); // новый менеджер — в справочник
    if (!S.authorId) S.authorId = meId() || S.managerId || '';
    const totals = totalsS();
    const fileName = KpFile.name();
    if (!S.createdAt) S.createdAt = new Date().toISOString();
    const sig = await this._journal();
    const saved = await this._putDocx(blob, fileName);
    await this._meta(totals, saved);
    await Drafts.saved(sig); // КП в журнале — черновик не нужен; правки во время сохранения остаются несохранёнными
    if (Drafts.sig(Drafts.clean()) !== sig)
      toast('Изменения, сделанные во время сохранения, в КП не вошли — сохраните КП ещё раз');
    const pdf = await this._pdf(button);
    rememberConds();
    persist();
    renderForm();
    this._done(pdf, isNew);
  }

  static async _pack() {
    if (!S.template) throw new Error('не выбран шаблон КП (папка templates рядом с программой пуста)');
    try {
      return await Templates.pack(S.template);
    } catch (error) {
      throw new Error(`шаблон «${S.template}» не загрузился: ${error.message}`);
    }
  }

  // новое КП — номер с сервера; КП успели пересохранить у коллеги — спросить до записи файла
  static async _number(state) {
    if (!S.kpId) {
      const created = await api('/api/kp/new', { method: 'POST' });
      S.kpId = created.id;
      S.number = created.number;
      state.kpId = created.id;
      state.number = created.number;
      S.authorId = meId() || S.managerId || '';
      S._rev = 0;
      return;
    }
    if (S._rev != null) {
      const current = await api(`/api/kp/${S.kpId}/rev`);
      if (current.rev === S._rev) return;
      if (!conflictAsk(current, '/api/kp/')) throw this._declined('declined');
      S._rev = current.rev;
      return;
    }
    if (!S.authorId && DealDefaults.allowed()) S.authorId = meId() || S.managerId || ''; // КП прежней версии
  }

  static async _uploadImages() {
    for (const item of S.items) {
      item.photo = await ImgUpload.put(item.photo, imgPlace(item, 'photo'));
      item.logo = await ImgUpload.put(item.logo, imgPlace(item, 'logo'));
      await this._uploadGallery(item);
      for (const part of Kit.parts(item)) {
        if (part.photo) part.photo = await ImgUpload.put(part.photo, imgPlace(item, 'gallery', { caption: part.name }));
        if (part.draw) part.draw = await DrawPic.upload(part.draw, item, part.name);
      }
      if (item.draw) item.draw = await DrawPic.upload(item.draw, item);
    }
  }

  static async _uploadGallery(item) {
    for (const image of item.gallery || []) {
      const uploaded = await ImgUpload.put(image, imgPlace(item, 'gallery', image));
      if (uploaded) image.src = uploaded.src;
    }
  }

  static async _putState() {
    const clean = Drafts.clean();
    const headers = { ...this.JSON_HEADERS, ...(S._rev != null ? { 'X-KP-Rev': String(S._rev) } : {}) };
    const result = await api(`/api/kp/${S.kpId}/state`, { method: 'PUT', headers, body: JSON.stringify(clean) });
    if (result && result.rev != null) S._rev = result.rev;
    return Drafts.sig(clean);
  }

  static _catalogIds() {
    return JSON.stringify(S.items.map(item => [item.catId, (item.options || []).map(option => option.catId)]));
  }

  // сначала — состояние КП в журнал (с номером правки): если КП успел пересохранить коллега и менеджер выбрал «Отмена»,
  // ни файл Word, ни цены каталога ещё не тронуты; файл и каталог — только после того, как журнал принял КП
  static async _journal() {
    let sig = await this._putState();
    const ids = this._catalogIds();
    await syncCatalog(S.number);
    await saveClient(true);
    if (this._catalogIds() !== ids) sig = await this._putState(); // новые позиции каталога — их коды в КП
    return sig;
  }

  // имя файла может получить «(2)», если такое уже занято другим КП (два КП по одному тендеру)
  static async _putDocx(blob, fileName) {
    const query = `name=${encodeURIComponent(fileName)}&dir=${encodeURIComponent(KpFile.folder())}`;
    const result = await api(`/api/kp/${S.kpId}/docx?${query}`, { method: 'PUT', body: blob });
    const saved = (result && result.rel ? String(result.rel).split('/').pop() : '') || fileName;
    S._file = saved;
    return saved;
  }

  static _metaBody(totals, file) {
    return {
      id: S.kpId,
      number: S.number,
      date: S.date,
      client: S.client,
      clientInn: S.clientInn || '',
      sum: totals.sum,
      units: totals.units,
      positions: S.items.length,
      items: S.items.map(item => item.name).slice(0, 3),
      file,
      manager: S.manager.name,
      tender: tenderNo() ? { number: tenderNo(), url: tenderUrl() } : undefined,
      managerPost: S.manager.position || '',
      createdAt: S.createdAt,
      savedAt: new Date().toISOString(),
      econ: kpEconomics(),
      authorId: S.authorId || '',
      managerId: S.managerId || '',
      deal: DealState.summary(),
      validUntil: KpDate.validUntil() || undefined,
      plan: DealPlan.of(),
      dealId: S.dealId || undefined,
      lines: KpLines.of(),
    };
  }

  static async _meta(totals, file) {
    const body = JSON.stringify(this._metaBody(totals, file));
    const result = await api(`/api/kp/${S.kpId}/meta`, { method: 'PUT', headers: this.JSON_HEADERS, body });
    if (result && result.deal) S.dealId = result.deal; // КП в сделке: следующее сохранение — в ту же сделку
    // связь с Битрикс24: Excel экономики сделки собирается здесь (в браузере автора) и уходит в ленту сделки
    if (!result || !result.bx || !S.deal || !S.deal.touched || !DealDefaults.allowed()) return;
    const kpId = S.kpId;
    dealXlsx({ blob: true })
      .then(xlsx => xlsx && api(`/api/kp/${kpId}/econ`, { method: 'PUT', body: xlsx }))
      .catch(error => console.warn('Экономика для Битрикс24 не отправлена:', error));
  }

  // PDF рядом с .docx — по галочке «Также сохранить в PDF»
  static async _pdf(button) {
    if (!PdfExport.wanted()) return { ok: false, err: '' };
    button.textContent = 'Создаю PDF…';
    try {
      await PdfExport.saveKp();
      return { ok: true, err: '' };
    } catch (error) {
      return { ok: false, err: error.message || String(error) };
    }
  }

  static _buttons(remote, pdfOk) {
    const id = esc(S.kpId);
    const pdf = pdfOk
      ? `<button class="btn" type="button" data-a="openPdf" data-id="${id}">${remote ? 'Скачать PDF' : 'Открыть PDF'}</button>`
      : '';
    const folder =
      remote && !SRV.info.docsShare
        ? ''
        : `<button class="btn" type="button" data-a="showDoc" data-id="${id}">${remote ? 'Путь к файлу' : 'Показать в папке'}</button>`;
    const mail = FEAT.on('mail')
      ? `<button class="btn primary" type="button" data-a="mailKp" data-id="${id}" title="Письмо клиенту с файлом КП">Отправить клиенту</button>`
      : '';
    return `<button class="btn" type="button" data-a="openDoc" data-id="${id}">${remote ? 'Скачать .docx' : 'Открыть в Word'}</button>${pdf}${folder}${mail}`;
  }

  static _done(pdf, isNew) {
    const remote = SRV.info && SRV.info.local === false;
    const box = $('#dlmsg');
    box.className = 'msg ok';
    const failed = pdf.err
      ? `<div class="msg err">PDF не создан: ${esc(pdf.err)}<div class="row" style="justify-content:center;margin-top:6px"><button class="btn" type="button" data-a="printPdf">Печать → «Сохранить как PDF»</button></div></div>`
      : '';
    box.innerHTML = `${DocImages.html()}КП № ${esc(S.number)} сохранено${pdf.ok ? ' (DOCX и PDF)' : ''}, каталог обновлён.<div class="row" style="justify-content:center;margin-top:8px">${this._buttons(remote, pdf.ok)}</div>${failed}`;
    if (FEAT.on('saveDlg')) KpSaved.open({ pdfOk: pdf.ok, pdfErr: pdf.err, isNew }); // окно «КП сохранено»
  }
}
