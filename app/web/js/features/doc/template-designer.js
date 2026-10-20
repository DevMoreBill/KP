import { Design } from './design.js';
import { DesignHistory } from './design-history.js';
import { DesignPanels } from './design-panels.js';
import { DesignView } from './design-view.js';
import { KpSave } from './kp-save.js';
import { TemplateDraft } from './template-draft.js';
import { TemplateEditor } from './template-editor.js';
import { Templates } from './templates.js';
import { Translit } from './translit.js';

/**
 * Графический редактор шаблона КП (только администратор): документ виден как в Word, свои картинки и надписи ставятся мышью
 * в любое место страницы, текст и картинки макета сдвигаются (отступы абзаца стиля). Шапка, поля листа, палитра, разделы —
 * для новой компании без Word. «Сохранить как новый…» — копия папки шаблона под другую компанию.
 */
export class TemplateDesigner {
  static JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
  static OBJECTS = ['page', 'imgSize', 'para'];
  static LISTS = ['images', 'labels'];
  static UPLOAD_NAMES = { clients: 'clients_', header: 'hdr_logo_' };
  static UID_BASE = 36;

  /**
   * Окно редактора; Esc сначала снимает выделение, потом закрывает окно.
   * @returns {HTMLDialogElement}
   */
  static dialog() {
    return Modal.host('tddlg', 'tdwin', 'Графический редактор шаблона', dialog =>
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        if (Design.state.sel) DesignView.select(null);
        else this.close();
      }),
    );
  }

  static _normalize(work) {
    for (const key of this.OBJECTS) {
      if (!work[key] || typeof work[key] !== 'object' || Array.isArray(work[key])) work[key] = {};
    }
    for (const key of this.LISTS) if (!Array.isArray(work[key])) work[key] = [];
  }

  /**
   * Открыть редактор шаблона.
   * @param {string} [id] шаблон; нет — выбранный в КП
   */
  static async open(id) {
    if (!ADMIN.on) {
      toast('Графический редактор шаблона доступен администратору: войдите в «Настройках»');
      return;
    }
    const state = Design.state;
    const templateId = id || S.template;
    const dialog = this.dialog();
    dialog.innerHTML = '<p class="muted td-load">Загружаю шаблон…</p>';
    if (!dialog.open) dialog.showModal();
    Object.assign(state, {
      id: templateId,
      pack: null,
      form: null,
      work: null,
      undo: [],
      redo: [],
      sel: null,
      err: '',
      note: '',
    });
    try {
      Object.assign(state, await TemplateDraft.load(templateId));
      this._normalize(state.work);
    } catch (error) {
      state.err = error.message || String(error);
    }
    state.saved = JSON.stringify(state.work);
    const features = (state.pack && state.pack.skel.features) || [];
    if (!state.err && !features.includes('design')) {
      state.err =
        'скелет этого шаблона (skeleton.js) не поддерживает графический редактор — верните заводской скелет или используйте «Настроить» (форму)';
    }
    DesignPanels.render();
    if (!state.err) DesignView.previewNow();
  }

  /**
   * Настройки для template.json: без служебных полей и пустых полей страницы.
   * @returns {object}
   */
  static clean() {
    const work = JSON.parse(JSON.stringify(Design.state.work));
    delete work.design;
    if (work.page && !Object.values(work.page).some(value => value !== '' && value != null)) delete work.page;
    return work;
  }

  static async _putJson(id, work) {
    await api(`/api/templates/${encodeURIComponent(id)}/file?name=template.json`, {
      method: 'PUT',
      headers: this.JSON_HEADERS,
      body: JSON.stringify(work, null, 2),
    });
  }

  /** Сохранить настройки шаблона. */
  static async save() {
    const state = Design.state;
    await this._putJson(state.id, this.clean());
    state.saved = JSON.stringify(state.work);
    Templates.dropCache(state.id);
    await Templates.load();
    renderForm();
    state.pack = await Templates.pack(state.id);
    state.note = 'Шаблон сохранён. Прежняя версия — в истории («Форма» → «Файлы шаблона»).';
    DesignPanels.top();
  }

  static async _copy(from, name) {
    const id = Translit.templateId(name);
    await api(
      `/api/templates/${encodeURIComponent(from)}/copy?to=${encodeURIComponent(id)}&title=${encodeURIComponent(name.trim())}`,
      {
        method: 'POST',
      },
    );
    return id;
  }

  /** Сохранить как отдельный шаблон (исходный не меняется). */
  static async saveAs() {
    const state = Design.state;
    const name = prompt(
      'Название нового шаблона (например, название компании):',
      `${state.work.name || 'Шаблон'} — копия`,
    );
    if (!name || !name.trim()) return;
    const id = await this._copy(state.id, name);
    const work = this.clean();
    work.name = name.trim();
    await this._putJson(id, work);
    state.saved = JSON.stringify(state.work);
    await Templates.load();
    renderForm();
    await this.open(id);
    state.note = `Создан шаблон «${name.trim()}» (папка templates/${id}). Выбрать его для КП — в разделе «Оформление КП».`;
    DesignPanels.top();
  }

  /** Новый шаблон для другой компании: копия основного шаблона, сразу в редакторе на вкладке «Шапка». */
  static async newCompany() {
    if (!ADMIN.on) {
      toast('Создавать шаблоны может администратор: войдите в «Настройках»');
      return;
    }
    const usable = Templates.list.filter(template => !template.error);
    const from = (usable.find(template => template.id === Templates.MAIN) || usable[0] || {}).id;
    if (!from) throw new Error('нет исходного шаблона');
    const name = prompt('Название компании (так будет называться шаблон):', '');
    if (!name || !name.trim()) return;
    const id = await this._copy(from, name);
    await Templates.load();
    renderForm();
    Design.state.tab = 'head';
    await this.open(id);
    Design.state.note = `Создан шаблон «${name.trim()}». Задайте шапку с логотипом, фирменный знак и цвета, затем «Сохранить».`;
    DesignPanels.top();
  }

  /** Закрыть окно (несохранённое — с вопросом). */
  static close() {
    if (DesignHistory.dirty() && !confirm('Закрыть без сохранения? Изменения шаблона пропадут.')) return;
    const dialog = $('#tddlg');
    if (dialog) {
      dialog.close();
      dialog.innerHTML = '';
    }
    Design.state.work = null;
    Design.state.sel = null;
  }

  /**
   * Загрузить картинку в папку шаблона.
   * @param {string} kind clients, header или extra
   * @param {File} file
   * @returns {Promise<string>} имя файла в шаблоне
   */
  static async upload(kind, file) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('нужна картинка PNG или JPEG');
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const name = `${this.UPLOAD_NAMES[kind] || 'img_'}${Date.now().toString(this.UID_BASE)}.${ext}`;
    await api(`/api/templates/${encodeURIComponent(Design.state.id)}/file?name=${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: file,
    });
    return name;
  }

  /** Пробный .docx с несохранёнными настройками. */
  static async trial() {
    const state = Design.state;
    if (!S.items.length) {
      toast('В КП нет позиций — добавьте оборудование, чтобы скачать пробный файл');
      return;
    }
    state.note = 'Собираю пробный файл…';
    DesignPanels.top();
    await KpSave.trial(state.id, this.clean());
    state.note = 'Пробный файл скачан (шаблон не изменён, пока не нажмёте «Сохранить»)';
    DesignPanels.top();
  }

  /** К форме «Настроить» (несохранённое — с вопросом). */
  static toForm() {
    const state = Design.state;
    if (DesignHistory.dirty() && !confirm('Несохранённые изменения графического редактора пропадут. Перейти к форме?'))
      return undefined;
    state.saved = JSON.stringify(state.work);
    const id = state.id;
    this.close();
    return TemplateEditor.open(id);
  }
}
