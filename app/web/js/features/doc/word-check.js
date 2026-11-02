import { Api } from '../../core/net.js';
import { FEAT } from '../../core/features.js';
import { S } from '../../core/state.js';
import { esc } from '../../core/util.js';

/**
 * Самопроверка КП в Word сервера отдела после «Сохранить КП» — для шаблонов, которые раскладывают позиции подряд
 * (функция скелета 'flow'): титул — на одном листе, нет почти пустых листов (заполнены меньше rules.sparsePct, кроме
 * титула и последнего). Нашлось — строка под сообщением о сохранении и в окне «КП сохранено» и «Пересобрать плотнее»:
 * у этого КП ступень плотности (S.layoutDense) выше, КП сохраняется заново и проверяется снова.
 */
export class WordCheck {
  static DENSE_MAX = 2;
  static SLOT = '[data-wordcheck]';

  /**
   * Шаблон раскладывает позиции подряд и умеет собрать файл плотнее.
   * @param {object} pack шаблон (Templates.pack)
   * @returns {boolean}
   */
  static supports(pack) {
    return ((pack && pack.skel && pack.skel.features) || []).includes('flow');
  }

  /**
   * Что не так в раскладке: титул на нескольких листах, почти пустые листы.
   * @param {{pages: number, cover: number, fill: number[]}} layout ответ сервера
   * @param {object} rules правила шаблона
   * @returns {string[]}
   */
  static problems(layout, rules) {
    const out = [];
    if (layout.cover > 1) out.push(`титул занял ${layout.cover} листа`);
    const limit = +(rules && rules.sparsePct) || 0;
    const first = Math.max(1, layout.cover);
    const sparse = (layout.fill || [])
      .map((fill, i) => ({ page: i + 1, fill }))
      .filter(({ page, fill }) => page > first && page < layout.pages && fill >= 0 && fill < limit); // -1 — Word не сообщил
    if (sparse.length)
      out.push(`почти пустые листы: ${sparse.map(({ page, fill }) => `${page} (${fill} %)`).join(', ')}`);
    return out;
  }

  /**
   * После сохранения: проверить файл в фоне и показать итог в местах [data-wordcheck].
   * @param {object} pack шаблон, по которому собран файл
   */
  static after(pack) {
    if (!FEAT.on('wordCheck') || !this.supports(pack) || !S.kpId) return;
    const kpId = S.kpId;
    const dense = +S.layoutDense || 0;
    this._show('<div class="muted">Проверяю раскладку в Word…</div>');
    Api.request(`/api/kp/${encodeURIComponent(kpId)}/layout`, { method: 'POST' })
      .then(layout => {
        if (S.kpId !== kpId) return;
        if (!layout || !layout.available) this._show('');
        else this._show(this.html(this.problems(layout, (pack.settings && pack.settings.rules) || {}), dense));
      })
      .catch(error => {
        if (S.kpId === kpId)
          this._show(`<div class="muted">Проверка в Word не выполнена: ${esc(error.message || error)}</div>`);
      });
  }

  /**
   * Итог проверки: всё в порядке или что не так и «Пересобрать плотнее» (пока ступени плотности не кончились).
   * @param {string[]} problems
   * @param {number} dense ступень плотности, с которой собран файл
   * @returns {string}
   */
  static html(problems, dense) {
    if (!problems.length)
      return `<div class="muted">Проверено в Word: титул — один лист, пустых листов нет${dense ? ' (собрано плотнее)' : ''}.</div>`;
    const more =
      dense < this.DENSE_MAX
        ? ` <button class="btn sm" type="button" data-a="denseKp" title="Меньше фото и отступов — КП сохранится заново и проверится снова">Пересобрать плотнее</button>`
        : ' Плотнее уже нельзя — сократите описание или уберите лишние фото позиции.';
    return `<div class="msg warn">Проверка в Word: ${esc(problems.join('; '))}.${more}</div>`;
  }

  static _show(html) {
    document.querySelectorAll(this.SLOT).forEach(slot => {
      slot.innerHTML = html;
    });
  }

  /** «Пересобрать плотнее»: ступень плотности этого КП выше, сохранить КП заново (окно «КП сохранено» — закрыть). */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-a="denseKp"]');
      if (!button) return;
      S.layoutDense = Math.min(this.DENSE_MAX, (+S.layoutDense || 0) + 1);
      const close = button.closest('.dlg') && button.closest('.dlg').querySelector('[data-x]');
      if (close) close.click();
      const save = document.querySelector('[data-a="download"]');
      if (save) save.click();
    });
  }
}
