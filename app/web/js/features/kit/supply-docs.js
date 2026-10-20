/**
 * Документы при поставке станции (блок в КП) — по составу: паспорта и руководства, декларации ЕАЭС по техническим
 * регламентам, паспорт сосуда на каждый ресивер, исполнительная документация и протоколы испытаний.
 */
export class SupplyDocs {
  static MACHINES = ['compressor', 'pump', 'dgu', 'dryer'];
  static SCHEME = { comp: 'схема пневматическая принципиальная', pump: 'схема гидравлическая принципиальная' };

  /**
   * Перечень документов.
   * @param {object} item позиция КП
   * @returns {string[]}
   */
  static list(item) {
    const parts = Kit.parts(item).filter(part => String(part.name || '').trim());
    const has = (...kinds) => parts.some(part => kinds.includes(StationEquip.kindOf(part)));
    const kind = StationReq.kind(item);
    return [
      'паспорта и руководства по эксплуатации оборудования на русском языке',
      this._declarations(parts, has),
      has('receiver')
        ? 'паспорт сосуда, работающего под давлением, — на каждый ресивер, паспорт предохранительного клапана'
        : '',
      [
        'паспорт станции',
        'габаритный чертёж',
        this.SCHEME[kind] || '',
        'схема электрическая принципиальная',
        'перечень оборудования',
      ]
        .filter(Boolean)
        .join(', '),
      `протоколы испытаний при сборке: ${kind === 'dgu' ? 'топливопровод на плотность' : 'опрессовка трубопроводов'}, сопротивление изоляции, металлосвязь (заземление)`,
    ].filter(Boolean);
  }

  // машины и оборудование (ТР ТС 010), низковольтное (004), ЭМС (020), под давлением (032 — ресиверы, колонны осушителя)
  static _declarations(parts, has) {
    const machines = has(...this.MACHINES);
    const electric = machines || has('cabinet');
    const vessel =
      has('receiver') ||
      parts.some(part => StationEquip.kindOf(part) === 'dryer' && /адсорбц/i.test(AirChain.text(part)));
    const regulations = [
      machines && 'ТР ТС 010/2011 «О безопасности машин и оборудования»',
      electric && 'ТР ТС 004/2011 «О безопасности низковольтного оборудования»',
      electric && 'ТР ТС 020/2011 «Электромагнитная совместимость технических средств»',
      vessel && 'ТР ТС 032/2013 «О безопасности оборудования, работающего под избыточным давлением»',
    ].filter(Boolean);
    return regulations.length ? `декларации (сертификаты) соответствия: ${regulations.join(', ')}` : '';
  }

  /**
   * Блок описания для документа КП (станция, документы включены) или null.
   * @param {object} item
   * @returns {{id: string, label: string, text: string}|null}
   */
  static feature(item) {
    if (!Kit.station(item) || !StationReq.docs(item) || !Kit.parts(item).length) return null;
    const text = this.list(item)
      .map((line, i) => (i ? line : line[0].toUpperCase() + line.slice(1)))
      .join('; ');
    return { id: 'kit_docs', label: 'Документы при поставке', text: `${text}.` };
  }
}
