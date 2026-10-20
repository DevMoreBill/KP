/** Материал и условный проход трубопроводной обвязки, опознавательная окраска труб (ГОСТ 14202-69). */
export class PipeMaterial {
  static LIST = [
    { id: 'steel', name: 'Сталь', row: 'сталь (трубы стальные по ГОСТ 10704, окраска)', color: '#59636e' },
    { id: 'inox', name: 'Нержавеющая сталь', row: 'нержавеющая сталь AISI 304 (08Х18Н10)', color: '#b3bdc7' },
    { id: 'pp', name: 'Полипропилен', row: 'полипропилен PP-R (ГОСТ 32415)', color: '#5d9c6b' },
  ];

  static ROW = 'Материал трубопровода';
  static DN_ROW = 'Условный проход';
  static ID_COLOR = { air: '#1f5aa6', in: '#3b7d3d', out: '#3b7d3d', fuel: '#6e4426' };

  static WORDS = [
    ['inox', /нерж|aisi|08х18|12х18/],
    ['pp', /полипроп|pp-?r|ппр/],
    ['steel', /стал|гост 10704|гост 3262|ст\.?\s?20/],
  ];

  /** Опознавательный цвет трубы среды, иначе — цвет материала. */
  static idColor(medium, fallback) {
    return this.ID_COLOR[medium] || fallback;
  }

  /** Направление потока: 1 — к концу x1, -1 — к началу; у коллектора компрессоров — к входу первого аппарата. */
  static flow(line, x) {
    if (line.header && line.to != null) return x < line.to ? 1 : -1;
    return line.medium === 'in' ? -1 : 1;
  }

  static get(id) {
    return this.LIST.find(material => material.id === id) || null;
  }

  /** Материал элемента: выбранный в составе, иначе по строкам «Материал…» и названию; не понятно — null. */
  static of(product) {
    if (!product) return null;
    if (this.get(product.pipeMat)) return this.get(product.pipeMat);
    const rows = (product.rows || [])
      .filter(row => row && /материал|исполнен|труб/i.test(String(row.k || '')))
      .map(row => row.v);
    const text = [...rows, product.name, product.desc]
      .map(v => String(v || ''))
      .join(' ')
      .toLowerCase();
    const hit = this.WORDS.find(([, pattern]) => pattern.test(text));
    return hit ? this.get(hit[0]) : null;
  }

  /** Условный проход: поле DN или строка «Условный проход» / «Диаметр» → «DN 50». */
  static bore(product) {
    const row = /условн\S* проход|диаметр|\bDN\b|(?:^|[^а-яё])Ду(?![а-яё])/i;
    const fromRows = ((product && product.rows) || [])
      .filter(entry => entry && row.test(String(entry.k || '')))
      .map(entry => entry.v)[0];
    const v = String((product && product.dn) || fromRows || '').trim();
    const match = v.match(/\d{2,4}/);
    return match ? `DN ${match[0]}` : '';
  }
}
