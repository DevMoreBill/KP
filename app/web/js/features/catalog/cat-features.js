/** Блоки описания позиции каталога, которые уходят в КП: без «Опций по прайсу поставщика» (там закупочные цены). */
export class CatFeatures {
  /**
   * @param {object[]} list
   * @returns {object[]}
   */
  static forKp(list) {
    return (list || []).filter(feature => feature && !feature.feedOpts);
  }
}
