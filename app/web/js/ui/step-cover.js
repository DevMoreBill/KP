import { esc } from '../core/util.js';
import { Templates } from '../features/doc/templates.js';
import { KpModels } from '../features/doc/kp-models.js';
import { S } from '../core/state.js';
import { UiKit } from '../core/ui-kit.js';

/** Раздел 4 «Оформление КП»: шаблон документа, заголовок, модель, описание и ключевые параметры (первая страница КП). */
export class CoverStep {
  static KPI_HINTS = [
    { num: '32', unit: 'кВт', cap: 'номинальная мощность' },
    { num: '40', unit: 'кВт', cap: 'максимальная' },
    { num: '230/400', unit: 'В', cap: 'три фазы, 50 Гц' },
    { num: '9,3', unit: 'л/ч', cap: 'расход топлива' },
  ];
  static MULTI = 2;

  /**
   * HTML раздела.
   * @returns {string}
   */
  static html() {
    const cover = S.cover;
    const models = KpModels.list().length;
    const multi = models >= this.MULTI;
    const source = S.items.find(item => item.hint);
    const withPhoto = S.items.filter(item => item.photo);
    const current = S.items.find(item => item.id === S.cover.photoFrom && item.photo) || withPhoto[0];
    const index = this._photoIndex(current);
    const field = (label, path, opts) => UiKit.field(label, path, opts);
    return `<section class="step" id="st-cover"><h2><span class="n">4</span>Оформление КП${UiKit.tip(this._help(multi, models))}</h2>
  ${Templates.picker()}
  <div class="cvtop"><div class="cvthumb" id="cvThumb" data-a="kpPreview" title="Предпросмотр всего КП"></div><div class="cvinfo">
    ${field('Тип оборудования', 'cover.title', { ph: 'Дизель-генераторные установки' })}${field('Модель / серия', 'cover.model', { req: !multi, ph: 'HERTZ HG 45 CH' })}
    ${field('Описание под заголовком', 'cover.desc', { area: 1, rows: 3, ph: 'Установки в кожухе номинальной мощностью …' })}
    ${multi ? '' : this._photo(withPhoto, current)}
    ${cover.touched && source !== undefined ? `<p class="cv-touched muted">Заголовок изменён вручную — при смене оборудования не обновляется. <button class="lnk" type="button" data-a="coverFrom">↺ Заполнить по оборудованию</button></p>` : ''}
    <div class="row">${index >= 0 && !multi ? `<button class="btn ghost" type="button" data-a="edit" data-i="${index}" data-tab="desc">${current ? 'Заменить фото' : 'Добавить фото'}</button>` : ''}<button class="btn" type="button" data-a="kpPreview">Предпросмотр КП</button></div></div></div>
  ${multi ? '' : this._kpis(cover)}
  <div class="cv-opts"><button class="sw" type="button" role="switch" aria-checked="${esc(S.showClients)}" data-a="clients"><i></i>Страница «Наши клиенты» в КП</button></div>
  </section>`;
  }

  static _photoIndex(current) {
    if (current) return S.items.indexOf(current);
    return S.items.length ? 0 : -1;
  }

  static _help(multi, models) {
    if (!multi) {
      return `<p>Поля заполняются из каталога при выборе оборудования — проверьте и поправьте при необходимости.</p><p>Щелчок по превью — предпросмотр всего КП.</p>`;
    }
    return `<p>В КП ${models} ${KPGen.plural(models, 'модель', 'модели', 'моделей')}: на титуле будет блок «Оборудование в предложении» с фото, мощностью, исполнением и количеством каждой модели (если моделей много — сводка по видам оборудования). Заголовок и описание подставятся сами; заполните поля, чтобы задать свои. Ключевые параметры в этом режиме не выводятся.</p><p>Фото модели — первое фото позиции; поменять — в карточке позиции.</p>`;
  }

  static _photo(withPhoto, current) {
    if (withPhoto.length > 1) {
      const options = withPhoto
        .map(
          item =>
            `<option value="${esc(item.id)}"${item === current ? ' selected' : ''}>${esc(item.name || 'Позиция')}</option>`,
        )
        .join('');
      return `<label class="f"><span>Фото на титуле</span><select data-cvphoto>${options}</select></label>`;
    }
    return withPhoto.length
      ? ''
      : `<p class="muted" style="margin:0">У позиций нет фото — титул будет без фотографии.</p>`;
  }

  static _kpis(cover) {
    const rows = cover.kpis
      .map((_, j) => {
        const hint = this.KPI_HINTS[j] || {};
        return `<div class="kprow"><span class="item-no">${j + 1}</span>${UiKit.field('Значение', `cover.kpis.${j}.num`, { ph: hint.num })}${UiKit.field('Ед.', `cover.kpis.${j}.unit`, { ph: hint.unit })}${UiKit.field('Подпись', `cover.kpis.${j}.cap`, { ph: hint.cap })}</div>`;
      })
      .join('');
    return `<details class="more"${cover.kpis.some(kpi => kpi.num) ? '' : ' open'}><summary>Ключевые параметры на титуле <span class="muted">${cover.kpis.filter(kpi => kpi.num).length} из 4</span></summary>
    <div class="kpgrid">${rows}</div>
    </details>`;
  }
}
