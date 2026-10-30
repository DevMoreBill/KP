import { AsmAi } from './asm-ai.js';
import { AsmBuilder } from './asm-builder.js';
import { AsmCatalog } from './asm-catalog.js';
import { AsmItem } from './asm-item.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Toast } from '../../core/toast.js';

/**
 * Действия окна «Сборное изделие» сверх каталога: новая карточка каталога окном «Добавить оборудование», дозаполнение
 * карточки части из файла, ИИ — описание и сводные характеристики, части из техничек. Пока открыта карточка каталога, окно
 * изделия ждёт (`AsmBuilder.held`) и возвращается с новой частью (или без неё — «← Назад» в окне новой карточки).
 */
export class AsmActions {
  static ROUTES = [
    ['[data-asmcard]', '_card', 'asmcard'],
    ['[data-asmfix]', '_fix', 'asmfix'],
    ['[data-asmai]', '_describe', 'asmai'],
  ];

  /**
   * Новая карточка каталога для части (контейнер — категорию выбирает менеджер; оборудование — основная категория вида).
   * @param {string} kind container | equip | power
   */
  static _card(kind) {
    const state = AsmBuilder.state;
    const main = ((EquipTypes.byId(state.cat).station || {}).main || [])[0] || '';
    const cat = { container: 'container', equip: main, power: 'dgu' }[kind] ?? '';
    AsmBuilder.held = state;
    AsmCatalog.newCard(cat, {
      onSaved: saved =>
        this._take(() => AsmBuilder.add(AsmItem.part(saved, AsmBuilder.roleOf(kind, saved))), saved.name),
      onBack: () => this._resume(),
    });
  }

  // окно изделия — снова с начатой сборкой
  static _resume() {
    const state = AsmBuilder.held;
    AsmBuilder.held = null;
    if (state) AsmBuilder.reopen(state);
  }

  static _take(apply, name) {
    if (!AsmBuilder.held) return;
    this._resume();
    apply();
    Toast.show(`В изделие: ${name}`);
  }

  /** @param {string} value номер части */
  static _fix(value) {
    const j = +value;
    const state = AsmBuilder.state;
    const part = state.parts[j];
    if (!part || !part._doc) return;
    AsmBuilder.held = state;
    AsmCatalog.fill(part, saved =>
      this._take(() => {
        const fixed = AsmItem.part(saved, part.role);
        fixed.qty = part.qty;
        state.parts.splice(j, 1, fixed);
        AsmBuilder.changed();
      }, saved.name),
    );
  }

  static async _describe() {
    const state = AsmBuilder.state;
    await this._busy(state, 'Нейросеть пишет описание и сводные характеристики…', async () => {
      state.ai = await AsmAi.describe(state.cat, state.parts);
      Toast.show('Описание и сводные характеристики готовы — попадут в КП');
    });
  }

  /**
   * Части изделия из файлов: тексты и картинки → ИИ → карточки каталога → состав; затем описание и сводные.
   * @param {HTMLInputElement} field
   */
  static async _files(field) {
    const files = [...field.files];
    field.value = '';
    const state = AsmBuilder.state;
    if (!files.length || !state) return;
    await this._busy(state, `Читаю файлы: ${files.length}…`, async () => {
      const read = await AsmAi.read(files);
      const errors = read.filter(file => file.error).map(file => `${file.name}: ${file.error}`);
      if (!read.some(file => file.text.trim())) throw new Error(errors.join('; ') || 'В файлах нет текста');
      this._say(state, 'Нейросеть разбирает файлы…');
      const found = await AsmAi.fromFiles(state.cat, read);
      if (!found.length) throw new Error('В файлах не нашлось контейнера и оборудования');
      this._say(state, 'Записываю карточки в каталог…');
      for (const one of found) state.parts.push(await AsmCatalog.fromAi(one));
      this._report(state, found.length, errors);
      if (AsmAi.enabled()) {
        this._say(state, 'Нейросеть пишет описание и сводные характеристики…');
        state.ai = await AsmAi.describe(state.cat, state.parts);
      }
    });
  }

  static _report(state, count, errors) {
    const need = state.parts.filter(part => part.need && part.need.length).length;
    const parts = [`Из файлов частей: ${count}`, need ? `не в каталоге: ${need} — заполните карточки` : '', ...errors];
    Toast.show(parts.filter(Boolean).join('; '));
  }

  static _say(state, text) {
    state.busy = text;
    if (AsmBuilder.state === state) AsmBuilder.draw();
  }

  static async _busy(state, text, work) {
    if (!state || state.busy) return;
    this._say(state, text);
    try {
      await work();
    } catch (error) {
      Toast.show(String(error.message || error));
    }
    state.busy = '';
    if (AsmBuilder.state === state) AsmBuilder.changed();
  }

  /** Обработчики: кнопки окна изделия и выбор файлов. */
  static listen() {
    document.addEventListener('click', event => {
      if (!event.target.closest('#dlg.asm') || !AsmBuilder.state) return;
      for (const [selector, method, key] of this.ROUTES) {
        const button = event.target.closest(selector);
        if (button) {
          this[method](button.dataset[key]);
          return;
        }
      }
    });
    document.addEventListener('change', event => {
      const field = event.target;
      if (field.closest && field.closest('#dlg.asm') && field.dataset.asmfiles != null) this._files(field);
    });
  }
}
