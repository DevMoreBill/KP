// Значения по умолчанию программы. Администратор включает / выключает каждое и задаёт своё значение
// («Настройки → Умолчания»; сервер: app/defaults.py, kv settings.defaults = {ключ: {on, v}}).
// DEF(ключ) — действующее значение: выключено — null (поле остаётся пустым, решает менеджер), не задано — встроенное.
// Последние значения с сервера хранятся в браузере, чтобы новое КП сразу получило их и до ответа сервера.
'use strict';

let DEFS_SRV = {};
try{ DEFS_SRV = JSON.parse(localStorage.getItem('kp.defaults')||'{}')||{}; }catch(e){ DEFS_SRV = {}; }

// [ключ, группа, подпись, тип, встроенное значение, доп.: {opts — [[значение, подпись]] или функция, unit, hint, req — всегда включено, off — выключено, если не задано}]
// тип: text, num, select, bool (у bool значение — сам переключатель)
const DEF_GROUPS = [['kp','Новое КП'],['cond','Условия КП'],['mgr','Контакты компании (новый менеджер)'],['deal','Экономика сделки'],['st','Станции в контейнере'],['img','Фото со страницы товара'],['ai','Автозаполнение']];
const DEF_SCHEMA = [
  ['kp.city', 'kp', 'Город в КП', 'text', 'Москва'],
  ['kp.vat', 'kp', 'НДС в ценах КП', 'num', '22', {unit:'%', req:true, hint:'С 2026 года основная ставка — 22 %.'}],
  ['kp.cur', 'kp', 'Валюта КП', 'select', 'RUB', {req:true, opts:[['RUB','Рубли'],['USD','Доллары США'],['EUR','Евро'],['CNY','Юани']]}],
  ['kp.round', 'kp', 'Округление цен из экономики сделки', 'select', '1', {req:true, opts:[['0.01','до копеек'],['1','до рубля'],['100','до 100'],['1000','до 1 000']]}],
  ...['Срок поставки','Условия оплаты','Гарантия','Доставка','Срок действия предложения','Монтаж, ШМР и ПНР'].map(l=>['cond.'+l, 'cond', l, 'text', '', {off:true, list:()=>typeof COND!=='undefined'?((COND.find(c=>c[0]===l)||[])[1]||[]):[]}]),
  ['mgr.phone', 'mgr', 'Телефон компании', 'text', '+7 (495) 690-91-96'],
  ['mgr.site', 'mgr', 'Сайт', 'text', 'www.kompr.ru'],
  ['mgr.address', 'mgr', 'Адрес офиса', 'text', 'Москва, ул. Малая Пироговская, д. 18с1'],
  ['mgr.hours', 'mgr', 'Режим работы', 'text', 'Пн–Пт, 9:00–18:00'],
  ['deal.country', 'deal', 'Где покупаем — страна поставщика', 'text', 'Россия', {hint:'Россия — без таможни, НДС поставщика к вычету. Выключено — менеджер выбирает сам («В России» / «Ввозим сами»).'}],
  ['deal.startToday', 'deal', 'Дата договора — сегодня (с напоминанием «уточните»)', 'bool', true],
  ['deal.prod', 'deal', 'Срок изготовления у поставщика', 'num', '40', {unit:'дн.'}],
  ['deal.ship', 'deal', 'Срок доставки до заказчика', 'num', '40', {unit:'дн.'}],
  ['deal.supPay', 'deal', 'Оплата поставщику', 'select', 'a20', {opts:()=>typeof DL_SP_PRESETS!=='undefined'?Object.entries(DL_SP_PRESETS).map(([k,[t]])=>[k,t]):[]}],
  ['deal.custPay', 'deal', 'Оплата заказчика', 'select', 'post', {opts:()=>typeof DL_TR_PRESETS!=='undefined'?Object.entries(DL_TR_PRESETS).map(([k,[t]])=>[k,t]):[]}],
  ['deal.spread', 'deal', 'Стоимость денег: ключевая ставка ЦБ плюс', 'num', '3', {unit:'п.п. годовых', req:true}],
  ['deal.tax', 'deal', 'Налог на прибыль', 'num', '25', {unit:'%', req:true}],
  ['deal.bgRate', 'deal', 'Ставка банковской гарантии', 'num', '3', {unit:'% годовых', req:true}],
  ['deal.ivat', 'deal', 'НДС при ввозе', 'select', '22', {req:true, opts:[['22','22 %'],['10','10 %'],['0','0 %']]}],
  ['deal.target', 'deal', 'Нужная маржинальность для подбора цены', 'num', '20', {unit:'%', off:true, hint:'Включено — в «Цене продажи» сразу считается цена КП под эту маржинальность.'}],
  ['st.ins', 'st', 'Утепление контейнера', 'select', '100 мм', {opts:()=>typeof CONTAINER_INS!=='undefined'?CONTAINER_INS.map(v=>[v,v]):[]}],
  ['st.climate', 'st', 'Климатическое исполнение', 'select', 'УХЛ1', {opts:()=>typeof CLIMATES!=='undefined'?CLIMATES.map(c=>[c[0], c[0]+' — '+c[1]]):[]}],
  ['img.mainOnly', 'img', 'Отмечать только главное фото (остальные — по выбору)', 'bool', true],
  ['img.minKB', 'img', 'Не показывать фото меньше', 'num', '15', {unit:'КБ', hint:'Мелкие файлы — иконки, заглушки, пустые картинки.'}],
  ['img.minPx', 'img', 'Не показывать фото с меньшей стороной меньше', 'num', '200', {unit:'px'}],
  ['img.skipBlank', 'img', 'Пропускать пустые (белые, однотонные) картинки', 'bool', true],
  ['img.maxCount', 'img', 'Сколько фото показывать', 'num', '12', {req:true, unit:'шт.'}],
  ['ai.keep', 'ai', '«Не менять уже заполненное» — включено', 'bool', false, {hint:'Галочка в шаге «Проверьте и заполните»: ИИ дописывает только пустые поля.'}],
];
const DEF_GROUP_HINTS = { cond:'Текст условия в новом КП. Срок поставки, условия оплаты и монтаж подставляются и из «Экономики сделки», пока поле не правили вручную.',
  mgr:'Подставляются в контакты нового менеджера (раздел «Менеджер»).', img:'Для «Загрузить со страницы» в автозаполнении и кнопки «Фото с сайта поставщика».' };
const DEF_BY = Object.fromEntries(DEF_SCHEMA.map(x=>[x[0], x]));

// значение по умолчанию: выключено — null; bool — true/false
function DEF(key){
  const sc=DEF_BY[key]; if (!sc) return null;
  const [, , , type, builtin, o={}]=sc, x=DEFS_SRV[key];
  const on = x && typeof x==='object' && 'on' in x ? !!x.on || !!o.req : !o.off;
  if (type==='bool') return x && 'on' in x ? !!x.on : !!builtin;
  if (!on) return null;
  const v = x && x.v!=null && String(x.v).trim()!=='' ? x.v : builtin;
  return v==null ? null : String(v);
}
// число по умолчанию (или запасное, если выключено / не число)
function DEFN(key, fb){ const v=DEF(key); const n=v==null?NaN:parseFloat(String(v).replace(',','.')); return Number.isFinite(n) ? n : fb; }

async function defaultsLoad(){
  try{ const r=await api('/api/defaults'); DEFS_SRV=r&&typeof r==='object'?r:{}; try{ localStorage.setItem('kp.defaults', JSON.stringify(DEFS_SRV)); }catch(_){} }catch(e){}
}
