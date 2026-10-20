import { AiChat, AiDirect } from './ai-chat.js';
import { AiFill } from './ai-fill.js';
import { PageImages } from './page-images.js';

/** Вкладка «✨ Заполнить с ИИ»: источник → запрос (нейросеть в программе или ИИ-чат) → ответ и заполнение карточки. */
export class AiTab {
  static _step(item, answer, has) {
    if (item._aiStep) return item._aiStep;
    if (answer) return 3;
    return has ? 2 : 1;
  }

  static _cls(step, num) {
    return `ai-st${step === num ? ' cur' : ''}${step > num ? ' done' : ''}`;
  }

  static _head(step, { num, title, note }) {
    return `<div class="ai-sh"><span class="ai-sn">${step > num ? '✓' : num}</span><b>${title}</b>${note ? `<span class="ai-stc">${note}</span>` : ''}</div>`;
  }

  static _hero(station) {
    const direct = AiDirect.state;
    const what = station
      ? 'описание станции, требования к контейнеру, недостающие элементы состава'
      : 'наименование, описание, характеристики, параметры для фильтров';
    const title = direct.enabled
      ? 'Запрос уходит в нейросеть с компьютера-сервера — включает администратор в «Настройки → Нейросеть»'
      : 'Запрос копируется в любой ИИ-чат: ChatGPT, Claude, Алиса, GigaChat, DeepSeek';
    return `<div class="ai-hero"><span class="ai-ic" aria-hidden="true">✨</span>
      <div><h4>Автозаполнение карточки</h4><p>Дайте источник — ИИ разложит данные по полям: ${what}. Перед заполнением вы увидите, что изменится.</p></div>
      <span class="ai-mode${direct.enabled ? ' on' : ''}" title="${title}">${direct.enabled ? `● ${esc(direct.provider)} в программе` : 'Через ИИ-чат'}</span></div>`;
  }

  static _source(item, i, { step, has, station }) {
    const path = `items.${i}`;
    const props = (item._srcProps || []).length;
    const loaded = `загружено ${String(item._src || '').length.toLocaleString('ru-RU')} знаков${props ? ` · характеристик: ${props}` : ''}`;
    const note = has ? loaded : 'можно пропустить — хватит модели в наименовании';
    return `<li class="${this._cls(step, 1)}">${this._head(step, { num: 1, title: 'Откуда взять данные', note })}
      <div class="ai-src">
        <div class="ai-srcc ai-srcu"><span class="ai-srct">🔗 Страница товара на сайте</span>
          <div class="ai-url"><input type="url" data-p="${path}._srcUrl" value="${esc(item._srcUrl || item.pageUrl || '')}" placeholder="https://… ссылка на страницу товара" autocomplete="off"><button class="btn primary" type="button" data-a="aiFetch" data-i="${i}">Загрузить</button></div>
          <small class="muted">Возьмём описание, все вкладки страницы, таблицы характеристик и фото товара.</small></div>
        ${this._file(i, station)}
      </div>
      ${this._text(item, i, has)}
      ${props ? `<div class="ai-props"><span>Со страницы взято характеристик: <b>${props}</b>.</span><button class="btn ghost" type="button" data-a="aiProps" data-i="${i}">Перенести в «Характеристики» без ИИ</button></div>` : ''}
      ${(item._srcImgs || []).length ? PageImages.html(i, item._srcImgs, 'ai') : ''}</li>`;
  }

  static _file(i, station) {
    const hint = station
      ? 'ТЗ заказчика — ИИ разложит требования к контейнеру и добавит недостающие элементы.'
      : 'Паспорт, каталог, ТЗ — текст из файла уйдёт в запрос.';
    return `<label class="ai-srcc ai-srcf"><span class="ai-srct">📄 Файл</span><span class="ai-fileb">Выбрать PDF, Word или .txt</span><small class="muted">${hint}</small><input type="file" accept=".pdf,.docx,.txt,.csv,.md" hidden data-aifile="${i}"></label>`;
  }

  static _text(item, i, has) {
    return `<details class="ai-txt"${has ? ' open' : ''}><summary>${has ? 'Текст для ИИ — можно поправить' : '✍ Вставить текст вручную: описание, таблицу из паспорта или PDF'}</summary>
        <textarea data-p="items.${i}._src" rows="6" placeholder="Вставьте текст. Можно ничего не вставлять — тогда ИИ ищет данные по модели «${esc(item.name || 'из наименования')}».">${esc(item._src || '')}</textarea></details>`;
  }

  static _direct(item, i, step) {
    const direct = AiDirect.state;
    const busy = direct.busy[item.id];
    const head = this._head(step, {
      num: 2,
      title: 'Заполнить с помощью нейросети',
      note: `${esc(direct.provider)} · ответ — в шаге 3`,
    });
    return `<li class="${this._cls(step, 2)}">${head}
      <div class="row"><button class="btn primary ai-go" type="button" data-a="aiAuto" data-i="${i}"${busy ? ' disabled' : ''}>${busy ? '<span class="ai-spin" aria-hidden="true"></span> Заполняю…' : `✨ Заполнить автоматически`}</button><span class="muted">Обычно 10–40 секунд.</span></div>
      <details class="ai-pr"><summary>или через ИИ-чат в браузере (можно приложить скриншот или PDF)</summary>${AiChat.sitesHtml('aiCopy', i)}<textarea rows="8" readonly>${esc(AiFill.promptNow(item))}</textarea></details></li>`;
  }

  static _chat(item, i, step) {
    const head = this._head(step, {
      num: 2,
      title: 'Отправьте запрос в ИИ',
      note: 'кнопка копирует запрос и открывает сайт',
    });
    return `<li class="${this._cls(step, 2)}">${head}
      <p class="ai-how">Нажмите кнопку с названием ИИ → в открывшейся вкладке вставьте <kbd>Ctrl</kbd>+<kbd>V</kbd> и отправьте. Можно приложить скриншот или PDF паспорта.</p>
      ${AiChat.sitesHtml('aiCopy', i)}
      <details class="ai-pr"><summary>Показать запрос</summary><textarea rows="8" readonly>${esc(AiFill.promptNow(item))}</textarea></details></li>`;
  }

  static _answer(item, i, { step, answer }) {
    const path = `items.${i}`;
    const direct = AiDirect.state.enabled;
    const ok = answer && answer.kind !== 'bad';
    const head = this._head(step, {
      num: 3,
      title: direct ? 'Проверьте и заполните' : 'Вставьте ответ ИИ и заполните',
      note: ok ? 'ответ распознан' : '',
    });
    return `<li class="${this._cls(step, 3)}">${head}
      <textarea data-p="${path}._ans" data-aians="${i}" rows="5" placeholder="${direct ? 'Здесь появится ответ нейросети (или вставьте ответ чата)' : 'Ctrl+V — ответ ИИ целиком (кнопка «Копировать» под ответом в чате)'}">${esc(item._ans || '')}</textarea>
      <div class="ai-prev" data-aiprev="${i}">${AiFill.summary(item, answer)}</div>
      <div class="row ai-apply"><button class="btn primary" type="button" data-a="aiApply" data-i="${i}" data-aiok="${i}" ${ok ? '' : 'disabled'}>Заполнить карточку</button>
        <label class="row muted" style="gap:6px"><input type="checkbox" data-aikeep="${i}" ${(item._aiKeep ?? DEF('ai.keep')) ? 'checked' : ''} style="width:auto">не менять уже заполненное</label></div></li>`;
  }

  /**
   * Вкладка «Заполнить с ИИ».
   * @param {object} item
   * @param {number} i позиция КП
   * @returns {string}
   */
  static html(item, i) {
    const answer = AiFill.parse(item);
    const station = typeById(attrsOf(item).cat).station;
    const has = !!String(item._src || '').trim();
    const step = this._step(item, answer, has);
    const ask = AiDirect.state.enabled ? this._direct(item, i, step) : this._chat(item, i, step);
    return `<div class="ed-sec ai3">
    ${this._hero(station)}
    <ol class="ai-steps">
    ${this._source(item, i, { step, has, station })}
    ${ask}
    ${this._answer(item, i, { step, answer })}</ol>
    ${item._aiMsg ? `<p class="ai-msg" data-aistat="${i}">${esc(item._aiMsg)}</p>` : ''}</div>`;
  }
}
