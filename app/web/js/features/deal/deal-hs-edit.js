import { DealHs } from './deal-hs.js';
import { DealState } from './deal-state.js';
import { DealUi } from './deal-ui.js';
import { Toast } from '../../core/toast.js';
import { KitDoc } from '../kit/kit-doc.js';
import { Api } from '../../core/net.js';
import { S } from '../../core/state.js';

/** Код ТН ВЭД и пошлина строки закупки, вписанные менеджером: у модели каталога — в справочник, иначе — в этом КП. */
export class DealHsEdit {
  /**
   * Код и ставка строки закупки: у модели каталога — в базу (для всех следующих сделок), иначе — в этом КП.
   * @param {string} lineId
   * @param {{code?: string, duty?: string}} patch
   */
  static set(lineId, patch) {
    const line = KitDoc.lines(S).find(row => row.id === lineId);
    if (!line) return;
    const item = line.item;
    const deal = DealState.ensure();
    const hsCode = DealHs.of(item);
    const value = { code: hsCode.code, duty: hsCode.duty };
    for (const field of ['code', 'duty']) if (patch[field] != null) value[field] = String(patch[field]).trim();
    if (patch.duty == null && value.code !== hsCode.code) value.duty = DealHs.dutyOf(value.code);
    if (!item.catId) {
      deal.hs = deal.hs || {};
      deal.hs[lineId] = value;
      return;
    }
    const key = `item:${item.catId}`;
    DealUi.cus = DealUi.cus || {};
    DealUi.cus[key] = { ...value };
    const body = JSON.stringify({ key, code: value.code, duty: value.duty, note: '' });
    Api.request('/api/customs', { method: 'PUT', headers: DealHs.JSON_HEAD, body }).catch(() =>
      Toast.show('Код не сохранён в справочнике — проверьте связь с сервером'),
    );
  }

  /**
   * Взять справочный код и ставку для строки.
   * @param {string} lineId
   * @returns {string} сообщение
   */
  static useRef(lineId) {
    const line = KitDoc.lines(S).find(row => row.id === lineId);
    const ref = line && DealHs.of(line.item).ref;
    if (!ref) return '';
    DealHsEdit.set(lineId, { code: ref.code, duty: ref.duty });
    return `Код ${ref.code || '—'}, пошлина ${ref.duty === '' ? '— уточните' : `${ref.duty} %`} — по справочнику`;
  }
}
