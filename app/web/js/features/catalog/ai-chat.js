/** Нейросеть прямо в программе (включает администратор: «Настройки → Нейросеть»): запрос через сервер. */
export class AiDirect {
  static state = { enabled: false, provider: '', model: '', busy: {} };
  static JSON_TYPE = 'application/json; charset=utf-8';

  /** Включена ли нейросеть и какая. */
  static async load() {
    try {
      Object.assign(this.state, await api('/api/ai/status'));
    } catch {
      this.state.enabled = false;
    }
  }

  /**
   * Запрос к нейросети; ответ — в то же поле, что и при ручном способе.
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  static async ask(prompt) {
    const answer = await api('/api/ai/fill', {
      method: 'POST',
      headers: { 'Content-Type': this.JSON_TYPE },
      body: JSON.stringify({ prompt }),
    });
    return answer.text || '';
  }
}

/** ИИ-чат в браузере: запрос копируется, сайт ИИ открывается в новой вкладке. */
export class AiChat {
  static SITES = [
    ['ChatGPT', 'https://chatgpt.com/'],
    ['Claude', 'https://claude.ai/new'],
    ['Алиса (YandexGPT)', 'https://alice.yandex.ru/'],
    ['GigaChat', 'https://giga.chat/'],
    ['DeepSeek', 'https://chat.deepseek.com/'],
  ];
  static LISTS = ['ai.sites'];

  /**
   * Кнопки «Скопировать запрос» и сайтов ИИ.
   * @param {string} act действие data-a
   * @param {number} i позиция КП
   * @param {string} [extra] доп. атрибуты кнопок
   * @returns {string}
   */
  static sitesHtml(act, i, extra) {
    const more = extra || '';
    const sites = this.SITES.map(
      ([name, url]) =>
        `<button class="chip" type="button" data-a="${act}" data-i="${i}" data-url="${esc(url)}"${more} title="Скопировать запрос и открыть ${esc(name)} в новой вкладке">${esc(name)} ↗</button>`,
    ).join('');
    return `<div class="ai-sites"><button class="btn primary" type="button" data-a="${act}" data-i="${i}"${more}>Скопировать запрос</button>
    ${sites}</div>`;
  }

  static _manual(text) {
    const dialog = $('#dlg');
    dialog.innerHTML = `<div class="dlg-h"><h3>Запрос для ИИ</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div><div class="dlg-b"><p class="muted" style="margin-top:0">Скопировать автоматически не вышло. Выделите текст (Ctrl+A), скопируйте (Ctrl+C) и вставьте в окно ИИ.</p><textarea rows="14" readonly>${esc(text)}</textarea></div>`;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    const area = dialog.querySelector('textarea');
    area.focus();
    area.select();
  }

  /**
   * Скопировать запрос и открыть сайт ИИ в одном нажатии: копирование стартует до открытия вкладки.
   * @param {string} text
   * @param {string} url
   * @param {function(boolean): void} done
   */
  static send(text, url, done) {
    const copied = copyToClipboard(text);
    if (url) window.open(url, '_blank', 'noopener');
    copied.then(ok => {
      done(ok);
      if (!ok) this._manual(text);
    });
  }
}

/** Источник для ИИ (шаг 1): страница товара по ссылке, файл паспорта, характеристики со страницы. */
export class AiSource {
  static URL_RE = /^https?:\/\/./;
  static NAME_LEN = 200;
  static DEFAULTS = [
    [],
    [
      [
        'ai.supplement',
        'ai',
        'Дополнять карточку вторым запросом',
        'bool',
        true,
        {
          hint: 'Включено — если после ответа нейросети описания или ключевых характеристик меньше, чем обычно у карточек этой категории в каталоге, программа сама задаёт второй запрос «дополнить» (только достоверные данные с указанием источника). Выключено — один запрос: быстрее и дешевле, недостающее менеджер дополняет кнопкой «Скопировать запрос „дополнить“».',
        },
      ],
      [
        'ai.keyShare',
        'ai',
        'Характеристика «обязательная» для категории, если есть у',
        'num',
        '50',
        {
          unit: '% карточек',
          req: true,
          min: 10,
          max: 100,
          hint: 'Нейросеть просят заполнить все характеристики, которые есть у такой доли карточек этой категории в каталоге (например, «Точка росы» у осушителей). 50 % — у половины карточек и больше. Меньше — длиннее список обязательных характеристик, больше — только самые общие.',
        },
      ],
      [
        'ai.fileChars',
        'ai',
        'Текст из файла паспорта — не больше',
        'num',
        '60000',
        {
          unit: 'знаков',
          req: true,
          min: 5000,
          max: 500000,
          hint: 'Сколько знаков текста из загруженного файла (PDF, Word, Excel) передаётся нейросети как исходные данные. Остальное отбрасывается. Больше — нейросеть видит весь каталог производителя, но запрос дольше и дороже, а у некоторых нейросетей есть предел длины запроса. 60 000 знаков — примерно 30 страниц.',
        },
      ],
      [
        'ai.specLen',
        'ai',
        'Строка ключевых характеристик — до',
        'num',
        '90',
        {
          unit: 'символов',
          req: true,
          min: 40,
          max: 300,
          hint: 'Сколько символов просить у нейросети для строки под названием позиции (например, «37 кВт · 7 бар · 6,2 м³/мин»). Короче — строка не переносится в КП и списке каталога.',
        },
      ],
    ],
  ];

  static _text(url, page, props) {
    return [
      `Страница: ${url}`,
      page.title ? `Название: ${page.title}` : '',
      page.text || '',
      props.length ? `Характеристики:\n${props.map(prop => `${prop[0]}: ${prop[1]}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  static _note(item, page, props) {
    const chars = (page.text || '').length.toLocaleString('ru-RU');
    const found = props.length
      ? ` и ${props.length} ${plural(props.length, 'характеристика', 'характеристики', 'характеристик')}`
      : '';
    const imgs = item._srcImgs.length ? `, найдено фото: ${item._srcImgs.length} — выберите главное ниже` : '';
    const skipped = page.imgsSkipped ? ` (мелких и пустых картинок пропущено: ${page.imgsSkipped})` : '';
    const next = AiDirect.state.enabled ? '«Заполнить автоматически»' : 'отправьте запрос в ИИ';
    return `Со страницы загружено ${chars} знаков текста${found}${imgs}${skipped}. Дальше — шаг 2: ${next}.`;
  }

  /**
   * Текст и характеристики со страницы товара по ссылке → _src, _srcProps (и наименование, если пусто).
   * @param {object} item
   * @returns {Promise<boolean>}
   */
  static async fetchInto(item) {
    const url = String(item._srcUrl || '').trim();
    if (!this.URL_RE.test(url)) {
      item._aiMsg = 'Вставьте ссылку на страницу товара (начинается с http).';
      return false;
    }
    let page;
    try {
      page = await api('/api/pagetext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
    } catch (error) {
      item._aiMsg = `${String(error.message || error)}. Откройте страницу сами, выделите текст (Ctrl+A), скопируйте и вставьте в поле ниже.`;
      return false;
    }
    this._apply(item, url, page);
    return true;
  }

  static _apply(item, url, page) {
    const props = (page.props || []).filter(prop => prop[0] && prop[1]);
    item._src = this._text(url, page, props);
    item._srcProps = props;
    item._srcImgs = (page.imgs || []).slice(0, Math.round(DEFN('img.maxCount', 12)));
    if (!item.pageUrl && !(item.feed && item.feed.url)) item.pageUrl = url;
    if (!String(item.name || '').trim() && page.title) item.name = page.title.slice(0, this.NAME_LEN);
    item._aiMsg = this._note(item, page, props);
    item._aiStep = 2;
  }

  /**
   * «Загрузить» страницу товара.
   * @param {number} i позиция КП
   */
  static async fetch(i) {
    const item = S.items[i];
    item._aiMsg = 'Загружаю страницу…';
    renderForm();
    await this.fetchInto(item);
    renderForm();
    persist();
  }

  /**
   * Характеристики со страницы — сразу в таблицу, без ИИ.
   * @param {number} i
   */
  static props(i) {
    const item = S.items[i];
    const props = item._srcProps || [];
    if (!props.length) return;
    const group = { name: 'Основные', rows: props.map(([key, value]) => ({ k: key, v: value, hl: false })) };
    const has = (item.groups || []).some(one => (one.rows || []).some(row => row.k || row.v));
    if (has && !confirm('Заменить текущую таблицу характеристик характеристиками со страницы?')) return;
    item.groups = [group];
    item.page = true;
    item._aiMsg = `В характеристики перенесено строк: ${props.length}. Описание и параметры — через ИИ (шаг 2) или вручную.`;
    renderForm();
    persist();
    toast('Характеристики со страницы перенесены');
  }

  static async _file(field) {
    const item = S.items[+field.dataset.aifile];
    const file = field.files[0];
    field.value = '';
    item._aiMsg = `Читаю «${file.name}»…`;
    renderForm();
    try {
      const text = await AiFileText.read(file);
      item._src = `Файл: ${file.name}\n\n${text.slice(0, Math.round(DEFN('ai.fileChars', 60000)))}`;
      item._aiStep = 2;
      item._aiMsg = `Файл «${file.name}» загружен (${text.length.toLocaleString('ru-RU')} знаков). Дальше — шаг 2.`;
    } catch (error) {
      item._aiMsg = String(error.message || error);
    }
    renderForm();
    persist();
  }

  /** Файл паспорта (шаг 1). */
  static listen() {
    document.addEventListener('change', event => {
      const field = event.target;
      if (field.dataset.aifile != null && field.files[0]) this._file(field);
    });
  }
}

/** Текст файла для шага 1: Word (.docx — абзацы и таблицы строками «ячейка | ячейка»), текст, PDF (читает сервер). */
export class AiFileText {
  static ENTITIES = [
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&quot;/g, '"'],
    [/&apos;/g, "'"],
    [/&amp;/g, '&'],
  ];
  static TOKEN = { '<w:tab/>': '\t', '<w:br/>': '\n' };

  static _entities(text) {
    return this.ENTITIES.reduce((out, [pattern, char]) => out.replace(pattern, char), text);
  }

  static _para(xml) {
    const tokens = xml.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [];
    const text = tokens
      .map(token => (token.startsWith('<w:t') ? token.replace(/<[^>]+>/g, '') : this.TOKEN[token]))
      .join('');
    return this._entities(text).trim();
  }

  static _table(xml, out) {
    (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).forEach(row => {
      const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [])
        .map(cell =>
          (cell.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
            .map(para => this._para(para))
            .filter(Boolean)
            .join(' ')
            .trim(),
        )
        .filter(Boolean);
      if (cells.length) out.push(cells.join(' | '));
    });
  }

  static async _docx(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    const out = [];
    // таблицы — строками, ячейки через «|»; абзацы вне таблиц — как есть
    xml.slice(xml.indexOf('<w:body')).replace(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g, block => {
      if (block.startsWith('<w:tbl>')) this._table(block, out);
      else {
        const text = this._para(block);
        if (text) out.push(text);
      }
      return '';
    });
    return out.join('\n');
  }

  /**
   * Текст файла.
   * @param {File} file
   * @returns {Promise<string>}
   */
  static async read(file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.docx$/.test(name)) return await this._docx(file);
    if (/\.(txt|csv|md|tsv)$/.test(name) || /^text\//.test(file.type || '')) return await file.text();
    if (/\.pdf$/.test(name) || file.type === 'application/pdf') {
      // текст PDF читает сервер (pdf_text.py); скан без текста — понятная ошибка
      const answer = await api('/api/pdftext', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      });
      return answer.text || '';
    }
    throw new Error('Подходят файлы PDF, Word (.docx) и текстовые (.txt)');
  }
}
