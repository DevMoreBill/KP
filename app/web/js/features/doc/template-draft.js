import { Templates } from './templates.js';

/**
 * Шаблон для правки (форма «Настроить» и графический редактор): файлы шаблона заново с сервера, форма editor.json и рабочая
 * копия настроек — умолчания скелета, поверх них template.json.
 */
export class TemplateDraft {
  /**
   * Шаблон для правки.
   * @param {string} id
   * @returns {Promise<{pack: object, form: object, work: object}>}
   */
  static async load(id) {
    Templates.dropCache(id);
    const pack = await Templates.pack(id);
    const response = await fetch(`/tpl/${encodeURIComponent(id)}/editor.json`, { cache: 'no-store' });
    const form = response.ok ? await response.json() : { tabs: [] };
    const work = KPGen.deepMerge(pack.skel.defaults, pack.json);
    work.sections = this.sections(work.sections, pack.skel.defaults.sections);
    return { pack, form, work };
  }

  /**
   * Разделы шаблона: известные скелету — в своём порядке и с умолчаниями, недостающие — в конце.
   * @param {object[]} list
   * @param {object[]} defaults
   * @returns {object[]}
   */
  static sections(list, defaults) {
    const given = (Array.isArray(list) ? list : []).filter(row => row && defaults.some(def => def.id === row.id));
    const known = given.map(row => ({ ...defaults.find(def => def.id === row.id), ...row }));
    const rest = defaults.filter(def => !given.some(row => row.id === def.id)).map(def => ({ ...def }));
    return known.concat(rest);
  }
}
