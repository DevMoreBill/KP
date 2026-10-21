import { Design } from './design.js';
import { Uid } from '../../core/util.js';
import { CatalogFill } from '../catalog/catalog-fill.js';
import { Catalog, CatalogStore } from '../catalog/catalog-store.js';
import { KpState, S } from '../../core/state.js';
import { KpConditions } from '../../core/conditions.js';

/** Графический редактор шаблона: пример КП для показа оформления, когда в текущем КП нет позиций. */
export class DesignDemo {
  static SHOWN = 2;
  static SAMPLE = {
    name: 'Компрессор винтовой ПРИМЕР-37',
    spec: '37 кВт, 6,2 м³/мин',
    price: 1250000,
    page: true,
    groups: [
      {
        name: 'Основные',
        rows: [
          { k: 'Производительность', v: '6,2 м³/мин' },
          { k: 'Мощность', v: '37 кВт' },
          { k: 'Давление', v: '8 бар' },
        ],
      },
    ],
  };

  static _base() {
    const demo = KpState.fresh();
    Object.assign(demo, {
      client: 'ООО «Пример заказчика»',
      clientInn: '7700000000',
      number: '001',
      object: { purpose: 'Объект заказчика', address: 'г. Москва' },
      contact: { name: 'Иванов Иван Иванович', post: 'Главный инженер', phone: '', email: '' },
      manager: { ...S.manager, name: S.manager.name || 'Петров Пётр', position: S.manager.position || 'Менеджер' },
    });
    demo.conditions.forEach(condition => {
      condition.value = (KpConditions.LIST.find(row => row[0] === condition.label) || [0, ['—']])[1][0];
    });
    return demo;
  }

  static async _catalog() {
    try {
      return await CatalogStore.list();
    } catch {
      return [];
    }
  }

  static async _doc(row) {
    try {
      return await Catalog.fullDoc(row);
    } catch {
      return null;
    }
  }

  // пример подставляется без ожидания: пока S — пример, автосохранение черновика не успеет его записать
  static _fill(demo, item, doc) {
    const previous = S;
    KpState.replace(demo);
    try {
      if (doc) CatalogFill.fill(item, doc);
    } catch {
      /* позиция каталога без нужных полей — остаётся пустой */
    } finally {
      KpState.replace(previous);
    }
  }

  /**
   * Пример КП или null, если в КП есть позиции (state.demo — показан пример).
   * @returns {Promise<object|null>}
   */
  static async state() {
    if (S.items.length) {
      Design.state.demo = false;
      return null;
    }
    Design.state.demo = true;
    const demo = this._base();
    const list = await this._catalog();
    const priced = list.filter(row => row.price && row.photo).slice(0, 1);
    const pick = priced.concat(list.filter(row => row.price && !row.photo)).slice(0, this.SHOWN);
    for (const row of pick) {
      const item = KpState.newItem();
      const doc = await this._doc(row);
      this._fill(demo, item, doc);
      item.qty = 1;
      demo.items.push(item);
    }
    if (!demo.items.length) demo.items.push(this._sample());
    return demo;
  }

  static _sample() {
    const item = KpState.newItem();
    Object.assign(item, JSON.parse(JSON.stringify(this.SAMPLE)), {
      features: [
        { id: Uid.next(), label: 'Назначение', text: 'Пример описания оборудования для показа оформления шаблона.' },
      ],
    });
    return item;
  }
}
