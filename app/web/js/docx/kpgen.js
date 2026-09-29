/* Генератор ТКП ПНЕВМОТЕХ: собирает document.xml, footer1.xml и связи.
   Чистые функции, без DOM — используются и в браузере, и в тестах. */
(function (root) {
  'use strict';
  let BLUE = '0B45A0', SKY = '3DA0EE', NAVYD = '143A7F', DARK = '1F2B4D', GRAY = '66718C',
      LIGHT = 'EAF4FD', LINE = 'CFE0F2', HAIR = 'D9E6F3';
  const W = 10347, E = 635, NB = '\u00A0';
  // Шаблон КП: цвета, тексты «О компании», подвал, раздел клиентов, основа DOCX (шапка, поля страницы).
  const TPL_DEFAULT = {
    brandParts: [['ПНЕВМО', 'BLUE'], ['ТЕХ', 'SKY']], site: 'www.kompr.ru',
    about: ' — интегратор комплексных решений для промышленности. С 1995 года поставляем и обслуживаем компрессорное, генераторное и насосное оборудование — для малых предприятий, ЖКХ и крупных промышленных компаний.',
    advantages: [['Сроки', 'Поставляем оборудование сами и отвечаем за соблюдение согласованных сроков.'], ['Качество', 'Всё оборудование сопровождается необходимыми сертификатами.'], ['Сервис', 'Собственная сервисная служба и поставка запчастей после покупки.']],
    trust: 'Газпром трансгаз Санкт-Петербург, Сбербанк, РЖД, аэропорт Шереметьево, РУСАЛ, АЛРОСА, Мосводоканал, Мосметрострой',
    clientsTitle: 'Наши клиенты', closing: ''
  };
  let TPL = TPL_DEFAULT;
  function setTemplate(t) {
    TPL = Object.assign({}, TPL_DEFAULT, t || {});
    const c = TPL.colors || {};
    BLUE = c.BLUE || '0B45A0'; SKY = c.SKY || '3DA0EE'; NAVYD = c.NAVYD || '143A7F'; DARK = c.DARK || '1F2B4D';
    GRAY = c.GRAY || '66718C'; LIGHT = c.LIGHT || 'EAF4FD'; LINE = c.LINE || 'CFE0F2'; HAIR = c.HAIR || 'D9E6F3';
  }
  const COL = k => ({ BLUE, SKY, NAVYD, DARK, GRAY })[k] || k;
  const brandRuns = (sz) => (TPL.brandParts || []).map(([t, c]) => r(t, { sz, color: COL(c), b: true })).join('');

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function r(t, o = {}) {
    const sz = o.sz || 20, color = o.color || DARK;
    let rp = '<w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.i) rp += '<w:i/><w:iCs/>';
    if (o.caps) rp += '<w:caps/>';
    rp += `<w:color w:val="${color}"/>`;
    if (o.sp) rp += `<w:spacing w:val="${o.sp}"/>`;
    rp += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="ru-RU"/>`;
    return `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }
  function p(runs = '', o = {}) {
    let pp = '';
    if (o.keep) pp += '<w:keepNext/>';
    if (o.pbb) pp += '<w:pageBreakBefore/>';
    if (o.bdr) pp += `<w:pBdr>${o.bdr}</w:pBdr>`;
    const ls = o.line ? ` w:line="${o.line}" w:lineRule="auto"` : '';
    pp += `<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"${ls}/>`;
    if (o.indL || o.indR) pp += `<w:ind w:left="${o.indL || 0}" w:right="${o.indR || 0}"/>`;
    pp += `<w:jc w:val="${o.jc || 'left'}"/>`;
    return `<w:p><w:pPr>${pp}</w:pPr>${runs}</w:p>`;
  }
  const spacer = h => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;
  const END = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  const line = (side, sz, color) => `<w:${side} w:val="single" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
  function B(top, left, bottom, right) {
    const one = (s, v) => v ? line(s, v[0], v[1]) : `<w:${s} w:val="nil"/>`;
    return one('top', top) + one('left', left) + one('bottom', bottom) + one('right', right);
  }
  function tc(content, w, o = {}) {
    const [t, l, b, rr] = o.mar || [70, 120, 70, 120];
    let pr = `<w:tcW w:w="${w}" w:type="dxa"/>`;
    if (o.span > 1) pr += `<w:gridSpan w:val="${o.span}"/>`;
    pr += `<w:tcBorders>${o.bdr || B()}</w:tcBorders>`;
    if (o.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
    pr += `<w:tcMar><w:top w:w="${t}" w:type="dxa"/><w:left w:w="${l}" w:type="dxa"/><w:bottom w:w="${b}" w:type="dxa"/><w:right w:w="${rr}" w:type="dxa"/></w:tcMar>`;
    pr += `<w:vAlign w:val="${o.va || 'center'}"/>`;
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
  }
  function tbl(rows, widths, o = {}) {
    const grid = widths.map(x => `<w:gridCol w:w="${x}"/>`).join('');
    const pr = `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
      '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/>';
    const hs = o.heights || {};
    const body = rows.map((row, i) => {
      let trp = '';
      if (hs[i]) trp += `<w:trHeight w:val="${hs[i]}" w:hRule="exact"/>`;
      if (o.split !== true) trp += '<w:cantSplit/>';
      if (o.header && i === 0) trp += '<w:tblHeader/>';
      return `<w:tr><w:trPr>${trp}</w:trPr>${row.join('')}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr>${pr}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
  }
  let PID = 9000;
  function img(rid, cx, cy, name) {
    const id = ++PID;
    return '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${esc(name)}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  // скруглённая подложка за таблицей
  function rbg(wd, hd, color, rad, yoff, xoff) {
    const id = ++PID, w = wd * E, h = hd * E;
    const adj = Math.floor(Math.min(50000, rad / Math.min(wd, hd) * 100000));
    const arc = (2 * adj / 100000).toFixed(4);
    const dml = `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>' + ((xoff || 0) * E) + '</wp:posOffset></wp:positionH>' +
      `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${yoff * E}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
      `<wp:docPr id="${id}" name="Подложка ${id}"/><wp:cNvGraphicFramePr/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
      `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor>`;
    const vml = `<w:pict><v:roundrect id="bg${id}" o:spid="_x0000_s${id}" arcsize="${arc}" style="position:absolute;margin-left:${(xoff || 0) / 20}pt;margin-top:${yoff / 20}pt;width:${wd / 20}pt;height:${hd / 20}pt;z-index:-${id};mso-position-horizontal-relative:text;mso-position-vertical-relative:text" fillcolor="#${color}" stroked="f"/></w:pict>`;
    return '<w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' + dml +
      '</w:drawing></mc:Choice><mc:Fallback>' + vml + '</mc:Fallback></mc:AlternateContent></w:r>';
  }
  const bgpara = (wd, hd, color, rad = 110, h = 20) =>
    `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${rbg(wd, hd, color, rad, h)}</w:p>`;
  const hyper = (rid, runs) => `<w:hyperlink r:id="${rid}">${runs}</w:hyperlink>`;

  function heading(title, pbb) {
    return p(r(title, { sz: 32, color: BLUE, b: true }), { after: 90, keep: true, line: 240, pbb }) +
      p('', { after: 220, indR: W - 1500, keep: true, bdr: line('bottom', 18, SKY) });
  }

  // ---------- числа ----------
  const curCode = S => (S && S.cur && S.cur.code) || 'RUB';
  const curSh = S => (CURS[curCode(S)] || CURS.RUB).sh;
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

  // ---------- страницы ----------
  function coverXml(S, M) {
    const out = [], t = totals(S.items, S.vat);
    const tight = (S.stations || []).filter(x => x && x.model).length > 3;
    const meta = (label, val, sub, w, first, jc) => {
      const bd = line('top', 4, LINE) + (first ? '<w:left w:val="nil"/>' : line('left', 4, LINE)) + line('bottom', 4, LINE) + '<w:right w:val="nil"/>';
      return tc(p(r(label, { sz: 14, color: BLUE, b: true, caps: true, sp: 20 }), { after: 50, jc }) + p(val, { after: 30, line: 240, jc }) + p(sub, { line: 240, jc }),
        w, { bdr: bd, va: 'top', mar: [170, first ? 0 : 240, 170, 0] });
    };
    const ct = S.contact || {}, ob = S.object || {};
    const subParts = [S.clientInn ? 'ИНН ' + S.clientInn : '', ct.name ? 'Вниманию: ' + [ct.post, ct.name].filter(Boolean).join(' ') : ''].filter(Boolean);
    const sub = subParts.length ? subParts.map(x => r(x, { sz: 15, color: GRAY })).join('<w:r><w:br/></w:r>') : r(`Поставка оборудования: ${t.units} ед.`, { sz: 15, color: GRAY });
    const dateCell = (w) => meta('Дата', r(ruDate(S.date), { sz: 22, b: true }), r((S.number ? '№ ' + S.number + (S.city ? ' · ' + S.city : '') : (S.city || '')), { sz: 15, color: GRAY }), w, false, 'right');
    if (ob.purpose || ob.address) {
      // получатель · объект · дата
      out.push(tbl([[meta('Получатель', r(S.client, { sz: 22, color: BLUE, b: true }), sub, 4100, true, 'left'),
        meta('Объект', r(ob.purpose || ob.address, { sz: 18, b: true }), r(ob.purpose ? (ob.address || '') : '', { sz: 15, color: GRAY }), 3647, false, 'left'),
        dateCell(2600)]], [4100, 3647, 2600]));
    } else {
      out.push(tbl([[meta('Получатель', r(S.client, { sz: 24, color: BLUE, b: true }), sub, 6847, true, 'left'), dateCell(3500)]], [6847, 3500]));
    }
    out.push(spacer(tight ? 500 : 900));
    const c = S.cover;
    let left = p(r('Технико-коммерческое предложение', { sz: 16, color: BLUE, b: true, caps: true, sp: 30 }), { after: 160 });
    if (c.title) left += p(r(c.title, { sz: 30 }), { line: 240 });
    const multiHdr = (S.stations || []).filter(x => x && x.model).length >= 2;
    const hdrRuns = (txt, o) => {   // модели не разрываются посередине: неразрывные пробелы и дефисы
      const hy = r('-', o).replace(/<w:t xml:space="preserve">-<\/w:t>/, '<w:noBreakHyphen/>');
      return String(txt).split(' · ').map(m => m.split('-').map(part => r(part.replace(/ /g, NB), o)).join(hy)).join(r(' · ', o));
    };
    left += p(multiHdr ? hdrRuns(c.model || '', { sz: 36, color: BLUE, b: true }) : r(c.model || '', { sz: 52, color: BLUE, b: true }), { after: 120, line: 240 });
    left += p('', { after: 200, indR: 4700, bdr: line('bottom', 18, SKY) });
    if (c.desc) left += p(r(c.desc, { sz: 19, color: GRAY }), { line: 276 });
    const ST = (S.stations || []).filter(x => x && x.model);
    const multi = ST.length >= 2;
    if (multi) {
      out.push(left);
      out.push(spacer(tight ? 300 : 500));
      out.push(p(r('Оборудование в предложении', { sz: 15, color: BLUE, b: true, caps: true, sp: 20 }), { after: 120, keep: true }));
      const per = ST.length <= 4 ? ST.length : Math.ceil(ST.length / 2);
      const rowsN = Math.ceil(ST.length / per);
      const w = Math.floor(W / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? W - w * (per - 1) : w);
      const BOXW = Math.min(3.8 * 360000, (w - 300) * E), BOXH = (rowsN > 1 ? 2.0 : 2.6) * 360000;
      const rows = [];
      for (let rI = 0; rI < rowsN; rI++) {
        const cells = [];
        for (let cI = 0; cI < per; cI++) {
          const st = ST[rI * per + cI];
          const bd = cI === 0 ? B() : B(null, [4, LINE]);
          if (!st) { cells.push(tc('', ws[cI], { bdr: bd })); continue; }
          const th = M.thumbs && M.thumbs[st.key];
          let ph = '';
          if (th) { const k = Math.min(BOXW / th.w, BOXH / th.h); ph = p(img(th.rid, Math.round(th.w * k), Math.round(th.h * k), st.model), { jc: 'center', after: 100 }); }
          const body = ph + p(r(st.model, { sz: 20, color: BLUE, b: true }), { jc: 'center', after: 30, line: 240 }) +
            (st.power ? p(r(st.power, { sz: 16 }), { jc: 'center', after: 20, line: 240 }) : '') +
            p(r([st.exec, st.qty ? st.qty + NB + 'шт.' : ''].filter(Boolean).join(' · '), { sz: 15, color: GRAY }), { jc: 'center', line: 240 });
          cells.push(tc(body, ws[cI], { bdr: bd, va: 'top', mar: [60, 120, 60, 120] }));
        }
        rows.push(cells);
      }
      out.push(tbl(rows, ws));
    } else if (M.cover) {
      // фото вписывается в рамку 7 × 5 см (ширина × высота) с сохранением пропорций
      const BOXW = 7 * 360000, BOXH = 5 * 360000;
      const k = Math.min(BOXW / M.cover.w, BOXH / M.cover.h);
      const cxc = Math.round(M.cover.w * k), cyc = Math.round(M.cover.h * k);
      out.push(tbl([[tc(left, 6247, { va: 'center', mar: [0, 0, 0, 0] }), tc(p(img(M.cover.rid, cxc, cyc, 'Оборудование'), { jc: 'right' }), 4100, { va: 'center', mar: [0, 0, 0, 0] })]], [6247, 4100]));
    } else out.push(left);
    const kp = multi ? [] : (c.kpis || []).filter(k => k.num);
    if (kp.length) {
      out.push(spacer(900));
      out.push(p(r('Ключевые параметры', { sz: 15, color: BLUE, b: true, caps: true, sp: 20 }), { after: 120 }));
      const n = kp.length, w = Math.floor(W / n), ws = kp.map((_, i) => i === n - 1 ? W - w * (n - 1) : w);
      out.push(tbl([kp.map((k, i) => {
        const bd = i === 0 ? B() : B(null, [4, LINE]);
        return tc(p(r(k.num, { sz: 40, color: BLUE, b: true }) + (k.unit ? r(' ' + k.unit, { sz: 20, color: SKY, b: true }) : ''), { after: 40, line: 240 }) +
          p(r(k.cap || '', { sz: 15, color: GRAY }), { line: 240 }), ws[i], { bdr: bd, mar: [60, i === 0 ? 0 : 220, 60, 120] });
      })], ws));
    }
    out.push(spacer(tight ? 400 : 760));
    const one = S.items.length === 1;
    const comp = one ? `${S.items[0].qty} × ${c.model || S.items[0].name}` : multi ? `${ST.length} ${plural(ST.length, 'модель', 'модели', 'моделей')}, ${t.units} ед.` : `${S.items.length} ${plural(S.items.length, 'позиция', 'позиции', 'позиций')}, ${t.units} ед.`;
    const optNames = [...new Set(S.items.flatMap(it => (it.options || []).filter(o => o.name && +o.qty > 0).map(o => o.short || o.name)))];
    const c1 = p(r('Состав поставки', { sz: 14, color: GRAY, caps: true, sp: 20 }), { after: 40 }) + p(r(comp, { sz: 24, b: true }), { after: optNames.length ? 40 : 0 }) +
      (optNames.length ? p(r('Включая: ' + optNames.slice(0, 5).join(', ') + (optNames.length > 5 ? ' и др.' : ''), { sz: 15, color: GRAY }), { line: 240 }) : '');
    const c2 = p(r(`Стоимость с НДС ${S.vat} %`, { sz: 14, color: GRAY, caps: true, sp: 20 }), { jc: 'right', after: 40 }) +
      p(r(money(t.sum), { sz: 32, color: BLUE, b: true }) + r(' ' + curSh(S), { sz: 22, color: BLUE, b: true }), { jc: 'right' });
    const bh = optNames.length ? 1500 : 1180;
    out.push(bgpara(W, bh, LIGHT, 160));
    out.push(tbl([[tc(c1, 5847, { mar: [0, 300, 0, 120] }), tc(c2, 4500, { mar: [0, 120, 0, 300] })]], [5847, 4500], { heights: { 0: bh } }));
    out.push(p(r('Детальный расчёт по позициям приведён в разделе «Коммерческое предложение».', { sz: 15, color: GRAY, i: true }), { before: 100 }));
    out.push(spacer(tight ? 500 : 900));
    out.push(p(r('О компании', { sz: 15, color: BLUE, b: true, caps: true, sp: 20 }), { after: 120 }));
    out.push(p(brandRuns(19) + r(TPL.about || '', { sz: 19 }), { after: 240, line: 276, jc: 'both' }));
    const adv = (ti, tx) => tc(p(r(ti, { sz: 19, b: true }), { after: 40 }) + p(r(tx, { sz: 16, color: GRAY }), { line: 250 }), Math.floor(W / Math.max(1, (TPL.advantages || []).slice(0, 3).length)),
      { bdr: B(null, [18, SKY]), va: 'top', mar: [20, 160, 20, 240] });
    const AD = (TPL.advantages || []).slice(0, 3);
    if (AD.length) { const aw = Math.floor(W / AD.length); out.push(tbl([AD.map(([t, x]) => adv(t, x))], AD.map((_, k) => k === AD.length - 1 ? W - aw * (AD.length - 1) : aw))); }
    if (TPL.trust) {
      out.push(spacer(600));
      out.push(p(r('Нам доверяют: ', { sz: 16, b: true }) + r(TPL.trust + (S.showClients && TPL.clients ? ' — полный список на следующей странице.' : '.'), { sz: 16, color: GRAY }), { line: 250 }));
    }
    return out.join('');
  }

  const LOGOS = '<w:p><w:pPr><w:ind w:left="-426"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="7108166" cy="7165700"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="13" name="Логотипы клиентов"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="13" name="Логотипы клиентов"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId8"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7108166" cy="7165700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';

  const HDR = (t, w, jc = 'left', span = 1) => tc(p(r(t, { sz: 14, color: 'FFFFFF', b: true, caps: true, sp: 15 }), { jc }), w, { mar: [0, 120, 0, 120], span });
  const cell = (t, w, o = {}) => tc(p(r(t, { sz: o.sz || 18, color: o.color || DARK, b: o.b }), { jc: o.jc || 'left' }), w,
    { bdr: o.last ? B() : B(null, null, [4, HAIR]), mar: o.mar || [36, 120, 36, 120] });

  function balance(groups) {
    const n = g => g.rows.length + 1, total = groups.reduce((a, g) => a + n(g), 0);
    let acc = 0, k = 0;
    for (; k < groups.length; k++) { if (acc + n(groups[k]) / 2 > total / 2 && k > 0) break; acc += n(groups[k]); }
    return [groups.slice(0, k), groups.slice(k)];
  }
  // подзаголовок группы характеристик (Двигатель, Альтернатор…): светлая плашка и синяя полоса слева
  function grpCell(name, w) {
    return tc(p(r(name, { sz: 16, color: BLUE, b: true, caps: true, sp: 20 })), w,
      { span: 2, fill: LIGHT, bdr: B(null, [36, BLUE], [6, SKY]), mar: [110, 140, 90, 140] });
  }
  // «не отрывать»: все абзацы строк таблицы держатся со следующими — Word переносит такой блок целиком
  const keepAll = xml => xml.replace(/<w:pPr>/g, '<w:pPr><w:keepNext/>').replace(/<w:p>(?!<w:pPr>)/g, '<w:p><w:pPr><w:keepNext/></w:pPr>');
  function specTable(groups, wl) {
    const rows = [[HDR('Параметр', wl[0]), HDR('Значение', wl[1])]];
    for (const g of groups) {
      if (g.name) rows.push([grpCell(g.name, wl[0] + wl[1])]);
      g.rows.forEach((row, i) => {
        const last = i === g.rows.length - 1;
        rows.push([cell(row.k, wl[0], { sz: 16, last }), cell(row.v, wl[1], { sz: 16, b: true, color: row.hl ? BLUE : DARK, last })]);
      });
    }
    return bgpara(wl[0] + wl[1], 380, NAVYD, 90) + tbl(rows, wl, { heights: { 0: 380 } });
  }

  // Дополнительные изображения: сетка карточек 2 в ряд, схемы и чертежи — на всю ширину.
  // Каждый ряд — отдельная неразрывная таблица: при нехватке места на странице переносится
  // ряд целиком (пустое место — не больше высоты одного ряда), заголовок держится с первым рядом.
  const PXCAP = 914400 / 150;   // EMU на пиксель при 150 dpi
  function galleryXml(list) {
    if (!list || !list.length) return '';
    const out = [spacer(list.length <= 2 ? 160 : 300), heading('Фото и схемы')];
    const HALF = 5073, GAP = 201, FULL = W;
    const card = (g, w, boxW, boxH) => {
      const k = Math.min(boxW / g.w, boxH / g.h, PXCAP);
      const body = p(img(g.rid, Math.round(g.w * k), Math.round(g.h * k), g.caption || 'Изображение'), { jc: 'center', after: g.caption ? 80 : 0 }) +
        (g.caption ? p(r(g.caption, { sz: 16, b: true }), { jc: 'center', line: 240 }) : '');
      return tc(body, w, { bdr: B([4, HAIR], [4, HAIR], [4, HAIR], [4, HAIR]), va: 'center', mar: [140, 120, 140, 120] });
    };
    const halfBox = [(HALF - 260) * E, list.length <= 2 ? 1450000 : 1850000], fullBox = [(FULL - 260) * E, 3600000];
    // раскладка: половинки парами по порядку; широкое изображение, попавшее между половинками, ставится после пары
    const rows = []; let pend = null; const deferred = [];
    for (const g of list) {
      if (g.wide) { if (pend) deferred.push(g); else rows.push([g]); continue; }
      if (pend) { rows.push([pend, g]); pend = null; while (deferred.length) rows.push([deferred.shift()]); }
      else pend = g;
    }
    if (pend) rows.push([pend]);
    while (deferred.length) rows.push([deferred.shift()]);
    rows.forEach((row, n) => {
      if (n) out.push(spacer(160));
      if (row.length === 2) out.push(tbl([[card(row[0], HALF, ...halfBox), tc(END, GAP, { mar: [0, 0, 0, 0] }), card(row[1], HALF, ...halfBox)]], [HALF, GAP, HALF]));
      else if (row[0].wide) out.push(tbl([[card(row[0], FULL, ...fullBox)]], [FULL]));
      else { // одиночная половинка — по центру, без пустой колонки рядом
        const side = Math.floor((FULL - HALF) / 2);
        out.push(tbl([[tc(END, side, { mar: [0, 0, 0, 0] }), card(row[0], HALF, ...halfBox), tc(END, FULL - HALF - side, { mar: [0, 0, 0, 0] })]], [side, HALF, FULL - HALF - side]));
      }
    });
    return out.join('');
  }
  function equipXml(it, M) {
    const out = [heading(it.pageTitle || it.name, true)];
    const m = M.items[it.id] || {};
    let desc = '';
    if (m.logo) { const cx = 1350000, cy = Math.round(cx * m.logo.h / m.logo.w); desc += p(img(m.logo.rid, cx, Math.min(cy, 700000), 'Логотип'), { after: 160 }); }
    const fimg = m.featImgs || {};
    const allF = (it.features || []).filter(f => f.label || f.text);
    const illustrated = allF.filter(f => f.id && fimg[f.id]);
    // длинные тексты (о серии, стандартная комплектация) — отдельным разделом на всю ширину, чтобы не перегружать верх страницы
    const longF = allF.filter(f => !(f.id && fimg[f.id]) && (f.text || '').length > 230);
    const feats = allF.filter(f => !(f.id && fimg[f.id]) && !longF.includes(f));
    feats.forEach((f, i) => {
      if (f.label) desc += p(r(f.label, { sz: 14, color: BLUE, b: true, caps: true, sp: 15 }), { after: 20 });
      desc += p(r(f.text || '', { sz: 17 }), { after: i === feats.length - 1 ? 0 : 120, line: 250 });
    });
    const opts = (it.options || []).filter(o => o.name && +o.qty > 0);
    if (opts.length) {
      desc += p(r('Дополнительная комплектация', { sz: 14, color: BLUE, b: true, caps: true, sp: 15 }), { before: desc ? 160 : 0, after: 40 });
      opts.forEach(o => { desc += p(r('+ ' + o.name, { sz: 17 }), { after: 20, line: 250 }); });
    }
    if (m.tile) {
      const cx = 3180000, cy = Math.round(cx * m.tile.h / m.tile.w);
      const photo = tc(p(img(m.tile.rid, cx, cy, it.name), { jc: 'center', after: it.photoCaption ? 80 : 0 }) +
        (it.photoCaption ? p(r(it.photoCaption, { sz: 13, color: GRAY, caps: true, sp: 15 }), { jc: 'center' }) : ''), 5047, { mar: [0, 0, 0, 0] });
      if (desc) out.push(tbl([[tc(desc, 5000, { mar: [0, 0, 0, 200] }), tc(END, 300, { mar: [0, 0, 0, 0] }), photo]], [5000, 300, 5047]));
      else out.push(p(img(m.tile.rid, cx, cy, it.name), { jc: 'center' }));
    } else if (desc) out.push(desc);
    // «Узлы и компоненты»: блок описания и его фото рядом; каждый блок — неразрывная строка,
    // фото чередуются слева/справа, при нехватке места блок целиком переносится на следующую страницу
    if (illustrated.length) {
      out.push(spacer(300));
      out.push(heading('Узлы и компоненты'));
      const IW = 3900, GAPW = 300, TW = W - IW - GAPW, boxW = (IW - 160) * E, boxH = 2000000;
      illustrated.forEach((f, n) => {
        const g = fimg[f.id]; const k = Math.min(boxW / g.w, boxH / g.h, PXCAP);
        const picCell = tc(p(img(g.rid, Math.round(g.w * k), Math.round(g.h * k), f.label || 'Узел'), { jc: 'center' }), IW,
          { bdr: B([4, HAIR], [4, HAIR], [4, HAIR], [4, HAIR]), va: 'center', mar: [100, 80, 100, 80] });
        const txtCell = tc((f.label ? p(r(f.label, { sz: 15, color: BLUE, b: true, caps: true, sp: 15 }), { after: 60 }) : '') +
          p(r(f.text || '', { sz: 18 }), { line: 264 }), TW, { va: 'center', mar: [60, 0, 60, 0] });
        const gapCell = tc(END, GAPW, { mar: [0, 0, 0, 0] });
        if (n) out.push(spacer(200));
        out.push(n % 2 === 0 ? tbl([[picCell, gapCell, txtCell]], [IW, GAPW, TW]) : tbl([[txtCell, gapCell, picCell]], [TW, GAPW, IW]));
      });
    }
    if (longF.length) {
      out.push(spacer(300));
      out.push(heading('Особенности и комплектация'));
      longF.forEach((f, n) => {
        if (f.label) out.push(p(r(f.label, { sz: 15, color: BLUE, b: true, caps: true, sp: 15 }), { before: n ? 160 : 0, after: 50, keep: true }));
        out.push(p(r(f.text || '', { sz: 18 }), { line: 264, jc: 'both' }));
      });
    }
    const groups = (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k || x.v) })).filter(g => g.rows.length);
    if (groups.length) {
      out.push(spacer(300));
      out.push(heading('Технические характеристики'));
      const nrows = groups.reduce((a, g) => a + g.rows.length + 1, 0);
      if (nrows > 14) {
        // две колонки в одной «плоской» таблице: каждая строка независима, поэтому длинная таблица
        // аккуратно переносится на следующую страницу, не оставляя пустых мест
        const [L, R] = balance(groups);
        const flat = gs => gs.flatMap(g => [{ g: g.name }].concat(g.rows.map((row, i) => ({ k: row.k, v: row.v, hl: row.hl, last: i === g.rows.length - 1 }))));
        const a = flat(L), b = flat(R), n = Math.max(a.length, b.length);
        const wk = 2873, wv = 2200, gap = 201;
        const half = (e) => {
          if (!e) return [tc(END, wk + wv, { span: 2, mar: [0, 0, 0, 0] })];
          if (e.g) return [grpCell(e.g, wk + wv)];
          return [cell(e.k, wk, { sz: 16, last: e.last }), cell(e.v, wv, { sz: 16, b: true, color: e.hl ? BLUE : DARK, last: e.last })];
        };
        const rows = [[HDR('Параметр', wk), HDR('Значение', wv), tc(END, gap, { mar: [0, 0, 0, 0] }), HDR('Параметр', wk), HDR('Значение', wv)]];
        for (let i = 0; i < n; i++) rows.push([...half(a[i]), tc(END, gap, { mar: [0, 0, 0, 0] }), ...half(b[i])]);
        out.push(`<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${rbg(wk + wv, 380, NAVYD, 90, 20, 0)}${rbg(wk + wv, 380, NAVYD, 90, 20, wk + wv + gap)}</w:p>`);
        // заголовок раздела и первые ~7 см таблицы не разрываются: если на странице осталось меньше —
        // раздел целиком начнётся с новой страницы; дальше таблица переносится построчно
        const KEEP = 12, WS = [wk, wv, gap, wk, wv];
        out.push(keepAll(tbl(rows.slice(0, 1 + KEEP), WS, { heights: { 0: 380 } })));
        if (rows.length > 1 + KEEP) out.push(tbl(rows.slice(1 + KEEP), WS));
      } else out.push(keepAll(specTable(groups, [6047, 4300])));
      out.push(p(r('Синим выделены ключевые параметры. Характеристики приведены по данным производителя.', { sz: 14, color: GRAY, i: true }), { before: 100 }));
    }
    out.push(galleryXml(m.gallery));
    return out.join('');
  }
  function kpXml(S) {
    const out = [heading('Коммерческое предложение', true)], t = totals(S.items, S.vat);
    const wc = [560, 4787, 1200, 1900, 1900], HL = B(null, null, [4, HAIR]), Mr = [230, 120, 230, 120];
    const rows = [[HDR('№', wc[0], 'center'), HDR('Наименование', wc[1]), HDR('Кол-во', wc[2], 'center'), HDR('Цена за ед., ' + curSh(S), wc[3], 'right'), HDR('Сумма, ' + curSh(S), wc[4], 'right')]];
    S.items.forEach((it, i) => {
      const nm = p(r(it.name, { sz: 19, b: true }), { after: it.spec ? 40 : 0 }) + (it.spec ? p(r(it.spec, { sz: 15, color: GRAY })) : '');
      rows.push([tc(p(r(String(i + 1), { sz: 18, color: GRAY }), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }), tc(nm, wc[1], { bdr: HL, mar: Mr }),
        tc(p(r(it.qty + NB + 'шт.', { sz: 18 }), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
        tc(p(r(money(it.price), { sz: 18 }), { jc: 'right' }), wc[3], { bdr: HL, mar: Mr }),
        tc(p(r(money(it.qty * it.price), { sz: 18, b: true }), { jc: 'right' }), wc[4], { bdr: HL, mar: Mr })]);
      (it.options || []).filter(o => o.name && +o.qty > 0).forEach((o, j) => {
        const Mo = [110, 120, 110, 120];
        const nm = p(r('+ ' + o.name, { sz: 17 }), { after: o.note ? 30 : 0, indL: 200 }) + (o.note ? p(r(o.note, { sz: 14, color: GRAY }), { indL: 200 }) : '');
        rows.push([tc(p(r(`${i + 1}.${j + 1}`, { sz: 15, color: GRAY }), { jc: 'center' }), wc[0], { bdr: HL, mar: Mo }), tc(nm, wc[1], { bdr: HL, mar: Mo }),
          tc(p(r(o.qty + NB + (o.unit || 'шт.'), { sz: 17 }), { jc: 'center' }), wc[2], { bdr: HL, mar: Mo }),
          tc(p(r(o.price ? money(o.price) : 'включено', { sz: 17, color: o.price ? DARK : GRAY }), { jc: 'right' }), wc[3], { bdr: HL, mar: Mo }),
          tc(p(r(o.price ? money(o.qty * o.price) : '—', { sz: 17, color: o.price ? DARK : GRAY }), { jc: 'right' }), wc[4], { bdr: HL, mar: Mo })]);
      });
    });
    const lbl = (tx, span, w) => tc(p(r(tx, { sz: 16, color: GRAY }), { jc: 'right' }), w, { span, mar: [90, 120, 60, 160] });
    rows.push([lbl('Итого', 2, wc[0] + wc[1]), tc(p(r(t.units + NB + 'шт.', { sz: 17, b: true }), { jc: 'center' }), wc[2], { mar: [90, 120, 60, 120] }),
      tc('', wc[3], { mar: [90, 120, 60, 120] }), tc(p(r(money(t.sum), { sz: 17, b: true }), { jc: 'right' }), wc[4], { mar: [90, 120, 60, 120] })]);
    rows.push([lbl(`в т. ч. НДС ${S.vat} %`, 4, wc[0] + wc[1] + wc[2] + wc[3]), tc(p(r(money(t.vat), { sz: 17 }), { jc: 'right' }), wc[4], { mar: [60, 120, 60, 120] })]);
    out.push(bgpara(W, 440, NAVYD, 90));
    out.push(tbl(rows, wc, { heights: { 0: 440 }, header: true }));
    const L4 = wc[0] + wc[1] + wc[2] + wc[3];
    out.push(bgpara(W, 640, BLUE, 120, 120));
    out.push(tbl([[tc(p(r(`Итого к оплате с НДС`, { sz: 18, color: 'FFFFFF', b: true, caps: true, sp: 15 }), { jc: 'right' }), L4, { mar: [0, 120, 0, 160] }),
      tc(p(r(money(t.sum), { sz: 24, color: 'FFFFFF', b: true }), { jc: 'right' }), wc[4], { mar: [0, 120, 0, 120] })]], [L4, wc[4]], { heights: { 0: 640 } }));
    out.push(p(r('Итого: ', { sz: 15, b: true }) + r(`${words(t.sum, curCode(S))}, в т. ч. НДС ${S.vat} % — ${money(t.vat)} ${curSh(S)}`, { sz: 15 }), { before: 140, line: 250 }));
    if (curCode(S) !== 'RUB') {
      const C = CURS[curCode(S)], rt = S.cur && +S.cur.rate;
      const eq = rt ? Math.round(t.sum * rt) : 0;
      out.push(p(r(`Цены указаны в ${C.name}. Оплата производится в рублях по курсу ЦБ РФ на дату оплаты.` +
        (rt ? ` Справочно: курс ЦБ РФ${S.cur.date ? ' на ' + ruDate(S.cur.date) : ''} — 1 ${C.sh} = ${String(rt).replace('.', ',')} руб.; сумма в рублях — ${money(eq)} руб.` : ''), { sz: 15, color: GRAY, i: true }), { before: 60, line: 250 }));
    }
    const conds = (S.conditions || []).filter(c => c.value);
    if (conds.length) {
      out.push(spacer(480));
      out.push(heading('Условия предложения'));
      out.push(tbl(conds.map((c, i) => {
        const bd = i === conds.length - 1 ? B() : B(null, null, [4, HAIR]);
        return [tc(p(r(c.label, { sz: 18, color: GRAY })), 3400, { bdr: bd, mar: [130, 120, 130, 120] }), tc(p(r(c.value, { sz: 18 })), 6947, { bdr: bd, mar: [130, 120, 130, 120] })];
      }), [3400, 6947]));
    }
    out.push(spacer(520));
    out.push(heading('Контактная информация'));
    const m = S.manager;
    const LBL = tx => p(r(tx, { sz: 14, color: GRAY, b: true, caps: true, sp: 20 }), { after: 50 });
    const ch = (lab, val, w, first, lastRow) => tc(LBL(lab) + p(val, { line: 240 }), w, { bdr: B([4, LINE]), va: 'top', mar: [200, first ? 0 : 200, lastRow ? 40 : 200, 120] });
    const top = tbl([[tc(p(r(m.name, { sz: 30, color: BLUE, b: true }), { after: 60, line: 240 }) + p(r(m.position || '', { sz: 19 }), { line: 250 }), 6400, { va: 'bottom', mar: [0, 0, 220, 0] }),
      tc(p(r('С уважением и надеждой', { sz: 17, color: GRAY, i: true }), { jc: 'right', line: 250 }) + p(r('на плодотворное сотрудничество', { sz: 17, color: GRAY, i: true }), { jc: 'right', line: 250 }), 3347, { va: 'bottom', mar: [0, 0, 220, 0] })]], [6400, 3347]);
    const cw = [3149, 3149, 3449];
    const phone = r(m.phone || '', { sz: 22, b: true }) + (m.ext ? r(' доб. ' + m.ext, { sz: 19, color: GRAY }) : '');
    const grid = tbl([[ch('Телефон', phone, cw[0], true), ch('Мобильный', r(m.mobile || '—', { sz: 22, b: true }), cw[1]),
      ch('E-mail', m.email ? hyper('rIdMail', r(m.email, { sz: 20, color: BLUE, b: true })) : r('—', { sz: 20 }), cw[2])],
    [ch('Сайт', m.site ? hyper('rIdSite', r(m.site, { sz: 20, color: BLUE, b: true })) : r('—', { sz: 20 }), cw[0], true, true),
      ch('Часы работы', r(m.hours || '—', { sz: 20 }), cw[1], false, true), ch('Адрес', r(m.address || '—', { sz: 20 }), cw[2], false, true)]], cw);
    out.push(bgpara(W, 3420, LIGHT, 180));
    out.push(tbl([[tc(top + grid + END, W, { va: 'top', mar: [340, 340, 200, 340] })]], [W], { heights: { 0: 3420 } }));
    return out.join('');
  }

  const SECT = '<w:sectPr><w:headerReference w:type="default" r:id="rId13"/><w:footerReference w:type="default" r:id="rId14"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="850" w:bottom="1020" w:left="709" w:header="142" w:footer="454" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>';

  function fld(instr, res, o) {
    const rp = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.b ? '<w:b/>' : ''}<w:color w:val="${o.color}"/><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>`;
    return `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${res}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  function footerXml(S, root) {
    const TOP = line('top', 4, LINE) + '<w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
    const left = p(brandRuns(15) +
      r('   ·   Технико-коммерческое предложение для ', { sz: 14, color: GRAY }) + r(S.client, { sz: 14, b: true }));
    const right = p(r((TPL.site ? TPL.site + '   ·   ' : ''), { sz: 14, color: GRAY }) + fld('PAGE', '1', { sz: 16, color: BLUE, b: true }) + r(' / ', { sz: 14, color: GRAY }) + fld('NUMPAGES', '1', { sz: 14, color: GRAY }), { jc: 'right' });
    return root + tbl([[tc(left, 6847, { bdr: TOP, mar: [110, 0, 0, 0] }), tc(right, 3500, { bdr: TOP, mar: [110, 0, 0, 0] })]], [6847, 3500]) + END + '</w:ftr>';
  }

  function relsXml(S, media) {
    const R = (id, type, target, ext) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ''}/>`;
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    if (TPL.rels) x += TPL.rels + (TPL.clients ? R(TPL.clients.rid, 'image', 'media/' + TPL.clients.file) : '');
    else x +=
      R('rId1', 'customXml', '../customXml/item1.xml') + R('rId2', 'numbering', 'numbering.xml') + R('rId3', 'styles', 'styles.xml') + R('rId4', 'settings', 'settings.xml') +
      R('rId5', 'webSettings', 'webSettings.xml') + R('rId6', 'footnotes', 'footnotes.xml') + R('rId7', 'endnotes', 'endnotes.xml') + R('rId8', 'image', 'media/image1.jpeg') +
      R('rId13', 'header', 'header1.xml') + R('rId14', 'footer', 'footer1.xml') + R('rId15', 'fontTable', 'fontTable.xml') + R('rId16', 'theme', 'theme/theme1.xml');
    const m = S.manager;
    if (m.email) x += R('rIdMail', 'hyperlink', 'mailto:' + m.email.trim(), true);
    if (m.site) x += R('rIdSite', 'hyperlink', /^https?:/i.test(m.site) ? m.site.trim() : 'http://' + m.site.trim(), true);
    media.forEach(md => { x += R(md.rid, 'image', 'media/' + md.file); });
    return x + '</Relationships>';
  }

  /* S — состояние формы; M — подготовленные изображения:
     { cover:{file,w,h}, items:{[id]:{tile:{file,w,h}, logo:{file,w,h}}} }  */
  function build(S, Min, roots, tpl) {
    setTemplate(tpl);
    PID = 9000;
    const media = [], M = { cover: null, items: {} };
    let n = 0;
    const reg = x => { if (!x) return null; const rid = 'rIdImg' + (++n); media.push({ rid, file: x.file }); return Object.assign({ rid }, x); };
    M.cover = reg(Min.cover);
    M.thumbs = {}; for (const k in (Min.thumbs || {})) M.thumbs[k] = reg(Min.thumbs[k]);
    for (const id in (Min.items || {})) M.items[id] = { tile: reg(Min.items[id].tile), logo: reg(Min.items[id].logo), gallery: (Min.items[id].gallery || []).map(reg).filter(Boolean), featImgs: Object.fromEntries(Object.entries(Min.items[id].featImgs || {}).map(([k, v]) => [k, reg(v)])) };
    let body = coverXml(S, M);
    if (S.showClients && TPL.clients !== false) {
      if (TPL.clients && TPL.clients.rid) { const c = TPL.clients, k = Math.min(7108166 / c.w, 7400000 / c.h);
        body += heading(TPL.clientsTitle || 'Наши клиенты', true) + p(img(c.rid, Math.round(c.w * k), Math.round(c.h * k), 'Логотипы клиентов'), { jc: 'center' }); }
      else if (!TPL.rels) body += heading(TPL.clientsTitle || 'Наши клиенты', true) + LOGOS;
    }
    for (const it of S.items) if (it.page && ((it.options || []).some(o => o.name) || it.groups?.some(g => g.rows?.some(x => x.k || x.v)) || M.items[it.id]?.tile || (M.items[it.id]?.gallery || []).length || Object.keys(M.items[it.id]?.featImgs || {}).length || (it.features || []).some(f => f.text))) body += equipXml(it, M);
    body += kpXml(S) + '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>';
    return {
      document: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + roots.document + '<w:body>' + body + (TPL.sect || SECT) + '</w:body></w:document>',
      footer: footerXml(S, roots.footer),
      rels: relsXml(S, media),
      media
    };
  }

  root.KPGen = { build, money, words, totals, ruDate, plural, CURS };
})(typeof window !== 'undefined' ? window : globalThis);
