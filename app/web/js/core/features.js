// Функции программы, которые администратор включает и выключает («Настройки → Функции программы»; сервер: app/features.py,
// kv settings.features = {ключ: {on, who, users}}): включена ли и кому доступна — всем, только администратору, выбранным
// менеджерам. Сервер присылает готовый ответ для этого пользователя: FEAT.on(ключ) — доступна ли; недоступная прячется из интерфейса,
// её адреса на сервере закрыты. Данные выключенной функции не удаляются. Последние значения хранятся в браузере.
'use strict';

class FeatureRegistry {
  constructor(){ this.defs=[]; this.groups=[]; this.vals={}; try{ this.vals=JSON.parse(localStorage.getItem('kp.features')||'{}')||{}; }catch(e){ this.vals={}; } }
  group(id, title){ this.groups.push({id, title}); return this; }
  /** o: {key, group, label, hint — что делает, off — что пропадёт, если выключить, needs — без какой функции не работает} */
  add(o){ this.defs.push(o); return this; }
  get(key){ return this.defs.find(d=>d.key===key); }
  on(key){ const d=this.get(key); if (d && d.needs && !this.on(d.needs)) return false; return this.vals[key] !== false; }
  use(v){ this.vals = v && typeof v==='object' && !Array.isArray(v) ? v : {}; try{ localStorage.setItem('kp.features', JSON.stringify(this.vals)); }catch(e){} }
  async load(){ try{ this.use(await api('/api/features')); }catch(e){} }
  /** права изменились (вход администратора, другой менеджер на устройстве) — перечитать и перерисовать */
  async refresh(){ await this.load(); if (typeof renderForm==='function') renderForm(); if (typeof Reminders!=='undefined') Reminders.load(); if (typeof MyDay!=='undefined') MyDay.badge(); }
}

const FEAT = new FeatureRegistry()
  .group('kp', 'Составление КП').group('deal', 'Экономика').group('work', 'Работа с клиентом').group('cat', 'Каталог').group('ui', 'Интерфейс')
  .add({key:'tender', group:'kp', label:'КП для тендера', hint:'Переключатель «Обычное / Для тендера» в разделе «Клиент»: номер закупки, шаблон «Тендерный», имя файла «№ закупки КП…».', off:'Все КП — обычные.'})
  .add({key:'stations', group:'kp', label:'Станции в контейнере', hint:'Кнопка «+ Станция в контейнере», состав станции, мастер станций.', off:'Кнопка и мастер станций скрыты; уже добавленные станции остаются в КП.'})
  .add({key:'ai', group:'kp', label:'Заполнение карточки с ИИ', hint:'Вкладка «✨ Заполнить с ИИ» в карточке оборудования и у элементов станции.', off:'Карточки заполняются вручную, по ссылке и из файла.'})
  .add({key:'check', group:'kp', label:'Проверка контрагента', hint:'«Проверить контрагента» (Checko): статус, риски, суды, долги.', off:'Ссылка проверки скрыта, лимит проверок не расходуется.'})
  .add({key:'clientPrev', group:'kp', label:'Предупреждение о КП клиента', hint:'В разделе «Клиент»: у клиента уже есть КП за 4 месяца — номер, автор, статус.'})
  .add({key:'deal', group:'deal', label:'Экономика сделки', hint:'Окно «Экономика сделки»: закупка, логистика, таможня, финансирование, цена под маржу; прибыль в журнале и на главном экране.', off:'Окно, блок прибыли справа и прибыль в журнале скрыты; цены КП вводятся вручную.'})
  .add({key:'carriers', group:'deal', needs:'deal', label:'Цены перевозчиков онлайн', hint:'«Логистика» в экономике сделки: ATI.SU, ПЭК, Деловые Линии, КИТ — запрос цен автоматически.', off:'Доставка считается по тарифам из «Настроек» и вводится вручную.'})
  .add({key:'track', group:'work', label:'Ход сделки', hint:'Статус КП в журнале (отправлено, в работе, выиграно, проиграно), заметки, воронка и фильтр по статусу.', off:'Статусы, воронка и напоминания «перезвонить» скрыты.'})
  .add({key:'reminders', group:'work', needs:'track', label:'Напоминания', hint:'🔔 в шапке: перезвонить, истекает срок действия КП, отправлено без ответа.'})
  .add({key:'mail', group:'work', label:'Отправка КП по почте', hint:'«Отправить» в журнале и «Отправить клиенту» после сохранения (почта — «Настройки → Почта»).'})
  .add({key:'report', group:'work', label:'Отчёт по КП', hint:'«Отчёт» в журнале: по менеджерам, категориям, клиентам за период, Excel.'})
  .add({key:'versions', group:'work', label:'История версий КП', hint:'«Версии» в журнале: прежние варианты КП и сравнение с текущим.', off:'Кнопка скрыта; версии продолжают сохраняться.'})
  .add({key:'feedInfo', group:'cat', label:'РРЦ и остатки поставщиков', hint:'В каталоге: рекомендованная цена, наличие по складам, акции из фидов поставщиков.'})
  .add({key:'catImport', group:'cat', label:'Импорт каталога', hint:'«Ещё» в каталоге: импорт из Excel и загрузка файла каталога.', off:'Пункты скрыты; выгрузка каталога остаётся.'})
  .add({key:'hotkeys', group:'ui', label:'Горячие клавиши', hint:'Ctrl+S — сохранить КП, Ctrl+K — каталог, «/» — поиск в каталоге.'});
