/**
 * Фото со страницы товара (автозаполнение и «Фото с сайта поставщика»): ★ — главное, галочки — какие добавить в изображения.
 * Сервер скачивает их в изображения позиции; уже добавленные (тот же адрес у поставщика) пропускаются.
 */
export class PageImages {
  static dlg = null; // {url, imgs} — окно «Фото со страницы товара»
  static URL_RE = /^https?:\/\/./;
  static JSON_HEAD = { 'Content-Type': 'application/json' };

  static _url(item) {
    return (item.feed && item.feed.url) || item.pageUrl || '';
  }

  /**
   * «Фото с сайта поставщика»: по адресу страницы товара позиции.
   * @param {number} i позиция КП
   */
  static async open(i) {
    const url = this._url(S.items[i]);
    await this._show(i, url || prompt('Ссылка на страницу товара на сайте поставщика', url || 'https://'));
  }

  /**
   * «Фото с сайта поставщика» по другой ссылке (Shift+клик).
   * @param {number} i
   */
  static async ask(i) {
    const url = this._url(S.items[i]);
    await this._show(i, prompt('Ссылка на страницу товара на сайте поставщика', url || 'https://'));
  }

  static async _show(i, url) {
    if (!url || !this.URL_RE.test(url.trim())) return;
    toast('Ищу фото на странице товара…');
    let answer;
    try {
      answer = await api('/api/pagetext', {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify({ url: url.trim() }),
      });
    } catch (error) {
      toast(String(error.message || error));
      return;
    }
    const imgs = answer.imgs || [];
    if (!imgs.length) {
      toast('На странице не найдено фото товара — сохраните картинку и перетащите её в карточку');
      return;
    }
    this.dlg = { url: url.trim(), imgs };
    const dialog = $('#dlg');
    dialog.classList.add('wide');
    dialog.innerHTML = `<div class="dlg-h"><h3>Фото со страницы товара<small>${esc(url.trim())}</small></h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b">${this.html(i, imgs, 'dlg')}</div>`;
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
  }

  /**
   * Выбор фото со страницы. По умолчанию («Настройки → Умолчания») отмечено только главное фото, остальные — по выбору.
   * @param {number} i
   * @param {string[]} imgs
   * @param {string} src ai | dlg
   * @returns {string}
   */
  static html(i, imgs, src) {
    const item = S.items[i];
    const hasMain = !!(item.photo && item.photo.src);
    const only = DEF('img.mainOnly');
    const picked = k => !only || (!hasMain && k === 0);
    const list = imgs
      .map(
        (
          url,
          k,
        ) => `<div class="pim-i"><span class="pim-ph"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
      <label class="pim-m" title="Сделать главным фото"><input type="radio" name="pimMain${i}" value="${k}"${!hasMain && k === 0 ? ' checked' : ''}> ★ Главное</label>
      <label class="pim-c"><input type="checkbox" data-pimk="${k}"${picked(k) ? ' checked' : ''}> добавить</label></div>`,
      )
      .join('');
    return `<div class="pim" data-pim="${i}" data-src="${src || 'ai'}">
    <div class="pim-h"><b>Фото со страницы: ${imgs.length}</b><span class="muted">★ — главное фото позиции, галочка — добавить в «Описание и фото».</span>
      <span class="pim-all"><button type="button" class="lnk" data-pimall="1">отметить все</button> · <button type="button" class="lnk" data-pimall="0">снять все</button></span></div>
    <div class="pim-l">${list}</div>
    <div class="pim-f">${hasMain ? `<label class="pim-keep"><input type="radio" name="pimMain${i}" value="-1" checked> оставить текущее главное фото</label>` : ''}
      <button type="button" class="btn primary" data-pimgo="${i}">Добавить выбранные фото</button></div></div>`;
  }

  static _picked(i, box) {
    const main = +((box.querySelector(`input[name="pimMain${i}"]:checked`) || {}).value ?? -1);
    const keys = [...box.querySelectorAll('[data-pimk]:checked')].map(input => +input.dataset.pimk);
    if (main >= 0 && !keys.includes(main)) keys.unshift(main);
    return { main, keys };
  }

  // новое главное; прежнее главное — в изображения
  static _setMain(item, pic, have) {
    const photo = item.photo;
    if (photo && photo.src && photo.src !== pic.src && !item.gallery.some(one => one.src === photo.src)) {
      item.gallery.push({
        id: uid(),
        src: photo.src,
        w: photo.w,
        h: photo.h,
        caption: '',
        slot: '',
        wide: '',
        at: '',
        on: true,
        ...(item.photoSource ? { source: item.photoSource } : {}),
      });
    }
    item.gallery = item.gallery.filter(one => one.src !== pic.src);
    item.photo = { src: pic.src, w: pic.w, h: pic.h };
    item.photoSource = pic.source;
    delete item.photoFrom;
    have.add(pic.src);
    have.add(pic.source);
  }

  static _addRest(item, { keys, main, bySrc, imgs, have }) {
    let added = 0;
    for (const k of keys) {
      if (k === main) continue;
      const pic = bySrc.get(imgs[k]);
      if (!pic || have.has(pic.source) || have.has(pic.src)) continue;
      have.add(pic.src);
      item.gallery.push({
        id: uid(),
        src: pic.src,
        w: pic.w,
        h: pic.h,
        caption: '',
        slot: '',
        wide: '',
        at: '',
        on: true,
        source: pic.source,
      });
      added++;
    }
    return added;
  }

  // скачанные фото — главным и в изображения позиции (уже добавленные — пропускаются)
  static _place(item, { answer, main, keys, imgs }) {
    const bySrc = new Map((answer.imgs || []).map(pic => [pic.source, pic]));
    item.gallery = item.gallery || [];
    const have = new Set(
      [item.photoSource, item.photo && item.photo.src, ...item.gallery.flatMap(pic => [pic.source, pic.src])].filter(
        Boolean,
      ),
    );
    const first = main >= 0 ? bySrc.get(imgs[main]) : null;
    if (first) this._setMain(item, first, have);
    const added = (first ? 1 : 0) + this._addRest(item, { keys, main, bySrc, imgs, have });
    return { added, first };
  }

  static _report(added, mainSet, bad) {
    if (added)
      return `Добавлено фото: ${added}${mainSet ? ' — главное фото заменено' : ''}${bad ? ` · не скачались: ${bad}` : ''}`;
    return bad ? `Фото не скачались (${bad}) — сайт не отдаёт картинки` : 'Эти фото уже есть у позиции';
  }

  static async _fetch(item, url, urls) {
    try {
      return await api('/api/pagephotos', {
        method: 'POST',
        headers: this.JSON_HEAD,
        body: JSON.stringify({ url, urls, ...imgPlace(item) }),
      });
    } catch (error) {
      toast(String(error.message || error));
      return null;
    }
  }

  /**
   * Скачать отмеченные фото в изображения позиции.
   * @param {number} i
   * @param {{url: string, imgs: string[]}} page
   * @param {HTMLElement} box
   * @returns {Promise<boolean>} добавлено
   */
  static async add(i, { url, imgs }, box) {
    const item = S.items[i];
    if (!item) return false;
    const { main, keys } = this._picked(i, box);
    if (!keys.length) {
      toast('Отметьте хотя бы одно фото');
      return false;
    }
    toast(`Загружаю фото: ${keys.length}…`);
    const answer = await this._fetch(
      item,
      url,
      keys.map(k => imgs[k]),
    );
    if (!answer) return false;
    const { added, first } = this._place(item, { answer, main, keys, imgs });
    if (url && !item.pageUrl && !(item.feed && item.feed.url)) item.pageUrl = url;
    item.page = true;
    renderForm();
    persist();
    toast(this._report(added, !!first, (answer.errors || []).length));
    return true;
  }

  static async _go(button) {
    const box = button.closest('.pim');
    const i = +button.dataset.pimgo;
    const item = S.items[i];
    if (!item) return;
    const page =
      box.dataset.src === 'dlg' ? this.dlg : { url: String(item._srcUrl || '').trim(), imgs: item._srcImgs || [] };
    if (!page || !page.imgs.length) return;
    button.disabled = true;
    const ok = await this.add(i, page, box);
    button.disabled = false;
    if (!ok || box.dataset.src !== 'dlg') return;
    const dialog = $('#dlg');
    if (dialog.open) dialog.close();
  }

  /** «Отметить все», «Добавить выбранные фото». */
  static listen() {
    document.addEventListener('click', event => {
      const all = event.target.closest('[data-pimall]');
      if (all) {
        all
          .closest('.pim')
          .querySelectorAll('[data-pimk]')
          .forEach(input => {
            input.checked = all.dataset.pimall === '1';
          });
        return;
      }
      const button = event.target.closest('[data-pimgo]');
      if (button) this._go(button);
    });
  }
}
