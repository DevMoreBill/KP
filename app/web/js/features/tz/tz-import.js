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
    reserve: v => String(Math.max(0, Math.min(2, Math.round(+v || 0)))),
    work: v => String(Math.max(1, Math.min(4, Math.round(+v || 1)))),
  };
  static cur = null;

  /** ТЗ файлом или текстом в окне; i — станция в КП, null — новая станция. */
  static pick(i) {
    const m = new Modal(
      `<div class="dlg-h"><h3>ТЗ заказчика</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Файл (PDF, Word, Excel, скан) — или скопируйте текст ТЗ из письма, сайта тендера или документа и вставьте ниже.</p>
      <button class="btn" type="button" data-tzf>Выбрать файл ТЗ…</button>
      <label class="f" style="margin-top:12px"><span>Текст ТЗ</span><textarea rows="10" data-tzt maxlength="200000" placeholder="Например: Компрессорная станция в блок-контейнере, производительность 12 м³/мин, давление 8 бар, точка росы +3 °C, климат УХЛ1, от −45 до +40 °C…"></textarea></label>
      <div class="row" style="gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn ghost" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzp>Разобрать текст</button></div>`,
      'tzi-in',
    );
    m.d.addEventListener('click', e => this._pickClick(e, m, i));
    setTimeout(() => m.$('[data-tzt]')?.focus(), 50);
  }

  static _pickClick(e, m, i) {
    if (e.target.closest('[data-x]')) m.close();
    else if (e.target.closest('[data-tzf]')) {
      m.close();
      this.file(i);
    } else if (e.target.closest('[data-tzp]')) this._pasted(m, i);
  }

  static _pasted(m, i) {
    const t = String(m.$('[data-tzt]').value || '').trim();
    if (t.length < 20) {
      toast('Вставьте текст ТЗ — хотя бы пару строк с требованиями');
      return;
    }
    m.close();
    toast('Читаю ТЗ…');
    this.parse(new Blob([t], { type: 'text/plain;charset=utf-8' }), 'ТЗ (текст из окна).txt', i);
  }

  static file(i) {
    const f = $('#filePick');
    f.value = '';
    f.multiple = false;
    f.accept = this.ACCEPT;
    f.onchange = () => {
      const fl = f.files[0];
      f.accept = '';
      if (!fl) return;
      if (fl.size > 40 * 1024 * 1024) {
        toast('Файл больше 40 МБ');
        return;
      }
      toast(/\.(png|jpe?g|tiff?|bmp)$/i.test(fl.name) ? 'Распознаю скан ТЗ…' : 'Читаю ТЗ…');
      this.parse(fl, fl.name, i);
    };
    f.click();
  }

  /** Разбор на сервере → окно разбора. */
  static async parse(body, name, i) {
    let r;
    try {
      r = await api(`/api/tz/parse?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    } catch (e) {
      toast(String(e?.message || e));
      return;
    }
    this.open(r, name, i);
  }

  /** Окно разбора: найденное с цитатами и поля требований. */
  static open(r, name, i) {
    const x = i != null ? S.items[i] : null;
    const q = { ...(r.req || {}) };
    q.kind = (x && StationReq.kind(x)) || q.kind || 'comp';
    if (x) this._fromStation(q, x);
    this.cur = { r, name, i, q, pick: !x || !kitMainPart(x), ai: null };
    this.m?.close();
    $('#toast')?.classList.remove('on');
    const m = (this.m = new Modal(this.html(), 'wide tzi'));
    m.d.addEventListener('click', e => this.click(e));
    m.d.addEventListener('change', e => this._change(e));
  }

  static _change(e) {
    if (!['kind', 'pick'].includes(e.target.dataset.tz)) return;
    this.read();
    this.redraw();
  }

  static _empty(v) {
    return v == null || v === '';
  }

  /** Станция уже есть: чего нет в ТЗ — из её требований и контейнера. */
  static _fromStation(q, x) {
    const c = kitContainer(x);
    if (!q.cont && c) q.cont = c.ctype;
    for (const [k, v] of Object.entries(StationReq.of(x)))
      if (!['src', 'pick'].includes(k) && this._empty(q[k]) && !this._empty(v)) q[k] = v;
    if (!q.air && StationUi.opts(x).air) q.air = StationUi.opts(x).air;
    if (c) this._fromCont(q, c);
  }

  static _fromCont(q, c) {
    q.sys = { ...(c.sys || {}), ...(q.sys || {}) };
    if (!q.ins && c.ins) q.ins = c.ins;
    if (!q.climate && c.climate) q.climate = c.climate;
  }

  static redraw() {
    if (this.m && this.m.d.open) this.m.d.innerHTML = this.html();
  }

  static _fld(key, label, ph, mode = 'decimal') {
    const q = this.cur.q;
    return `<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-tz="${key}" value="${esc(q[key] ?? '')}" placeholder="${esc(ph || '')}" autocomplete="off"></label>`;
  }

  static _sel(key, label, list) {
    const v0 = String(this.cur.q[key] ?? '');
    return `<label class="f"><span>${label}</span><select data-tz="${key}">${list.map(([v, l]) => `<option value="${esc(v)}"${v0 === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  }

  static _chk(key, label, on) {
    return `<label class="tzi-c"><input type="checkbox" data-tz="${key}"${on ? ' checked' : ''}><span>${label}</span></label>`;
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
  static _sum(F, found) {
    if (F.length) {
      const n = st => F.filter(f => f.status === st).length;
      return `Из ТЗ взято ${n('found')} ${plural(n('found'), 'параметр', 'параметра', 'параметров')}${n('default') + n('missing') ? `; остальное — по умолчанию, с запасом в пользу заказчика` : ''}${n('conflict') ? `; разные значения в ТЗ (${n('conflict')}) — принято более требовательное` : ''}.`;
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

  static _need(Q) {
    if (!Q.length) return '';
    return `<div class="tzi-need"><b>Без этого станцию не подобрать — узнайте у заказчика:</b><ol>${Q.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
          ${this._qButtons()}</div>`;
  }

  static _later(L) {
    if (!L.length) return '';
    return `<details class="tzi-f tzi-q"${Spoiler.attr('tz:later')}><summary>Можно уточнить у заказчика позже — ${L.length} <span class="muted">(расчёт уже идёт по значениям по умолчанию)</span></summary><ol>${L.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
          ${this._qButtons()}</details>`;
  }

  static _title(c) {
    const d = c.r.doc;
    const doc = d ? ` · ${esc(this.kindName(d.kind))}${d.pages ? `, стр. ${d.pages}` : ''}` : '';
    return `<div class="dlg-h"><h3>ТЗ заказчика <small class="muted">· ${esc(c.name)}${doc}</small></h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>`;
  }

  /** Под раскрытием: условия расчёта, контейнер, системы, особые требования, прочее. */
  static _all(k) {
    const q = this.cur.q;
    const sys = q.sys || {};
    return `<details class="tzi-f tzi-more"${Spoiler.attr('tz:more')}><summary>Все параметры, условия расчёта и системы контейнера</summary>
          <div class="kr-g tzi-g">${this._more(k)}${this._sel('work', 'Рабочих агрегатов', StationReq.WORK)}
            ${this._fld('tmin', 'Наружный воздух от, °C', '−45', 'text')}${this._fld('tmax', 'до, °C', '+40', 'text')}
            ${this._sel('fire', 'Категория помещения', [['', 'ориентировочно по виду станции'], ...StationReq.FIRE.map(f => [f, f])])}${this._fld('noise', 'Шум, не более дБА', '80', 'numeric')}
            ${this._sel(
              'cont',
              'Контейнер',
              CONTAINER_TYPES.map(t => [t.id, t.name]),
            )}${this._sel('ins', 'Утепление', [['', 'по типу контейнера'], ...CONTAINER_INS.map(v => [v, v])])}
            ${this._sel('climate', 'Климатическое исполнение', [['', 'по температуре'], ...CLIMATES.map(z => [z[0], `${z[0]} — до ${z[2]} °C`])])}</div>
          <div class="tzi-sys"><span class="muted">Системы контейнера:</span>${CONT_SYSTEMS.map(([id, l]) => this._chk(`sys.${id}`, esc(l), sys[id] ?? CONT_SYS_DEF[id])).join('')}</div>
          <div class="tzi-sys">${StationReq.OPTS.filter(([, , kinds]) => kinds.includes(k))
            .map(([key, label]) => this._chk(key, esc(label), q[key]))
            .join('')}</div>
          ${k === 'comp' ? this._chk('recvOut', 'Ресивер после подготовки — снаружи (ФНП ОРПД, п. 65)', q.recvOut) : ''}
          ${this._chk('docs', 'Документы при поставке — в КП', q.docs !== false)}
          <label class="f"><span>Прочие требования из ТЗ</span><textarea rows="3" data-tz="notes">${esc(q.notes || '')}</textarea></label></details>`;
  }

  static _okLabel(c, x) {
    if (c.pick) return 'Подобрать станцию';
    return x ? 'Применить к станции' : 'Создать станцию';
  }

  /** Окно: сверху — главное (вид, ключевые параметры, итог, обязательные вопросы, подбор), остальное — под раскрытием. */
  static html() {
    const c = this.cur;
    const k = c.q.kind;
    const x = c.i != null ? S.items[c.i] : null;
    const found = (c.r.found || []).filter(f => f.key !== 'kind');
    const kind = x
      ? ''
      : this._sel(
          'kind',
          'Станция',
          this.KINDS.map(([v, l]) => [v, l]),
        );
    const swap = x && kitMainPart(x) ? '; прежнее основное оборудование заменится' : '';
    return `${this._title(c)}
      <div class="dlg-b">
        ${this.methods(c.r.doc)}
        <div class="kr-g tzi-g tzi-main">${kind}${this._main(k)}${this._sel('reserve', 'Резерв', StationReq.RES)}</div>
        <p class="tzi-sum">${esc(this._sum(c.r.fields || [], found))}</p>
        ${this._need(c.r.questions || [])}
        ${this._chk('pick', `<b>Подобрать и скомпоновать станцию</b> <span class="muted">— оборудование из каталога, контейнер, компоновка и изображения${swap}</span>`, c.pick)}
        ${this._all(k)}
        ${this.anketa(c.r, found)}
        ${this._later(c.r.later || [])}
        ${this.aiDiff()}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
          ${this._aiOn() ? '<button class="btn ghost" type="button" data-tzai>✨ Уточнить с ИИ</button>' : ''}
          <button class="btn" type="button" data-x>Отмена</button><button class="btn primary" type="button" data-tzok>${this._okLabel(c, x)}</button></div></div>`;
  }

  /** Значение параметра анкеты словами. */
  static val(key, v) {
    if (v === true) return 'да';
    if (this._empty(v)) return '—';
    const m = this.VAL[key];
    if (m && m[v] != null) return m[v];
    return String(v)
      .replace('.', ',')
      .replace(/^-(?=\d)/, '−');
  }

  static kindName(k) {
    return this.DOC_KIND[k] || String(k || '').toUpperCase();
  }

  /** Как прочитан документ: способы и качество; низкое — совет сверить и уточнить с ИИ. */
  static methods(d) {
    if (!d || !(d.methods || []).length) return '';
    const pct = v => (v != null ? `${Math.round(v * 100)} %` : '—');
    const low = d.low
      ? `<p><b>Качество текста низкое</b> — значения могли прочитаться с ошибками: сверьте с документом${this._aiOn() ? ' и нажмите «Уточнить с ИИ»' : ''}.</p>`
      : '';
    if (d.methods.length < 2)
      return `<div class="tzi-m${d.low ? ' low' : ''}">${low || `<span class="muted">Качество текста ${pct(d.quality)}</span>`}</div>`;
    const L = d.methods.map(m => this._method(m, pct)).join('');
    return `<div class="tzi-m${d.low ? ' low' : ''}">${low}<details${Spoiler.attr('tz:read')}><summary class="muted">Как прочитан документ — качество ${pct(d.quality)}</summary><ul>${L}</ul></details></div>`;
  }

  static _method(m, pct) {
    const how = m.error
      ? `<span class="muted">${esc(m.error)}</span>`
      : `качество ${pct(m.quality)}, ${m.chars} знаков${m.used ? ' — <b>использован</b>' : ''}`;
    return `<li${m.used ? ' class="on"' : ''}>${esc(m.name)}: ${how}</li>`;
  }

  static _pg(p) {
    return p ? `стр. ${p}: ` : '';
  }

  static _foundLi(f, src) {
    return `<li><b>${esc(f.label)}</b>${f.value === true ? '' : `: ${esc(String(f.value))}`}<small class="muted">${esc(src)}</small></li>`;
  }

  /** Цитата из ТЗ или почему принято по умолчанию. */
  static _quote(f) {
    if (f.status === 'conflict')
      return (f.values || []).map(v => `${this.val(f.key, v.value)} — ${this._pg(v.page)}${v.src}`).join(' | ');
    if (f.status === 'found') return this._pg(f.page) + (f.src || '');
    return f.why || '';
  }

  static _row(f) {
    const [t, cls] = this.STATUS[f.status] || ['', ''];
    return `<tr><td>${esc(f.label)}</td><td><span class="chip sm ${cls}">${esc(t)}</span></td><td>${esc(this.val(f.key, f.value))}</td><td class="muted">${esc(this._quote(f))}</td></tr>`;
  }

  /** Анкета: статус каждого параметра, значение, цитата со страницей или почему принято по умолчанию. */
  static anketa(r, found) {
    const F = r.fields || [];
    if (!F.length) {
      if (!found.length) return '';
      return `<details class="tzi-f"${Spoiler.attr('tz:anketa')}><summary>Найдено в ТЗ — ${found.length}</summary><ul>${found.map(f => this._foundLi(f, f.src || '')).join('')}</ul></details>`;
    }
    const n = k => F.filter(f => f.status === k).length;
    const extra = found.filter(f => !F.some(x => x.key === f.key) && !['kind', 'pdp'].includes(f.key));
    return `<details class="tzi-f tzi-a"${Spoiler.attr('tz:anketa')}><summary>Анкета по ТЗ с цитатами — найдено ${n('found')}, по умолчанию ${n('default')}, нет ${n('missing')}${n('conflict') ? `, разные значения ${n('conflict')}` : ''}</summary>
      <div class="tzi-tw"><table class="tzi-t"><thead><tr><th>Параметр</th><th>Статус</th><th>Значение</th><th>Цитата из ТЗ / почему</th></tr></thead><tbody>${F.map(f => this._row(f)).join('')}</tbody></table></div>
      ${extra.length ? `<ul>${extra.map(f => this._foundLi(f, this._pg(f.page) + (f.src || ''))).join('')}</ul>` : ''}</details>`;
  }

  /** Что ИИ прочитал иначе, чем правила (поле не меняется — решает менеджер). */
  static aiDiff() {
    const A = this.cur?.ai;
    if (!A) return '';
    const same = A.filter(d => d.same).length;
    const diff = A.filter(d => !d.same && d.rule != null);
    const add = A.filter(d => d.rule == null);
    const label = d => this.LABELS[d.key] || d.key;
    return `<details class="tzi-f tzi-ai"${Spoiler.attr('tz:ai')}><summary>Сравнение с ИИ — совпало ${same}, расхождений ${diff.length}, ИИ дополнил ${add.length}</summary>
      ${diff.length ? `<ul>${diff.map(d => `<li class="bad-t"><b>${esc(label(d))}</b>: правила — ${esc(String(d.rule))}, ИИ — ${esc(String(d.ai))} <small class="muted">проверьте по документу; в поле оставлено значение правил</small></li>`).join('')}</ul>` : ''}
      ${add.length ? `<p class="muted">ИИ заполнил пустые поля: ${esc(add.map(d => `${label(d)} — ${d.ai}`).join('; '))}</p>` : ''}</details>`;
  }

  /** Поля окна → требования. */
  static read() {
    const q = this.cur.q;
    for (const el of this.m.d.querySelectorAll('[data-tz]')) {
      const k = el.dataset.tz;
      const v = el.type === 'checkbox' ? el.checked : String(el.value).trim();
      if (k === 'pick') this.cur.pick = v;
      else if (k.startsWith('sys.')) {
        q.sys = q.sys || {};
        q.sys[k.slice(4)] = v;
      } else q[k] = v;
    }
    return q;
  }

  static async click(e) {
    const t = e.target;
    if (t.closest('[data-x]')) this.m.close();
    else if (t.closest('[data-tzai]')) await this.ai();
    else if (t.closest('[data-tzqc]')) await this._copyQuestions();
    else if (t.closest('[data-tzqd]')) await TzQuestions.download(this.cur);
    else await this._ok(t.closest('[data-tzok]'));
  }

  static async _copyQuestions() {
    const t = [...(this.cur.r.questions || []), ...(this.cur.r.later || [])].map((q, k) => `${k + 1}. ${q}`).join('\n');
    try {
      await navigator.clipboard.writeText(t);
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
  static async ai() {
    const q = this.read();
    const text = String(this.cur.r.text || '').slice(0, 12000);
    toast('Спрашиваю ИИ…');
    const a = await this._aiAsk(this._aiPrompt(text));
    if (!a) {
      toast('ИИ не ответил понятно — поля оставлены как есть');
      return;
    }
    const ctx = { q, rule: Object.fromEntries((this.cur.r.found || []).map(f => [f.key, f.value])), diff: [] };
    let n = 0;
    for (const [k, v] of Object.entries(a)) n += this._aiKey(ctx, k, v);
    this.cur.ai = ctx.diff;
    this.redraw();
    const bad = ctx.diff.filter(d => !d.same && d.rule != null).length;
    toast(
      (n ? `ИИ дополнил полей: ${n}` : 'ИИ не нашёл ничего сверх найденного') +
        (bad ? `; расхождений с правилами: ${bad} — смотрите «Сравнение с ИИ»` : ''),
    );
  }

  /** Одно поле ответа ИИ: 1 — поле дополнено. */
  static _aiKey(ctx, k, v) {
    const { q } = ctx;
    if (this._empty(v) || typeof v === 'object' || k === 'notes' || k === 'kind') return this._aiNotes(q, k, v);
    if (StationReq.OPTS.some(o => o[0] === k)) return this._aiFlag(q, k, v);
    const val = Object.hasOwn(this.AI_VAL, k) ? this.AI_VAL[k](v) : String(v).slice(0, 600);
    if (ctx.rule[k] != null) {
      ctx.diff.push({ key: k, rule: ctx.rule[k], ai: val, same: this._aiSame(k, val, ctx.rule[k]) });
      return 0;
    }
    if (!this._empty(q[k])) return 0;
    q[k] = val;
    ctx.diff.push({ key: k, rule: null, ai: val, same: false });
    return 1;
  }

  static _aiNotes(q, k, v) {
    if (k !== 'notes' || !v || q.notes) return 0;
    q.notes = String(v).slice(0, 2000);
    return 1;
  }

  static _aiFlag(q, k, v) {
    if (v !== true || q[k]) return 0;
    q[k] = true;
    return 1;
  }

  /** Числа совпадают с точностью 2 %, остальное — без учёта регистра. */
  static _aiSame(k, val, rv) {
    if (!this.NUMS.includes(k)) return String(rv).toLowerCase() === val.toLowerCase();
    const a = this._num(val) ?? NaN;
    const b = this._num(rv);
    return Math.abs(a - (b ?? NaN)) <= 0.02 * Math.max(1, Math.abs(b || 0));
  }

  static _num(v) {
    return StationReq.num(
      String(v ?? '')
        .replace(/[−–]/g, '-')
        .replace(/^\+/, ''),
    );
  }

  static _numStr(v) {
    const n = this._num(v);
    return n == null ? '' : String(n);
  }

  /** Записать требования в станцию (или создать её), контейнер по требованиям, подбор оборудования. */
  static async apply() {
    const c = this.cur;
    const q = this.read();
    const { x, i } = this._station(c, q);
    this._container(x, q);
    const r = this._req(x, q, c);
    if (c.pick) r.pick = (await TzPick.assemble(x, this._pickQ(q))).slice(0, 900);
    else this._fill(x, q, r);
    persist();
    this.m.close();
    renderForm();
    openEditor(i, 'kit');
    StationImages.soon(x);
    toast(
      c.pick
        ? 'Станция подобрана и скомпонована по ТЗ — итог в «Подборе станции»'
        : 'Требования из ТЗ записаны в станцию',
    );
  }

  /** Станция из окна; нет — новая станция в КП. */
  static _station(c, q) {
    if (c.i != null && S.items[c.i]) return { x: S.items[c.i], i: c.i };
    const t = typeById((this.KINDS.find(z => z[0] === q.kind) || this.KINDS[0])[2]);
    const x = newItem();
    x.attrs = { cat: t.id };
    x.page = true;
    x.features = [];
    x.kit = { parts: [kitNewContainer(q.cont || 'block')] };
    StationDefaults.add(x, t.id);
    S.items.push(x);
    return { x, i: S.items.length - 1 };
  }

  /** Контейнер: тип, утепление, климат (по требованию или по температуре), системы. */
  static _container(x, q) {
    let cont = kitContainer(x);
    if (!cont) {
      cont = kitNewContainer('block');
      x.kit.parts.push(cont);
    }
    const climate = this._climate(q, cont);
    if (q.cont && q.cont !== cont.ctype) {
      cont.ctype = q.cont;
      const ct = ctypeOf(q.cont);
      cont.size = '';
      cont.sizeAuto = !!StationGeo.FLEX[q.cont];
      if (ct.ins) cont.ins = ct.ins;
    }
    cont.sys = { ...(cont.sys || CONT_SYS_DEF), ...(q.sys || {}) };
    contApply(cont, { ins: q.ins || cont.ins, climate });
  }

  static _climate(q, cont) {
    if (q.climate) return q.climate;
    const t = this._numStr(q.tmin);
    if (t === '') return cont.climate;
    return +t < -45 ? 'УХЛ1' : 'У1';
  }

  /** Требования станции из полей окна. */
  static _req(x, q, c) {
    const r = StationReq.ensure(x);
    this._reqValues(r, q);
    r.recvOut = !!q.recvOut;
    r.docs = q.docs !== false;
    const notes = this._notes(q);
    if (notes) r.notes = notes.slice(0, 2000);
    for (const [k, , kinds] of StationReq.OPTS) if (kinds.includes(q.kind)) r[k] = !!q[k];
    r.src = { name: String(c.name || '').slice(0, 120) };
    if (q.kind === 'comp' && q.air) x.stLayout = { ...StationUi.opts(x), air: q.air };
    return r;
  }

  static _reqValues(r, q) {
    for (const k of this.NUMS) if (!this._empty(q[k])) r[k] = this._numStr(q[k]);
    for (const k of ['recv', 'reserve', 'work', 'fire']) if (q[k] != null) r[k] = q[k];
    if (q.kind === 'comp' && StationReq.INDUSTRY.some(o => o[0] === q.industry)) r.industry = q.industry;
    for (const [k, L] of [
      ['basis', StationReq.BASIS],
      ['mode', StationReq.MODE],
      ['start', StationReq.START],
    ])
      if (L.some(o => o[0] === q[k])) r[k] = q[k];
  }

  /** Прочие требования и коммерческие условия из ТЗ — для КП и переписки. */
  static _notes(q) {
    const own = String(q.notes || '');
    const terms = [
      q.warranty ? `Гарантия — ${q.warranty} мес.` : '',
      q.deadline ? `Срок поставки — ${q.deadline}` : '',
      q.brands ? `Производители — только ${q.brands}` : '',
      q.noBrands ? `Не допускаются: ${q.noBrands}` : '',
      q.noAnalogs ? 'Аналоги не допускаются' : '',
    ].filter(Boolean);
    return [own.trim(), ...terms.filter(t => !own.includes(t))].filter(Boolean).join('\n');
  }

  static _pickQ(q) {
    const n = v => +this._numStr(v);
    return {
      ...q,
      flow: n(q.flow),
      pressure: n(q.pressure),
      q: n(q.q),
      head: n(q.head),
      kw: n(q.kw),
      hours: n(q.hours),
      pdp: q.pdp,
      recvVol: n(q.recvVol),
      work: +q.work || 0,
    };
  }

  /** Без подбора: шкафы по особым требованиям, бак ДГУ, характеристики и название. */
  static _fill(x, q, r) {
    delete r.pick;
    const added = StationReq.ensureParts(x);
    if (added.length) r.pick = `Добавлено по ТЗ: ${added.join(', ')}`;
    const hours = +this._numStr(q.hours);
    if (q.kind === 'dgu' && hours > 0) StationDefaults.retank(x, hours);
    kitSync(x);
    StationUi.cache.delete(x.id);
    StationSize.apply(x, true);
    stationFill(x);
    stationAutoName(x);
  }
}
