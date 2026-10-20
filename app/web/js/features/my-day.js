// Кабинет менеджера — первый экран при запуске (функция myDay; окно и вкладки — cabinet.js). Открывается и из меню «⋯ → Кабинет».
// «Показывать при запуске» — настройка этого браузера.
'use strict';

// сколько строк в блоках «Моего дня» — «Настройки → Значения программы → Интерфейс»
DefRegistry.add([['myday', 'Кабинет менеджера', 'ui', 'Первый экран при запуске, вкладка «Сегодня»: дела, напоминания по КП, сделки без следующего дела, черновики. Здесь — сколько строк показывать в блоках; остальное открывается кнопкой «Все».']], [
  ['ui.mdRem', 'myday', 'Напоминаний на вкладке «Сегодня»', 'num', '5', {unit:'шт.', req:true, min:1, max:30, hint:'Сколько ближайших напоминаний по КП («перезвонить», «истекает срок КП», «отправлено — ответа нет») видно сразу. Остальные — по кнопке «Все».'}],
  ['ui.mdDrafts', 'myday', 'Черновиков на вкладке «Сегодня»', 'num', '4', {unit:'шт.', req:true, min:1, max:30, hint:'Сколько последних незаконченных КП видно сразу. Остальные — по кнопке «Все».'}],
]);

class MyDay {
  static KEY = 'kp.myday.off';
  static on(){ return FEAT.on('myDay'); }
  static atStart(){ try{ return localStorage.getItem(this.KEY)!=='1'; }catch(e){ return true; } }
  static setAtStart(v){ try{ v ? localStorage.removeItem(this.KEY) : localStorage.setItem(this.KEY, '1'); }catch(e){} }
  static badge(){ document.querySelectorAll('[data-a=myDay]').forEach(b=>{ b.hidden=!this.on(); }); }
  static myName(){ return (AUTH.user&&AUTH.user.name)||meName()||''; }
  static hello(){ const h=new Date().getHours(); return h<5?'Доброй ночи':h<12?'Доброе утро':h<18?'Добрый день':'Добрый вечер'; }

  static section(title, body, more=''){ return `<section class="md-s"><div class="md-h"><p class="sub">${title}</p>${more}</div>${body}</section>`; }
  /** «Мой день» стал вкладкой «Сегодня» кабинета менеджера (features/crm/cabinet.js) */
  static open(){ return Cabinet.open(); }
  /** при запуске: «Мой день» вместо каталога */
  static start(){ this.badge(); if (this.on() && this.atStart()){ this.open(); return true; } return false; }
}
