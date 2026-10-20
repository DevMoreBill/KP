import { AdminApi, AdminDialog } from './admin-core.js';

/** Обслуживание базы: автокопии (архивы ZIP), сжатие и проверка, срок журнала действий, изображения без ссылок. */
export class DbMaint {
  static YEARS = [1, 2, 3, 5, 10];
  static FEW_YEARS = 5;
  static ACTIONS = { backup: '_backup', run: '_run', imgscan: '_scan', imgdel: '_purge' };

  /**
   * Строка о последней копии: время, проверка, размер архива рядом с размером базы.
   * @param {object} backup
   * @returns {string}
   */
  static last(backup) {
    if (!backup.at) return '<span class="bad-t">копий ещё не было</span>';
    if (!backup.ok)
      return `<span class="bad-t">${esc(Fmt.dateTime(backup.at))} — ошибка: ${esc(backup.error || '')}</span>`;
    const size = backup.bytes
      ? ` · ${backup.zip ? 'архив ZIP ' : ''}${Fmt.size(backup.bytes)}${backup.zip && backup.db ? ` (база ${Fmt.size(backup.db)})` : ''}`
      : '';
    return `<span class="ok-t">${esc(Fmt.dateTime(backup.at))} — исправна</span>${size}`;
  }

  /**
   * Блок обслуживания.
   * @param {HTMLElement} box
   * @param {object|null} reply ответ maint (null — загрузить)
   * @param {string} [part] copies — автокопии, service — сжатие, журнал, изображения
   */
  static async render(box, reply, part) {
    if (!box) return;
    const section = part || box.dataset.part || 'copies';
    box.dataset.part = section;
    let maint = reply;
    try {
      maint = maint || (await AdminApi.get('maint'));
    } catch (error) {
      box.innerHTML = `<p class="sub">Обслуживание базы</p><p class="muted">Недоступно: ${esc(error.message)}</p>`;
      return;
    }
    box.innerHTML = section === 'copies' ? this._copies(maint) : this._service(maint);
    box.onclick = event => this._click(box, event, section);
    const years = box.querySelector('#mAudY');
    if (years) years.onchange = () => this._years(box, maint, section, years);
  }

  static _copies(maint) {
    const others = maint.others || {};
    const packed = maint.compressed;
    return `<div class="sub st-mh">Автоматические копии ${tip('<p>Каждый день при первом запуске (и раз в сутки, пока работает сервер отдела) программа делает копию базы, проверяет её встроенной проверкой SQLite и сжимает в архив ZIP (в 15–20 раз меньше файла базы; файл kp.sqlite3 — внутри). Восстановить — «Загрузить → Файл базы целиком»: он принимает и архив. Хранятся копии за 7 последних дней, по одной на 4 последние недели и на 12 последних месяцев.</p>')}</div>
      <table class="pv-t bk-kv">
        <tr><td>Последняя копия</td><td>${this.last(maint.backup || {})}</td></tr>
        <tr><td>Копий в папке</td><td>${maint.copies}${maint.copies ? ` · ${Fmt.size(maint.copiesBytes)} · с ${esc(KPGen.ruDate(maint.oldest))}` : ''}<br><small class="muted">${esc(maint.dir)}</small></td></tr>
        <tr><td>Копии перед изменениями</td><td>${others.count ? `${others.count} · ${Fmt.size(others.bytes)}` : 'нет'} <small class="muted">— перед обновлением программы, загрузкой базы, сборкой каталога</small>${packed ? `<br><small class="ok-t">прежние копии без сжатия перепакованы в ZIP: ${packed.files} · освобождено ${Fmt.size(packed.saved)}</small>` : ''}</td></tr>
      </table>
      <div class="row bk-btns"><button class="btn primary" type="button" data-mt="backup">Создать копию сейчас</button><span class="muted">Восстановить — «Загрузить → Файл базы целиком»: он принимает и архив копии.</span></div>`;
  }

  static _yearWord(years) {
    if (years === 1) return 'год';
    return years < this.FEW_YEARS ? 'года' : 'лет';
  }

  static _service(maint) {
    const vacuum = maint.vacuum;
    const images = maint.images;
    const audit = maint.audit;
    const check =
      vacuum &&
      (vacuum.check === 'ok'
        ? '<span class="ok-t">без ошибок</span>'
        : `<span class="bad-t">${esc(vacuum.check)}</span>`);
    const years = this.YEARS.map(
      year =>
        `<option value="${year}"${year === maint.auditYears ? ' selected' : ''}>${year} ${this._yearWord(year)}</option>`,
    ).join('');
    return `<div class="sub st-mh">Обслуживание базы ${tip('<p>Раз в месяц база сама сжимается и проверяется встроенной проверкой SQLite. Журнал действий старше заданного срока переносится в архив (папка backup/audit-archive рядом с базой).</p><p>«Изображения без ссылок» — файлы в папке img, на которые не ссылается ни каталог, ни КП, ни история и корзина.</p>')}</div>
      <table class="pv-t bk-kv">
        <tr><td>Сжатие и проверка</td><td>${vacuum ? `${esc(Fmt.dateTime(vacuum.at))} · ${Fmt.size(vacuum.before)} → ${Fmt.size(vacuum.after)} · ${check}` : 'ещё не выполнялись'}</td></tr>
        <tr><td>Журнал действий</td><td>${Fmt.num(maint.auditRows)} записей${maint.auditOldest ? ` с ${esc(KPGen.ruDate(maint.auditOldest))}` : ''} · хранить <select id="mAudY" class="st-inl" aria-label="Срок хранения журнала">${years}</select>${audit && audit.archived ? ` · в архиве ${Fmt.num(audit.archived)}` : ''}</td></tr>
        <tr><td>Изображения без ссылок</td><td id="mImg">${images ? `удалено ${images.deleted} (${Fmt.size(images.bytes)}) — ${esc(Fmt.dateTime(images.at))} · ` : ''}<button class="btn ghost" type="button" data-mt="imgscan">Найти</button></td></tr>
      </table>
      <div class="row bk-btns"><button class="btn" type="button" data-mt="run">Сжать и проверить базу</button><span class="muted">Занимает от секунд до минуты; работать в это время можно.</span></div>`;
  }

  static _busy(button, text) {
    if (!button) return;
    button.disabled = true;
    button.textContent = text;
  }

  static async _click(box, event, section) {
    const button = event.target.closest('[data-mt]');
    if (!button) return;
    const method = this.ACTIONS[button.dataset.mt];
    if (!method) return;
    try {
      await this[method](box, button, section);
    } catch (error) {
      toast(`Не выполнено: ${error.message || error}`);
      this.render(box, null, section);
    }
  }

  static async _backup(box, button, section) {
    this._busy(button, 'Копирую…');
    const reply = await AdminApi.post('maint/backup');
    toast(reply.backup && reply.backup.ok ? 'Копия создана и проверена' : 'Копия не создана');
    return this.render(box, reply, section);
  }

  static async _run(box, button, section) {
    this._busy(button, 'Сжимаю…');
    const reply = await AdminApi.post('maint/run');
    toast('База сжата и проверена');
    return this.render(box, reply, section);
  }

  static async _scan(box, button) {
    this._busy(button, 'Ищу…');
    const found = await AdminApi.get('maint/images');
    const more = found.count > found.sample.length ? '<br>…' : '';
    box.querySelector('#mImg').innerHTML = found.count
      ? `${found.count} файлов · ${Fmt.size(found.bytes)} <button class="btn ghost" type="button" data-mt="imgdel" data-n="${found.count}">Удалить</button>${tip(`<p>Файлы в папке img, на которые нет ссылок ни в каталоге, ни в КП, ни в истории версий и корзине (и которым больше месяца), а также всё из папки img/unused.</p><p>${found.sample.map(esc).join('<br>')}${more}</p>`)}`
      : 'лишних нет';
  }

  static async _purge(box, button, section) {
    if (
      !confirm(
        `Удалить ${button.dataset.n} изображений без ссылок? Восстановить их можно только из резервной копии папки img.`,
      )
    )
      return undefined;
    this._busy(button, 'Удаляю…');
    const reply = await AdminApi.post('maint/images');
    toast(`Удалено: ${reply.deleted} (${Fmt.size(reply.bytes)})`);
    return this.render(box, null, section);
  }

  static async _years(box, maint, section, select) {
    const years = +select.value;
    const text = `Записи журнала действий старше ${select.selectedOptions[0].textContent} будут перенесены в архив (папка backup/audit-archive) и пропадут из поиска в «Журнале действий». Продолжить?`;
    if (years < maint.auditYears && !confirm(text)) {
      select.value = maint.auditYears;
      return;
    }
    try {
      const reply = await AdminApi.post('maint/audit', { years });
      toast(reply.archivedNow ? `В архив перенесено записей: ${reply.archivedNow}` : 'Срок хранения журнала сохранён');
      this.render(box, reply, section);
    } catch (error) {
      toast(`Не сохранено: ${error.message}`);
    }
  }
}

/** Миграции базы — в «Обслуживании» (обычно не нужны): откатить последнюю. */
export class MigrationsCard {
  /**
   * Блок миграций.
   * @param {HTMLElement} box
   */
  static async render(box) {
    if (!box) return;
    let migrations;
    try {
      migrations = await AdminApi.get('migrations');
    } catch {
      box.innerHTML = '';
      return;
    }
    const rows =
      migrations.applied
        .map(
          id => `<div class="st-row"><div><b>${esc(id)}</b><span class="muted">применена</span></div>
      <div class="acts">${id === migrations.last ? `<button class="btn danger" type="button" data-mdown="${esc(id)}">Откатить</button>` : ''}</div></div>`,
        )
        .join('') || '<p class="muted">Нет применённых миграций.</p>';
    box.innerHTML = `<details class="more"><summary>Миграции базы (для обслуживания)</summary>${rows}
      <p class="muted">Откатить можно только последнюю миграцию: её таблицы и столбцы удаляются вместе с данными (перед этим — копия базы в data\\backup). При следующем запуске программы миграция применится снова.</p></details>`;
    box.onclick = event => this._down(box, event);
  }

  static async _down(box, event) {
    const button = event.target.closest('[data-mdown]');
    if (!button) return;
    if (
      !(await AdminDialog.confirm(
        'Откатить миграцию?',
        'Таблицы и столбцы этой миграции будут удалены вместе с данными. Перед этим сохраняется копия базы.',
        'Откатить',
      ))
    )
      return;
    await AdminApi.post(`migrations/${button.dataset.mdown}/down`);
    toast('Миграция откачена');
    this.render(box);
  }
}
