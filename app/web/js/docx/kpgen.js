/* Общие помощники для КП: деньги, сумма прописью, даты, итоги — и загрузка скелета шаблона.
   Раскладка документа (какие блоки на каких страницах) — в папке шаблона: templates/<шаблон>/skeleton.js.
   Чистые функции, без DOM — используются и в браузере, и в тестах. */
(function (root) {
  'use strict';
  const NB = ' ';
  function money(kop) {
    const neg = kop < 0; kop = Math.abs(Math.round(kop));
    const rub = Math.floor(kop / 100), k = kop % 100;
    const s = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
    return (neg ? '−' : '') + s + ',' + String(k).padStart(2, '0');
  }
  const U = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const UF = ['', 'одна', 'две'].concat(U.slice(3));
  const T = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const D = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const H = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  function g3(n, fem) {
    const w = [H[Math.floor(n / 100)]], t = n % 100;
    if (t >= 10 && t < 20) w.push(T[t - 10]); else w.push(D[Math.floor(t / 10)], (fem ? UF : U)[t % 10]);
    return w.filter(Boolean).join(' ');
  }
  function plural(n, f1, f2, f5) {
    const t = n % 100; if (t > 10 && t < 20) return f5;
    const u = n % 10; return u === 1 ? f1 : (u >= 2 && u <= 4 ? f2 : f5);
  }
  const CURS = {
    RUB: { sh: 'руб.', main: ['рубль', 'рубля', 'рублей'], sub: ['копейка', 'копейки', 'копеек'], name: 'рублях' },
    USD: { sh: 'USD', main: ['доллар США', 'доллара США', 'долларов США'], sub: ['цент', 'цента', 'центов'], name: 'долларах США' },
    EUR: { sh: 'EUR', main: ['евро', 'евро', 'евро'], sub: ['евроцент', 'евроцента', 'евроцентов'], name: 'евро' },
    CNY: { sh: 'CNY', main: ['юань', 'юаня', 'юаней'], sub: ['фэнь', 'фэня', 'фэней'], name: 'китайских юанях' }
  };
  function words(kop, code) {
    const C = CURS[code] || CURS.RUB;
    const rub = Math.floor(kop / 100), k = kop % 100;
    const tail = `${String(k).padStart(2, '0')} ${plural(k, ...C.sub)}`;
    if (rub === 0) return `ноль ${C.main[2]} ${tail}`;
    const groups = [[1e9, ['миллиард', 'миллиарда', 'миллиардов'], false], [1e6, ['миллион', 'миллиона', 'миллионов'], false], [1e3, ['тысяча', 'тысячи', 'тысяч'], true]];
    let n = rub; const out = [];
    for (const [base, f, fem] of groups) {
      const g = Math.floor(n / base) % 1000;
      if (g) out.push(g3(g, fem) + ' ' + plural(g, ...f));
    }
    const u = n % 1000; if (u) out.push(g3(u, false));
    return `${out.join(' ')} ${plural(rub, ...C.main)} ${tail}`;
  }
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function ruDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return iso || '';
    return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]} г.`;
  }
  function totals(items, vatRate) {
    let sum = 0, units = 0;
    for (const it of items) {
      const q = +it.qty || 0; sum += q * (it.price || 0); units += q;
      for (const o of (it.options || [])) sum += (+o.qty || 0) * (o.price || 0);
    }
    const vat = Math.round(sum * vatRate / (100 + vatRate));
    return { sum, units, vat, net: sum - vat };
  }
  // подстановка {метка} в текст шаблона
  const fill = (s, vars) => String(s == null ? '' : s).replace(/\{([^{}]+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
  // настройки шаблона поверх настроек по умолчанию: объекты сливаются, списки и значения заменяются
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function deepMerge(base, over) {
    if (!isObj(base) || !isObj(over)) return over === undefined ? clone(base) : clone(over);
    const out = clone(base);
    for (const k of Object.keys(over)) out[k] = isObj(out[k]) && isObj(over[k]) ? deepMerge(out[k], over[k]) : clone(over[k]);
    return out;
  }
  const clone = v => v === undefined ? v : JSON.parse(JSON.stringify(v));

  const LIB = { money, words, totals, ruDate, plural, CURS, fill, deepMerge };

  // скелет шаблона (skeleton.js из папки шаблона): текст → { defaults, build }
  function loadSkeleton(code) {
    let sk;
    try { sk = new Function('KP', String(code) + '\n;return typeof kpSkeleton === "function" ? kpSkeleton(KP) : null;')(LIB); }
    catch (e) { throw new Error('ошибка в skeleton.js: ' + (e && e.message || e)); }
    if (!sk || typeof sk.build !== 'function') throw new Error('в skeleton.js нет функции kpSkeleton(KP), возвращающей { defaults, build }');
    return sk;
  }

  root.KPGen = Object.assign({ loadSkeleton }, LIB);
})(typeof window !== 'undefined' ? window : globalThis);
