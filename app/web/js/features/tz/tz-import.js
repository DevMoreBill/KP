import { StationGeo } from '../layout/station-geo.js';
import { TzPick } from './tz-pick.js';
import { TzQuestions } from './tz-questions.js';

/** ТЗ заказчика: разбор на сервере, окно с найденным и полями требований, запись в станцию и подбор. */
export class TzImport {
  static KINDS = [
    ['comp', 'Компрессорная', 'st_comp'],
    ['pump', 'Насосная', 'st_pump'],
    ['dgu', 'Дизель-генераторная', 'st_dgu'],
  ];
  static ACCEPT = '.pdf,.docx,.xlsx,.odt,.ods,.rtf,.txt,.png,.jpg,.jpeg,.tif,.tiff,.bmp';
  static STATUS = {
    found: ['найдено в ТЗ', 'on'],
    default: ['принято по умолчанию', 'warn'],
    missing: ['отсутствует', 'off'],
    conflict: ['противоречие', 'bad'],
  };
  /** Числовые поля: сравнение с ИИ и запись в станцию. */
  static NUMS = [
    'flow',
    'pressure',
    'q',
    'head',
    'kw',
    'hours',
    'tmin',
    'tmax',
    'noise',
    'recvVol',
    'alt',
    'rh',
    'margin',
    'load',
    'motor',
  ];
  static LABELS = {
    flow: 'Производительность, м³/мин',
    pressure: 'Давление, бар',
    air: 'Класс воздуха',
    q: 'Подача, м³/ч',
    head: 'Напор, м',
    kw: 'Мощность, кВт',
    hours: 'Работа от бака, ч',
    tmin: 'Наружный воздух от, °C',
    tmax: 'Наружный воздух до, °C',
    reserve: 'Резерв',
    work: 'Рабочих агрегатов',
    basis: 'Производительность приведена',
    alt: 'Высота над уровнем моря, м',
    rh: 'Влажность, %',
    margin: 'Запас производительности, %',
    mode: 'Режим ДЭС',
    load: 'Средняя нагрузка, %',
    motor: 'Наибольший двигатель, кВт',
    start: 'Пуск двигателя',
    fire: 'Категория помещения',
    noise: 'Шум, дБА',
    industry: 'Отрасль заказчика',
  };
  /** Значения выбора — словами. */
  static VAL = {
    basis: { fad: 'FAD — на выходе компрессора', normal: 'нормальные м³ (0 °C)', std: 'стандартные м³ (20 °C)' },
    mode: { prime: 'основной (PRP)', standby: 'резервный (ESP)' },
    start: {
      direct: 'прямой',
      stardelta: 'звезда — треугольник',
      soft: 'плавный пуск',
      vsd: 'частотный преобразователь',
    },
    reserve: { 0: 'без резерва', 1: 'N + 1', 2: 'N + 2' },
    rel: { 1: 'I', 2: 'II', 3: 'III' },
    industry: {
      food: 'пищевая — компрессоры безмасляные',
      med: 'медицинская, фармацевтическая — компрессоры безмасляные',
    },
  };
  static DOC_KIND = { 'pdf-ocr': 'PDF-скан, распознан', image: 'картинка, распознана' };
  /** Ответ ИИ — в пределах полей окна. */
  static AI_VAL = {
    reserve: value => String(Math.max(0, Math.min(2, Math.round(+value || 0)))),
    work: value => String(Math.max(1, Math.min(4, Math.round(+value || 1)))),
  };
  /** Пределы: файл ТЗ, текст в окне, текст для ИИ, поля требований и итог подбора. */
  static LIMIT = { fileMb: 40, text: 20, ai: 12000, notes: 2000, value: 600, src: 120, pick: 900 };
  static FOCUS_MS = 50; // окно успело открыться
  static NUM_TOL = 0.02; // числа ИИ и правил совпадают с точностью 2 %
  static TMIN_COLD = -45; // ниже — исполнение УХЛ1
  static cur = null;

  /** ТЗ файлом или текстом в окне; i — станция в КП, null — новая станция. */
  static pick(i) {
    const modal = new Modal(
      `<div class="dlg-h"><h3>ТЗ заказчика</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Файл (PDF, Word, Excel, скан) — или скопируйте текст ТЗ из письма, сайта тендера или документа и вставьте ниже.</p>
      <button class="btn" type="button" data-tzf>Выбрать файл ТЗ…</button>
      <label class="f" style="margin-top:12px"><span>Текст ТЗ</span><textarea rows="10" data-tzt maxlength="200000" placeholder="Например: Компрессорная станция в блок-контейнере, производительность 12 м³/мин, давление 8 бар, точка росы +3 °C, климат УХЛ1, от −45 до +40 °C…"></textarea></label>
      <div class="row" style="gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn ghost" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzp>Разобрать текст</button></div>`,
      'tzi-in',
    );
    modal.d.addEventListener('click', event => this._pickClick(event, modal, i));
    setTimeout(() => modal.$('[data-tzt]')?.focus(), this.FOCUS_MS);
  }

  static _pickClick(event, modal, i) {
    if (event.target.closest('[data-x]')) modal.close();
    else if (event.target.closest('[data-tzf]')) {
      modal.close();
      this.file(i);
    } else if (event.target.closest('[data-tzp]')) this._pasted(modal, i);
  }

  static _pasted(modal, i) {
    const text = String(modal.$('[data-tzt]').value || '').trim();
    if (text.length < this.LIMIT.text) {
      toast('Вставьте текст ТЗ — хотя бы пару строк с требованиями');
      return;
    }
    modal.close();
    toast('Читаю ТЗ…');
    this.parse(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'ТЗ (текст из окна).txt', i);
  }

  /** Выбрать файл ТЗ. */
  static file(i) {
    const picker = $('#filePick');
    picker.value = '';
    picker.multiple = false;
    picker.accept = this.ACCEPT;
    picker.onchange = () => {
      const file = picker.files[0];
      picker.accept = '';
      if (!file) return;
      if (file.size > this.LIMIT.fileMb * 1024 * 1024) {
        toast(`Файл больше ${this.LIMIT.fileMb} МБ`);
        return;
      }
      toast(/\.(png|jpe?g|tiff?|bmp)$/i.test(file.name) ? 'Распознаю скан ТЗ…' : 'Читаю ТЗ…');
      this.parse(file, file.name, i);
    };
    picker.click();
  }

  /** Разбор на сервере → окно разбора. */
  static async parse(body, name, i) {
    let parsed;
    try {
      parsed = await api(`/api/tz/parse?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    } catch (err) {
      toast(String(err?.message || err));
      return;
    }
    this.open(parsed, name, i);
  }

  /** Окно разбора: найденное с цитатами и поля требований. */
  static open(parsed, name, i) {
    const station = i != null ? S.items[i] : null;
    const need = { ...(parsed.req || {}) };
    need.kind = (station && StationReq.kind(station)) || need.kind || 'comp';
    if (station) this._fromStation(need, station);
    this.cur = { r: parsed, name, i, q: need, pick: !station || !kitMainPart(station), ai: null };
    this.m?.close();
    $('#toast')?.classList.remove('on');
    const modal = (this.m = new Modal(this.html(), 'wide tzi'));
    modal.d.addEventListener('click', event => this.click(event));
    modal.d.addEventListener('change', event => this._change(event));
  }

  static _change(event) {
    if (!['kind', 'pick'].includes(event.target.dataset.tz)) return;
    this.read();
    this.redraw();
  }

  static _empty(value) {
    return value == null || value === '';
  }

  /** Станция уже есть: чего нет в ТЗ — из её требований и контейнера. */
  static _fromStation(need, station) {
    const container = kitContainer(station);
    if (!need.cont && container) need.cont = container.ctype;
    for (const [k, value] of Object.entries(StationReq.of(station)))
      if (!['src', 'pick'].includes(k) && this._empty(need[k]) && !this._empty(value)) need[k] = value;
    if (!need.air && StationUi.opts(station).air) need.air = StationUi.opts(station).air;
    if (container) this._fromCont(need, container);
  }

  static _fromCont(need, container) {
    need.sys = { ...(container.sys || {}), ...(need.sys || {}) };
    if (!need.ins && container.ins) need.ins = container.ins;
    if (!need.climate && container.climate) need.climate = container.climate;
  }

  /** Перерисовать окно разбора. */
  static redraw() {
    if (this.m && this.m.d.open) this.m.d.innerHTML = this.html();
  }

  static _fld(key, label, hint, mode = 'decimal') {
    const need = this.cur.q;
    return `<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-tz="${key}" value="${esc(need[key] ?? '')}" placeholder="${esc(hint || '')}" autocomplete="off"></label>`;
  }

  static _sel(key, label, list) {
    const current = String(this.cur.q[key] ?? '');
    return `<label class="f"><span>${label}</span><select data-tz="${key}">${list.map(([value, text]) => `<option value="${esc(value)}"${current === String(value) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  }

  static _chk(key, label, checked) {
    return `<label class="tzi-c"><input type="checkbox" data-tz="${key}"${checked ? ' checked' : ''}><span>${label}</span></label>`;
  }

  /** Главные поля по виду станции; иной вид — как ДГУ. */
  static _main(k) {
    if (k === 'comp')
      return (
        this._fld('flow', 'Производительность, м³/мин', 'например, 10') +
        this._fld('pressure', 'Давление у потребителя, бар', 'например, 7') +
        this._sel('air', 'Качество воздуха (ISO 8573-1)', [
          ['', 'обычное — по умолчанию'],
          ...AirChain.options(this.cur.q.air),
        ])
      );
    if (k === 'pump')
      return this._fld('q', 'Подача, м³/ч', 'например, 50') + this._fld('head', 'Напор, м', 'например, 40');
    return (
      this._fld('kw', 'Мощность нагрузки, кВт', 'например, 200') +
      this._fld('hours', 'Работа без дозаправки, ч', 'например, 8', 'numeric') +
      this._sel('mode', 'Назначение', StationReq.MODE)
    );
  }

  static _more(k) {
    if (k === 'comp')
      return (
        this._sel('basis', 'Производительность приведена', StationReq.BASIS) +
        this._fld('margin', 'Запас производительности, %', '0 — по ТЗ') +
        this._sel('recv', 'Ресивер', StationReq.RECV) +
        this._fld('recvVol', 'Ресивер, л', 'по расчёту', 'numeric') +
        this._fld('alt', 'Высота над уровнем моря, м', '0', 'numeric') +
        this._fld('rh', 'Влажность, % (для н. м³)', '100', 'numeric')
      );
    if (k === 'pump') return '';
    return (
      this._fld('load', 'Средняя нагрузка, %', '100') +
      this._fld('motor', 'Наибольший двигатель, кВт', '—') +
      this._sel('start', 'Пуск двигателя', StationReq.START) +
      this._fld('alt', 'Высота над уровнем моря, м', '0', 'numeric')
    );
  }

  /** Итог разбора одной строкой. */
  static _sum(fields, found) {
    if (fields.length) {
      const count = status => fields.filter(field => field.status === status).length;
      return `Из ТЗ взято ${count('found')} ${plural(count('found'), 'параметр', 'параметра', 'параметров')}${count('default') + count('missing') ? `; остальное — по умолчанию, с запасом в пользу заказчика` : ''}${count('conflict') ? `; разные значения в ТЗ (${count('conflict')}) — принято более требовательное` : ''}.`;
    }
    if (found.length) return `Из ТЗ взято ${found.length} ${plural(found.length, 'значение', 'значения', 'значений')}.`;
    return 'В тексте не нашлось числовых требований — впишите главное сами.';
  }

  static _aiOn() {
    return typeof AI_DIRECT !== 'undefined' && AI_DIRECT.enabled;
  }

  static _qButtons() {
    return `<div class="row" style="gap:8px"><button class="btn sm" type="button" data-tzqc>Копировать вопросы</button><button class="btn sm" type="button" data-tzqd>Вопросы — DOCX</button></div>`;
  }

  static _need(questions) {
    if (!questions.length) return '';
    return `<div class="tzi-need"><b>Без этого станцию не подобрать — узнайте у заказчика:</b><ol>${questions.map(text => `<li>${esc(text)}</li>`).join('')}</ol>
          ${this._qButtons()}</div>`;
  }

  static _later(later) {
    if (!later.length) return '';
    return `<details class="tzi-f tzi-q"${Spoiler.attr('tz:later')}><summary>Можно уточнить у заказчика позже — ${later.length} <span class="muted">(расчёт уже идёт по значениям по умолчанию)</span></summary><ol>${later.map(text => `<li>${esc(text)}</li>`).join('')}</ol>
          ${this._qButtons()}</details>`;
  }

  static _title(cur) {
    const source = cur.r.doc;
    const doc = source ? ` · ${esc(this.kindName(source.kind))}${source.pages ? `, стр. ${source.pages}` : ''}` : '';
    return `<div class="dlg-h"><h3>ТЗ заказчика <small class="muted">· ${esc(cur.name)}${doc}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>`;
  }

  /** Под раскрытием: условия расчёта, контейнер, системы, особые требования, прочее. */
  static _all(k) {
    const need = this.cur.q;
    const sys = need.sys || {};
    return `<details class="tzi-f tzi-more"${Spoiler.attr('tz:more')}><summary>Все параметры, условия расчёта и системы контейнера</summary>
          <div class="kr-g tzi-g">${this._more(k)}${this._sel('work', 'Рабочих агрегатов', StationReq.WORK)}
            ${this._fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${this._fld('tmax', 'до, °C', '+40', 'text')}
            ${this._sel('fire', 'Категория помещения', [['', 'ориентировочно по виду станции'], ...StationReq.FIRE.map(fire => [fire, fire])])}${this._fld('noise', 'Шум, не более дБА', '80', 'numeric')}
            ${this._sel(
              'cont',
              'Контейнер',
              CONTAINER_TYPES.map(type => [type.id, type.name]),
            )}${this._sel('ins', 'Утепление', [['', 'по типу контейнера'], ...CONTAINER_INS.map(ins => [ins, ins])])}
            ${this._sel('climate', 'Климатическое исполнение', [['', 'по температуре'], ...CLIMATES.map(z => [z[0], `${z[0]} — до ${z[2]} °C`])])}</div>
          <div class="tzi-sys"><span class="muted">Системы контейнера:</span>${CONT_SYSTEMS.map(([id, title]) => this._chk(`sys.${id}`, esc(title), sys[id] ?? CONT_SYS_DEF[id])).join('')}</div>
          <div class="tzi-sys">${StationReq.OPTS.filter(([, , kinds]) => kinds.includes(k))
            .map(([key, label]) => this._chk(key, esc(label), need[key]))
            .join('')}</div>
          ${k === 'comp' ? this._chk('recvOut', 'Ресивер после подготовки — снаружи (ФНП ОРПД, п. 65)', need.recvOut) : ''}
          ${this._chk('docs', 'Документы при поставке — в КП', need.docs !== false)}
          <label class="f"><span>Прочие требования из ТЗ</span><textarea rows="3" data-tz="notes">${esc(need.notes || '')}</textarea></label></details>`;
  }

  static _okLabel(cur, station) {
    if (cur.pick) return 'Подобрать станцию';
    return station ? 'Применить к станции' : 'Создать станцию';
  }

  /** Окно: сверху — главное (вид, ключевые параметры, итог, обязательные вопросы, подбор), остальное — под раскрытием. */
  static html() {
    const cur = this.cur;
    const k = cur.q.kind;
    const station = cur.i != null ? S.items[cur.i] : null;
    const found = (cur.r.found || []).filter(field => field.key !== 'kind');
    const kind = station
      ? ''
      : this._sel(
          'kind',
          'Станция',
          this.KINDS.map(([value, label]) => [value, label]),
        );
    const swap = station && kitMainPart(station) ? '; прежнее основное оборудование заменится' : '';
    return `${this._title(cur)}
      <div class="dlg-b">
        ${this.methods(cur.r.doc)}
        <div class="kr-g tzi-g tzi-main">${kind}${this._main(k)}${this._sel('reserve', 'Резерв', StationReq.RES)}</div>
        <p class="tzi-sum">${esc(this._sum(cur.r.fields || [], found))}</p>
        ${this._need(cur.r.questions || [])}
        ${this._chk('pick', `<b>Подобрать и скомпоновать станцию</b> <span class="muted">— оборудование из каталога, контейнер, компоновка и изображения${swap}</span>`, cur.pick)}
        ${this._all(k)}
        ${this.anketa(cur.r, found)}
        ${this._later(cur.r.later || [])}
        ${this.aiDiff()}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          ${this._aiOn() ? '<button class="btn ghost" type="button" data-tzai>✨ Уточнить с ИИ</button>' : ''}
          <button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzok>${this._okLabel(cur, station)}</button></div></div>`;
  }

  /** Значение параметра анкеты словами. */
  static val(key, value) {
    if (value === true) return 'да';
    if (this._empty(value)) return '—';
    const names = this.VAL[key];
    if (names && names[value] != null) return names[value];
    return String(value)
      .replace('.', ',')
      .replace(/^-(?=\d)/, '−');
  }

  /** Вид документа словами. */
  static kindName(k) {
    return this.DOC_KIND[k] || String(k || '').toUpperCase();
  }

  /** Как прочитан документ: способы и качество; низкое — совет сверить и уточнить с ИИ. */
  static methods(doc) {
    if (!doc || !(doc.methods || []).length) return '';
    const pct = value => (value != null ? `${Math.round(value * 100)} %` : '—');
    const low = doc.low
      ? `<p><b>Качество текста низкое</b> — значения могли прочитаться с ошибками: сверьте с документом${this._aiOn() ? ' и нажмите «Уточнить с ИИ»' : ''}.</p>`
      : '';
    if (doc.methods.length < 2)
      return `<div class="tzi-m${doc.low ? ' low' : ''}">${low || `<span class="muted">Качество текста ${pct(doc.quality)}</span>`}</div>`;
    const list = doc.methods.map(method => this._method(method, pct)).join('');
    return `<div class="tzi-m${doc.low ? ' low' : ''}">${low}<details${Spoiler.attr('tz:read')}><summary class="muted">Как прочитан документ — качество ${pct(doc.quality)}</summary><ul>${list}</ul></details></div>`;
  }

  static _method(method, pct) {
    const how = method.error
      ? `<span class="muted">${esc(method.error)}</span>`
      : `качество ${pct(method.quality)}, ${method.chars} знаков${method.used ? ' — <b>использован</b>' : ''}`;
    return `<li${method.used ? ' class="on"' : ''}>${esc(method.name)}: ${how}</li>`;
  }

  static _pg(page) {
    return page ? `стр. ${page}: ` : '';
  }

  static _foundLi(field, src) {
    return `<li><b>${esc(field.label)}</b>${field.value === true ? '' : `: ${esc(String(field.value))}`}<small class="muted">${esc(src)}</small></li>`;
  }

  /** Цитата из ТЗ или почему принято по умолчанию. */
  static _quote(field) {
    if (field.status === 'conflict')
      return (field.values || [])
        .map(value => `${this.val(field.key, value.value)} — ${this._pg(value.page)}${value.src}`)
        .join(' | ');
    if (field.status === 'found') return this._pg(field.page) + (field.src || '');
    return field.why || '';
  }

  static _row(field) {
    const [label, cls] = this.STATUS[field.status] || ['', ''];
    return `<tr><td>${esc(field.label)}</td><td><span class="chip sm ${cls}">${esc(label)}</span></td><td>${esc(this.val(field.key, field.value))}</td><td class="muted">${esc(this._quote(field))}</td></tr>`;
  }

  /** Анкета: статус каждого параметра, значение, цитата со страницей или почему принято по умолчанию. */
  static anketa(parsed, found) {
    const fields = parsed.fields || [];
    if (!fields.length) {
      if (!found.length) return '';
      return `<details class="tzi-f"${Spoiler.attr('tz:anketa')}><summary>Найдено в ТЗ — ${found.length}</summary><ul>${found.map(field => this._foundLi(field, field.src || '')).join('')}</ul></details>`;
    }
    const count = k => fields.filter(field => field.status === k).length;
    const extra = found.filter(
      field => !fields.some(station => station.key === field.key) && !['kind', 'pdp'].includes(field.key),
    );
    return `<details class="tzi-f tzi-a"${Spoiler.attr('tz:anketa')}><summary>Анкета по ТЗ с цитатами — найдено ${count('found')}, по умолчанию ${count('default')}, нет ${count('missing')}${count('conflict') ? `, разные значения ${count('conflict')}` : ''}</summary>
      <div class="tzi-tw"><table class="tzi-t"><thead><tr><th>Параметр</th><th>Статус</th><th>Значение</th><th>Цитата из ТЗ / почему</th></tr></thead><tbody>${fields.map(field => this._row(field)).join('')}</tbody></table></div>
      ${extra.length ? `<ul>${extra.map(field => this._foundLi(field, this._pg(field.page) + (field.src || ''))).join('')}</ul>` : ''}</details>`;
  }

  /** Что ИИ прочитал иначе, чем правила (поле не меняется — решает менеджер). */
  static aiDiff() {
    const diffs = this.cur?.ai;
    if (!diffs) return '';
    const same = diffs.filter(entry => entry.same).length;
    const diff = diffs.filter(entry => !entry.same && entry.rule != null);
    const add = diffs.filter(entry => entry.rule == null);
    const label = entry => this.LABELS[entry.key] || entry.key;
    return `<details class="tzi-f tzi-ai"${Spoiler.attr('tz:ai')}><summary>Сравнение с ИИ — совпало ${same}, расхождений ${diff.length}, ИИ дополнил ${add.length}</summary>
      ${diff.length ? `<ul>${diff.map(entry => `<li class="bad-t"><b>${esc(label(entry))}</b>: правила — ${esc(String(entry.rule))}, ИИ — ${esc(String(entry.ai))} <small class="muted">проверьте по документу; в поле оставлено значение правил</small></li>`).join('')}</ul>` : ''}
      ${add.length ? `<p class="muted">ИИ заполнил пустые поля: ${esc(add.map(entry => `${label(entry)} — ${entry.ai}`).join('; '))}</p>` : ''}</details>`;
  }

  /** Поля окна → требования. */
  static read() {
    const need = this.cur.q;
    for (const el of this.m.d.querySelectorAll('[data-tz]')) {
      const k = el.dataset.tz;
      const value = el.type === 'checkbox' ? el.checked : String(el.value).trim();
      if (k === 'pick') this.cur.pick = value;
      else if (k.startsWith('sys.')) {
        need.sys = need.sys || {};
        need.sys[k.slice(4)] = value;
      } else need[k] = value;
    }
    return need;
  }

  /** Щелчок в окне разбора. */
  static async click(event) {
    const target = event.target;
    if (target.closest('[data-x]')) this.m.close();
    else if (target.closest('[data-tzai]')) await this.askAi();
    else if (target.closest('[data-tzqc]')) await this._copyQuestions();
    else if (target.closest('[data-tzqd]')) await TzQuestions.download(this.cur);
    else await this._ok(target.closest('[data-tzok]'));
  }

  static async _copyQuestions() {
    const text = [...(this.cur.r.questions || []), ...(this.cur.r.later || [])]
      .map((question, k) => `${k + 1}. ${question}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Вопросы скопированы');
    } catch {
      toast('Не удалось скопировать — выделите текст вручную');
    }
  }

  static async _ok(ok) {
    if (!ok) return;
    ok.disabled = true;
    ok.textContent = 'Подбираю…';
    try {
      await this.apply();
    } catch (err) {
      ok.disabled = false;
      ok.textContent = 'Повторить';
      toast(`Не получилось: ${err?.message || err}`);
    }
  }

  static _aiPrompt(text) {
    return `Из технического задания ниже выпиши требования к станции в контейнере. Ответ — только JSON без пояснений:
{"kind":"comp|pump|dgu","flow":м³/мин,"basis":"fad|normal|std" (normal — нормальные м³, нм³, 0 °C; std — стандартные м³, ст. м³, 20 °C по ГОСТ 2939; иначе fad),"pressure":бар у потребителя,"air":"класс ISO 8573-1 вида 1.4.1",
"margin":запас производительности %,"q":м³/ч,"head":м,"kw":кВт,"mode":"prime|standby" (ДЭС — основной или резервный источник),"load":средняя нагрузка %,"motor":кВт наибольшего двигателя нагрузки,
"start":"direct|stardelta|soft|vsd","hours":работа от бака ч,"work":рабочих агрегатов 1…4,"reserve":0|1|2,"tmin":°C,"tmax":°C,"alt":высота над уровнем моря м,"rh":влажность %,
"climate":"У1|УХЛ1|ХЛ1","fire":"А|Б|В1|В2|В3|В4|Г|Д","noise":дБА,"recvOut":true|false,"cont":"block|sea20|sea40|sea20hc|sea40hc|north",
"oilFree":true|false,"industry":"food|med" (food — пищевая, напитки; med — медицинская, фармацевтическая),"vsd":true|false,"ats":true|false,"scada":true|false,"notes":"прочие требования кратко"}. Неизвестное — не указывай, не выдумывай.\n\nТЕКСТ ТЗ:\n${text}`;
  }

  /** Ответ ИИ — JSON из текста; не ответил или непонятно — null. */
  static async _aiAsk(prompt) {
    try {
      return JSON.parse(
        String(await aiDirect(prompt))
          .replace(/^[^{]*/, '')
          .replace(/[^}]*$/, ''),
      );
    } catch {
      return null;
    }
  }

  /** Уточнить с ИИ: пустые поля — из ответа; расхождения с правилами — списком, поле не меняется. */
  static async askAi() {
    const need = this.read();
    const text = String(this.cur.r.text || '').slice(0, this.LIMIT.ai);
    toast('Спрашиваю ИИ…');
    const answer = await this._aiAsk(this._aiPrompt(text));
    if (!answer) {
      toast('ИИ не ответил понятно — поля оставлены как есть');
      return;
    }
    const ctx = {
      q: need,
      rule: Object.fromEntries((this.cur.r.found || []).map(found => [found.key, found.value])),
      diff: [],
    };
    let count = 0;
    for (const [k, value] of Object.entries(answer)) count += this._aiKey(ctx, k, value);
    this.cur.ai = ctx.diff;
    this.redraw();
    const bad = ctx.diff.filter(diff => !diff.same && diff.rule != null).length;
    toast(
      (count ? `ИИ дополнил полей: ${count}` : 'ИИ не нашёл ничего сверх найденного') +
        (bad ? `; расхождений с правилами: ${bad} — смотрите «Сравнение с ИИ»` : ''),
    );
  }

  /** Одно поле ответа ИИ: 1 — поле дополнено. */
  static _aiKey(ctx, k, value) {
    const { q: need } = ctx;
    if (this._empty(value) || typeof value === 'object' || k === 'notes' || k === 'kind')
      return this._aiNotes(need, k, value);
    if (StationReq.OPTS.some(opt => opt[0] === k)) return this._aiFlag(need, k, value);
    const val = Object.hasOwn(this.AI_VAL, k) ? this.AI_VAL[k](value) : String(value).slice(0, this.LIMIT.value);
    if (ctx.rule[k] != null) {
      ctx.diff.push({ key: k, rule: ctx.rule[k], ai: val, same: this._aiSame(k, val, ctx.rule[k]) });
      return 0;
    }
    if (!this._empty(need[k])) return 0;
    need[k] = val;
    ctx.diff.push({ key: k, rule: null, ai: val, same: false });
    return 1;
  }

  static _aiNotes(need, k, value) {
    if (k !== 'notes' || !value || need.notes) return 0;
    need.notes = String(value).slice(0, this.LIMIT.notes);
    return 1;
  }

  static _aiFlag(need, k, value) {
    if (value !== true || need[k]) return 0;
    need[k] = true;
    return 1;
  }

  /** Числа совпадают с точностью 2 %, остальное — без учёта регистра. */
  static _aiSame(k, val, ruleValue) {
    if (!this.NUMS.includes(k)) return String(ruleValue).toLowerCase() === val.toLowerCase();
    const aiNum = this._num(val) ?? NaN;
    const ruleNum = this._num(ruleValue);
    return Math.abs(aiNum - (ruleNum ?? NaN)) <= this.NUM_TOL * Math.max(1, Math.abs(ruleNum || 0));
  }

  static _num(value) {
    return StationReq.num(
      String(value ?? '')
        .replace(/[−–]/g, '-')
        .replace(/^\+/, ''),
    );
  }

  static _numStr(value) {
    const number = this._num(value);
    return number == null ? '' : String(number);
  }

  /** Записать требования в станцию (или создать её), контейнер по требованиям, подбор оборудования. */
  static async apply() {
    const cur = this.cur;
    const need = this.read();
    const { x: station, i } = this._station(cur, need);
    this._container(station, need);
    const req = this._req(station, need, cur);
    if (cur.pick) req.pick = (await TzPick.assemble(station, this._pickQ(need))).slice(0, this.LIMIT.pick);
    else this._fill(station, need, req);
    persist();
    this.m.close();
    renderForm();
    openEditor(i, 'kit');
    StationImages.soon(station);
    toast(
      cur.pick
        ? 'Станция подобрана и скомпонована по ТЗ — итог в «Подборе станции»'
        : 'Требования из ТЗ записаны в станцию',
    );
  }

  /** Станция из окна; нет — новая станция в КП. */
  static _station(cur, need) {
    if (cur.i != null && S.items[cur.i]) return { x: S.items[cur.i], i: cur.i };
    const type = typeById((this.KINDS.find(z => z[0] === need.kind) || this.KINDS[0])[2]);
    const station = newItem();
    station.attrs = { cat: type.id };
    station.page = true;
    station.features = [];
    station.kit = { parts: [kitNewContainer(need.cont || 'block')] };
    StationDefaults.add(station, type.id);
    S.items.push(station);
    return { x: station, i: S.items.length - 1 };
  }

  /** Контейнер: тип, утепление, климат (по требованию или по температуре), системы. */
  static _container(station, need) {
    let cont = kitContainer(station);
    if (!cont) {
      cont = kitNewContainer('block');
      station.kit.parts.push(cont);
    }
    const climate = this._climate(need, cont);
    if (need.cont && need.cont !== cont.ctype) {
      cont.ctype = need.cont;
      const ctype = ctypeOf(need.cont);
      cont.size = '';
      cont.sizeAuto = !!StationGeo.FLEX[need.cont];
      if (ctype.ins) cont.ins = ctype.ins;
    }
    cont.sys = { ...(cont.sys || CONT_SYS_DEF), ...(need.sys || {}) };
    contApply(cont, { ins: need.ins || cont.ins, climate });
  }

  static _climate(need, cont) {
    if (need.climate) return need.climate;
    const tmin = this._numStr(need.tmin);
    if (tmin === '') return cont.climate;
    return +tmin < this.TMIN_COLD ? 'УХЛ1' : 'У1';
  }

  /** Требования станции из полей окна. */
  static _req(station, need, container) {
    const req = StationReq.ensure(station);
    this._reqValues(req, need);
    req.recvOut = !!need.recvOut;
    req.docs = need.docs !== false;
    const notes = this._notes(need);
    if (notes) req.notes = notes.slice(0, this.LIMIT.notes);
    for (const [k, , kinds] of StationReq.OPTS) if (kinds.includes(need.kind)) req[k] = !!need[k];
    req.src = { name: String(container.name || '').slice(0, this.LIMIT.src) };
    if (need.kind === 'comp' && need.air) station.stLayout = { ...StationUi.opts(station), air: need.air };
    return req;
  }

  static _reqValues(req, need) {
    for (const k of this.NUMS) if (!this._empty(need[k])) req[k] = this._numStr(need[k]);
    for (const k of ['recv', 'reserve', 'work', 'fire']) if (need[k] != null) req[k] = need[k];
    if (need.kind === 'comp' && StationReq.INDUSTRY.some(opt => opt[0] === need.industry)) req.industry = need.industry;
    for (const [k, list] of [
      ['basis', StationReq.BASIS],
      ['mode', StationReq.MODE],
      ['start', StationReq.START],
    ])
      if (list.some(opt => opt[0] === need[k])) req[k] = need[k];
  }

  /** Прочие требования и коммерческие условия из ТЗ — для КП и переписки. */
  static _notes(need) {
    const own = String(need.notes || '');
    const terms = [
      need.warranty ? `Гарантия — ${need.warranty} мес.` : '',
      need.deadline ? `Срок поставки — ${need.deadline}` : '',
      need.brands ? `Производители — только ${need.brands}` : '',
      need.noBrands ? `Не допускаются: ${need.noBrands}` : '',
      need.noAnalogs ? 'Аналоги не допускаются' : '',
    ].filter(Boolean);
    return [own.trim(), ...terms.filter(term => !own.includes(term))].filter(Boolean).join('\n');
  }

  static _pickQ(need) {
    const toNum = value => +this._numStr(value);
    return {
      ...need,
      flow: toNum(need.flow),
      pressure: toNum(need.pressure),
      q: toNum(need.q),
      head: toNum(need.head),
      kw: toNum(need.kw),
      hours: toNum(need.hours),
      pdp: need.pdp,
      recvVol: toNum(need.recvVol),
      work: +need.work || 0,
    };
  }

  /** Без подбора: шкафы по особым требованиям, бак ДГУ, характеристики и название. */
  static _fill(station, need, req) {
    delete req.pick;
    const added = StationReq.ensureParts(station);
    if (added.length) req.pick = `Добавлено по ТЗ: ${added.join(', ')}`;
    const hours = +this._numStr(need.hours);
    if (need.kind === 'dgu' && hours > 0) StationDefaults.retank(station, hours);
    kitSync(station);
    StationUi.cache.delete(station.id);
    StationSize.apply(station, true);
    stationFill(station);
    stationAutoName(station);
  }
}
