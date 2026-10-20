/**
 * Обновить разметку элемента, не пересоздавая совпадающие узлы: фото не загружаются заново, фокус, курсор и прокрутка не
 * сбиваются, нажатие не «проваливается» в заменённую кнопку (важно на телефонах).
 */
export class Morph {
  static ELEMENT = 1;

  /**
   * @param {Element} el
   * @param {string} html
   */
  static apply(el, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    this._kids(el, tpl.content);
  }

  // узел с ключом (id, data-id, поле data-p) сопоставляется только с узлом того же ключа, где бы он ни стоял: иначе при
  // появлении новой кнопки перед полем ввода поле «превратилось» бы в соседнее вместе с набираемым текстом
  static _key(node) {
    if (node.nodeType !== this.ELEMENT) return '';
    return node.id || node.getAttribute('data-id') || node.getAttribute('data-p') || '';
  }

  static _same(old, fresh) {
    if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) return false;
    if (old.nodeType !== this.ELEMENT) return true;
    return this._key(old) === this._key(fresh) && (old.type || '') === (fresh.type || '');
  }

  static _keyed(parent) {
    const keyed = new Map();
    for (const child of parent.childNodes) {
      const key = this._key(child);
      if (key && !keyed.has(key)) keyed.set(key, child);
    }
    return keyed;
  }

  static _match(fresh, cur, keyed) {
    const key = this._key(fresh);
    if (!key) return cur && !this._key(cur) && this._same(cur, fresh) ? cur : null;
    const old = keyed.get(key) || null;
    if (!old || !this._same(old, fresh)) return null;
    keyed.delete(key);
    return old;
  }

  static _kids(old, fresh) {
    const keyed = this._keyed(old);
    let cur = old.firstChild;
    for (const node of [...fresh.childNodes]) {
      const match = this._match(node, cur, keyed);
      if (!match) {
        old.insertBefore(node, cur);
        continue;
      }
      if (match === cur) cur = cur.nextSibling;
      else old.insertBefore(match, cur);
      if (match.nodeType !== this.ELEMENT) {
        if (match.nodeValue !== node.nodeValue) match.nodeValue = node.nodeValue;
      } else this._el(match, node);
    }
    this._trim(cur);
  }

  // всплывающие списки поверх окна (data-morph-keep) — не трогаем
  static _trim(from) {
    let cur = from;
    while (cur) {
      const next = cur.nextSibling;
      if (!(cur.nodeType === this.ELEMENT && cur.hasAttribute('data-morph-keep'))) cur.remove();
      cur = next;
    }
  }

  static _attrs(old, fresh) {
    for (const attr of [...old.attributes]) if (!fresh.hasAttribute(attr.name)) old.removeAttribute(attr.name);
    for (const attr of [...fresh.attributes]) {
      if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
    }
  }

  static _input(old, fresh) {
    if (old.type === 'checkbox' || old.type === 'radio') {
      old.checked = fresh.hasAttribute('checked');
      return;
    }
    if (old.type === 'file') return;
    const value = fresh.getAttribute('value') ?? '';
    if (old.value !== value) old.value = value;
  }

  static _el(old, fresh) {
    this._attrs(old, fresh);
    const tag = old.nodeName;
    if (tag === 'INPUT') {
      this._input(old, fresh);
      return;
    }
    if (tag === 'TEXTAREA') {
      if (old.value !== fresh.value) old.value = fresh.value;
      return;
    }
    this._kids(old, fresh);
    if (tag === 'SELECT') {
      const value = fresh.querySelector('option[selected]')?.value ?? fresh.querySelector('option')?.value;
      if (value != null && old.value !== value) old.value = value;
    }
  }
}
