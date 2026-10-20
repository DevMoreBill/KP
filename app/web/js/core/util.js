// Основа, нужная обычным скриптам ещё при загрузке страницы (до ES-модулей): новое КП (core/state.js) берёт номер позиции и
// сегодняшнюю дату, обработчики ui/events.js ищут кнопки шапки. Остальные помощники — ES-модули core/ (мост — core/legacy.js).
'use strict';

// eslint-disable-next-line id-length -- короткое имя поиска элемента, им пользуются все разделы
const $ = (selector, root = document) => root.querySelector(selector);

const esc = text =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const uid = () => Math.random().toString(36).slice(2, 9);

// по местному времени: toISOString дал бы дату по Гринвичу — ночью это вчерашний день
const isoDay = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const today = () => isoDay(new Date());
