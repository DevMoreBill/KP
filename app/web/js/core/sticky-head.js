/**
 * Телефон: шапка окна уходит вверх вместе с прокруткой, у края остаётся её нижняя строка (поиск каталога, разделы
 * кабинета) — шапка прилипает, поднявшись на строки над ней. Насколько поднять и сколько остаётся видно, ставят
 * CSS-свойства окна `<prefix>-lift` и `<prefix>-stuck`; на ПК шапка не прилипает — свойства не ставятся.
 */
export class StickyHead {
  static observers = new Map();

  /**
   * Следить за высотой шапки окна (окно перерисовано — шапка новая).
   * @param {HTMLElement} host окно
   * @param {{head: string, keep: string, prefix: string}} spec шапка, строка, которая остаётся, начало имён свойств
   */
  static watch(host, spec) {
    this.observers.get(host)?.disconnect();
    const head = host.querySelector(spec.head);
    if (!head) return;
    const observer = new ResizeObserver(() => this._lift(host, head, spec));
    observer.observe(head);
    this.observers.set(host, observer);
  }

  // строка, которая остаётся, — на прежнем отступе от края окна, но не выше пустого места над ней: край строк выше
  // (кнопки вплотную к разделам кабинета) не выглядывает из-под края
  static _lift(host, head, spec) {
    const keep = head.querySelector(spec.keep);
    const style = getComputedStyle(head);
    if (!keep || !head.offsetHeight || style.position !== 'sticky') return;
    const above = [...head.children].filter(row => row.offsetHeight && row.offsetTop < keep.offsetTop);
    const roof = Math.max(parseFloat(style.paddingTop), ...above.map(row => row.offsetTop + row.offsetHeight));
    const gap = Math.min(parseFloat(style.paddingTop), Math.max(0, keep.offsetTop - roof));
    const lift = Math.max(0, keep.offsetTop - gap);
    host.style.setProperty(`${spec.prefix}-lift`, `${lift}px`);
    host.style.setProperty(`${spec.prefix}-stuck`, `${head.offsetHeight - lift}px`);
  }

  /**
   * Начало содержимого — сразу под прилипшей шапкой (новый отбор, другой раздел); шапка видна целиком — прокрутка
   * остаётся. Высоту прилипшей части берёт из `scroll-padding-top` того, что прокручивается.
   * @param {HTMLElement} scroller
   * @param {HTMLElement} content
   */
  static reveal(scroller, content) {
    const stuck = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
    const target =
      scroller.scrollTop + content.getBoundingClientRect().top - scroller.getBoundingClientRect().top - stuck;
    if (scroller.scrollTop > target) scroller.scrollTop = Math.max(0, target);
  }
}
