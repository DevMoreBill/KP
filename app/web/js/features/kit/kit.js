/**
 * Сборка: одна позиция КП из нескольких элементов (`x.kit.parts`) — основное оборудование (`role: 'main'`), контейнер
 * (`role: 'container'`) и прочие элементы; закупка изделия — сумма закупок элементов по курсам КП.
 */
export class Kit {
  static PRESETS = [
    'Шасси (прицеп)',
    'Глушитель',
    'Шкаф АВР',
    'Топливный бак',
    'Система подогрева',
    'Монтажный комплект',
  ];
  static LISTS = ['kit.presets'];

  /**
   * Элементы сборки.
   * @param {object} item позиция КП
   * @returns {object[]}
   */
  static parts(item) {
    return item && item.kit && Array.isArray(item.kit.parts) ? item.kit.parts : [];
  }

  /**
   * Позиция — сборка (есть элементы).
   * @param {object} item
   * @returns {boolean}
   */
  static has(item) {
    return Kit.parts(item).length > 0;
  }

  /**
   * Правило станции категории позиции (`equipment_types.json`, поле `station`) или null.
   * @param {object} item
   * @returns {object|null}
   */
  static station(item) {
    return typeById(attrsOf(item).cat).station || null;
  }

  /**
   * Можно собирать состав: станция или уже сборка.
   * @param {object} item
   * @returns {boolean}
   */
  static can(item) {
    return !!Kit.station(item) || Kit.has(item);
  }

  /**
   * Элемент «контейнер».
   * @param {object} item
   * @returns {object|undefined}
   */
  static container(item) {
    return Kit.parts(item).find(part => part.role === 'container');
  }

  /**
   * Основное оборудование.
   * @param {object} item
   * @returns {object|undefined}
   */
  static main(item) {
    return Kit.parts(item).find(part => part.role === 'main');
  }

  /**
   * Новый элемент сборки.
   * @param {object} [fields] свои поля элемента
   * @returns {object}
   */
  static newPart(fields = {}) {
    return { id: uid(), name: '', qty: 1, cost: 0, costCur: 'RUB', sup: '', desc: '', rows: [], ...fields };
  }

  /**
   * Закупка изделия за единицу, коп. ₽; NaN — нет курса валюты элемента.
   * @param {object} item
   * @returns {number}
   */
  static cost(item) {
    let sum = 0;
    for (const part of Kit.parts(item)) {
      if (!part.cost) continue;
      const currency = part.costCur || 'RUB';
      const rate = currency === 'RUB' ? 1 : Currency.rate(currency);
      if (!(rate > 0)) return NaN;
      sum += part.cost * (+part.qty || 0) * rate;
    }
    return Math.round(sum);
  }

  /**
   * Закупка позиции = закупка состава (в рублях).
   * @param {object} item
   * @returns {boolean} закупка изменилась
   */
  static sync(item) {
    if (!Kit.has(item)) return false;
    const cost = Kit.cost(item);
    if (!Number.isFinite(cost)) return false;
    const changed = item.cost !== cost || (item.costCur || 'RUB') !== 'RUB';
    item.cost = cost;
    item.costCur = 'RUB';
    return changed;
  }
}
