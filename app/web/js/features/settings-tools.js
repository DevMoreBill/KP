'use strict';
// Инструменты «Настроек» поверх вкладок:
//   SettingsSearch — поиск по всем настройкам (вкладки, умолчания, функции, списки, ключи, категории) с переходом к найденному;
//   StDirty — несохранённые изменения: отметка в заголовке и вопрос при уходе с вкладки или закрытии окна;
//   SettingsHistoryPanel — история изменений настроек с откатом (сервер: app/settings_history.py);
//   ConnectionsPanel — проверка всех подключений одной кнопкой (app/connections.py);
//   ChangedPanel — всё, что отличается от встроенного, одним списком с «↺ вернуть»;
//   MirrorCard — вторая папка для копий базы (app/backup_mirror.py), карточка во вкладке «Копии и база».

// ---------------------------------------------------------------- поиск по настройкам
class SettingsSearch {
  // слова, по которым вкладку находят, хотя их нет в названии
  static WORDS = {
    stats:'статистика сводка обзор внимание', audit:'журнал кто изменил действия аудит', templates:'шаблон оформление логотип docx документ word титул',
    'db-kp':'кп журнал удалить номер', 'db-catalog':'товары каталог позиции карточки оборудование', types:'категории характеристики параметры фильтры группы',
    feeds:'фид прайс остатки ррц скидка поставщик yml excel наличие', moderation:'модерация правки подтверждение черновик',
    'db-client':'клиенты инн реквизиты контрагенты', 'db-supplier':'поставщики склады условия оплата отгрузка', 'db-manager':'менеджеры контакты телефон должность подпись',
    logistics:'тарифы доставка перевозка машина разгрузка трал фура логистика', features:'функции включить выключить доступ кнопки',
    defaults:'умолчания значения подставляет ндс валюта город срок гарантия условия', lists:'списки выбор варианты выпадающие причины проигрыша единицы',
    texts:'тексты надписи подписи подсказки переименовать', mail:'почта smtp письмо отправка яндекс mail.ru пароль приложения',
    ai:'нейросеть ии deepseek openrouter модель токены заполнить', keys:'ключи api checko dadata ati деловые линии кит сдэк возовоз convertapi pdf',
    connections:'проверка подключений связь сервисы работает не работает', access:'вход логин пароль права менеджеров блокировать',
    users:'администраторы учётные записи', security:'мой пароль сменить', updates:'обновление версия github установить откат токен',
    system:'система папки порт адрес перезапуск диск место сервер', backup:'копии резервная копия база экспорт импорт выгрузка json zip sqlite вторая папка флешка сетевой диск облако восстановить',
    trash:'корзина восстановить удалённое', changed:'изменённые отличается встроенное вернуть сбросить', history:'история изменений откат вернуть как было кто изменил'};

  static norm(s){ return String(s||'').toLowerCase().replace(/ё/g,'е'); }

  /** [{label, where, text, tab, focus?, before?}] — всё, что можно найти */
  static index(){
    const out=[], add=(o)=>out.push({...o, n:this.norm(o.label), t:this.norm(o.label+' '+(o.text||'')+' '+(o.where||''))});
    for (const g of AdminNav.GROUPS) for (const t of g.tabs)
      add({label:t.label, where:g.title, text:t.hint+' '+(this.WORDS[t.key]||''), tab:t.key, kind:'Вкладка'});
    if (typeof DEF_SCHEMA!=='undefined'){ const gt=Object.fromEntries(DEF_GROUPS);
      for (const [key, g, label, , builtin, o={}] of DEF_SCHEMA) add({label, where:'Программа → Умолчания → '+(gt[g]||g), text:(o.hint||'')+' '+(builtin??''), tab:'defaults', focus:`[data-dk="${CSS.escape(key)}"]`, kind:'Умолчание'}); }
    if (typeof FEAT!=='undefined') for (const d of FEAT.defs) add({label:d.label, where:'Программа → Функции программы', text:d.hint, tab:'features', focus:`[data-ft="${CSS.escape(d.key)}"]`, kind:'Функция'});
    if (typeof LISTS!=='undefined') for (const d of LISTS.defs.values()) add({label:d.label, where:'Программа → Списки и выборы', text:d.hint||'', tab:'lists', before:()=>{ ListsPanel.last=d.key; }, kind:'Список'});
    if (typeof KEY_GROUPS!=='undefined') for (const [g, , fs] of KEY_GROUPS) for (const f of fs) if (f.t) add({label:f.t, where:'Подключения → Ключи API → '+g, text:(f.h||'')+' '+(f.ph||''), tab:'keys', focus:`[data-key="${CSS.escape(f.id)}"]`, kind:'Ключ'});
    if (typeof TYPES!=='undefined') for (const t of TYPES) add({label:t.name, where:'Каталог → Категории оборудования', text:(t.group||'')+' '+t.fields.map(f=>f.label).join(' '), tab:'types', kind:'Категория', find:t.name});
    return out;
  }

  /** найденное по словам запроса: все слова есть в тексте; выше — совпадение с началом названия */
  static find(q){
    const words=this.norm(q).split(/\s+/).filter(Boolean); if (!words.length) return [];
    const idx=this._idx||(this._idx=this.index());
    return idx.filter(e=>words.every(w=>e.t.includes(w)))
      .map(e=>({e, s:(e.n.startsWith(words[0])?0:e.n.includes(words[0])?1:2)+(e.kind==='Вкладка'?0:0.5)}))
      .sort((a,b)=>a.s-b.s || a.e.label.localeCompare(b.e.label,'ru')).slice(0,40).map(x=>x.e);
  }

  static html(){ return `<div class="st-find"><input type="search" id="stFind" placeholder="Найти настройку…" autocomplete="off" aria-label="Поиск по настройкам" data-nodirty></div>`; }

  static bind(d){
    const inp=d.querySelector('#stFind'); if (!inp) return; this._idx=null; let t=0;
    inp.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>this.show(inp.value), 120); };
    inp.onkeydown=e=>{ if (e.key==='Escape' && inp.value){ e.preventDefault(); e.stopPropagation(); inp.value=''; this.show(''); }
      if (e.key==='Enter'){ e.preventDefault(); d.querySelector('#stFindRes [data-sfi]')?.click(); } };
  }

  static show(q){
    const m=$('#stMain'); if (!m) return;
    if (!q.trim()){ if (m.dataset.find){ delete m.dataset.find; stTab(); } return; }
    m.dataset.find='1'; this.res=this.find(q);
    m.innerHTML=`<header class="st-th"><span class="muted">Поиск</span><h4>«${esc(q.trim())}»</h4><p class="muted">${this.res.length?'Найдено: '+this.res.length+'. Щёлкните, чтобы перейти.':'Ничего не найдено. Попробуйте другое слово: «НДС», «почта», «логотип», «копия».'}</p></header>
      <div class="st-body" id="stFindRes">${this.res.map((e,i)=>`<button type="button" class="st-fr" data-sfi="${i}"><b>${esc(e.label)}</b><span class="muted">${esc(e.kind)} · ${esc(e.where)}</span></button>`).join('')}</div>`;
    m.querySelector('#stFindRes').onclick=ev=>{ const b=ev.target.closest('[data-sfi]'); if (b) this.go(this.res[+b.dataset.sfi]); };
  }

  static async go(e){
    if (!await StDirty.leave()) return;
    const inp=$('#stFind'); if (inp) inp.value='';
    const m=$('#stMain'); if (m) delete m.dataset.find;
    if (e.before) e.before();
    StNav.select(e.tab); await stTab();
    StNav.highlight(e.focus, e.find||e.label);
  }
}

// ---------------------------------------------------------------- переход по вкладкам и подсветка найденного
class StNav {
  static select(key){ ST.tab=AdminNav.key(key); const d=$('#setdlg'); if (d) d.querySelectorAll('.st-nav [data-sttab]').forEach(b=>b.classList.toggle('on', b.dataset.sttab===ST.tab)); d?.querySelector('.st-nav .on')?.scrollIntoView({block:'nearest'}); }
  /** найти элемент на открытой вкладке (селектор или текст) и показать его */
  static highlight(sel, text){
    const body=$('#stMain .st-body'); if (!body) return;
    let el=sel ? body.querySelector(sel) : null;
    if (el) el=el.closest('.df-row,.ft-r,.key-f,.st-row,tr,label,.st-card')||el;
    if (!el && text){ const n=SettingsSearch.norm(text);
      el=[...body.querySelectorAll('td,b,h4,p.sub,.ls-it,label span')].find(x=>SettingsSearch.norm(x.textContent).includes(n)); el=el&&(el.closest('tr,.st-row,.ls-it,label')||el); }
    if (!el) return;
    el.scrollIntoView({block:'center'}); el.classList.add('st-hit'); setTimeout(()=>el.classList.remove('st-hit'), 2600);
    el.querySelector?.('input:not([type=checkbox]),select,textarea')?.focus({preventScroll:true});
  }
}

// ---------------------------------------------------------------- несохранённые изменения
class StDirty {
  static on = false;
  // поля, которые не настройки: поиск, фильтры журнала, выбор строк, параметры выгрузки, файлы
  static SKIP = '[type=search],[type=file],[data-nodirty],[data-nodirty] *,[data-af],[data-did],#dtExp *,.st-find *,[name=dtScope]';

  static watch(d){
    if (d._dirtyWatch) return; d._dirtyWatch=true;
    const mark=e=>{ const t=e.target; if (!t.closest || !t.closest('#stMain .st-body') || t.matches(this.SKIP)) return;
      if (!t.matches('input,select,textarea')) return; this.set(true); };
    d.addEventListener('input', mark); d.addEventListener('change', mark);
    d.addEventListener('cancel', async e=>{ if (!this.on) return; e.preventDefault(); if (await this.leave()) d.close(); });
    d.addEventListener('close', ()=>this.set(false));
    window.addEventListener('beforeunload', e=>{ if (this.on && d.open){ e.preventDefault(); e.returnValue=''; } });
  }

  static set(v){
    this.on=!!v; const d=$('#setdlg'); if (!d) return;
    let b=d.querySelector('.st-dirty');
    if (this.on && !b){ const h=d.querySelector('.dlg-h h3'); if (h){ b=document.createElement('span'); b.className='st-dirty'; b.textContent='● Не сохранено'; b.title='На этой вкладке есть несохранённые изменения'; h.after(b); } }
    if (!this.on && b) b.remove();
    d.querySelector('.st-nav .on')?.classList.toggle('dirty', this.on);
  }

  /** сохранение прошло (любой запрос на изменение) — отметку снять */
  static saved(){ if (this.on) this.set(false); }

  /** можно уйти с вкладки? true — изменений нет или пользователь согласен их потерять */
  static async leave(){
    if (!this.on) return true;
    const ok=await stConfirm('Есть несохранённые изменения', 'Если уйти, они пропадут. Чтобы сохранить — останьтесь и нажмите «Сохранить» на этой вкладке.', 'Уйти без сохранения');
    if (ok) this.set(false);
    return !!ok;
  }
}

// ---------------------------------------------------------------- после отката: настройки в этом браузере — заново с сервера
class StRefresh {
  static async all(){
    const jobs=[];
    if (typeof defaultsLoad==='function') jobs.push(defaultsLoad());
    if (typeof FEAT!=='undefined' && FEAT.refresh) jobs.push(FEAT.refresh());
    if (typeof LISTS!=='undefined') jobs.push(aapi('lists').then(r=>{ LISTS.use(r.values||{}); LISTS.cache(); }));
    await Promise.all(jobs.map(p=>Promise.resolve(p).catch(()=>{})));
  }
}

// ---------------------------------------------------------------- значения настроек для показа
class StVal {
  static text(v){
    if (v==null || v==='') return '— (встроенное)';
    if (typeof v==='boolean') return v?'да':'нет';
    if (Array.isArray(v)) return v.length+' '+plural(v.length,'строка','строки','строк');
    if (typeof v==='object'){
      if ('on' in v && Object.keys(v).length<=2) return (v.on===false?'выключено':'включено')+(v.v!=null&&v.v!==''?', '+v.v:'');
      if ('on' in v && 'who' in v) return (v.on===false?'выключено':'включено')+(v.who&&v.who!=='all'?', доступ: '+({admin:'администратору',users:'выбранным'}[v.who]||v.who):'');
      const s=JSON.stringify(v); return s.length>140 ? s.slice(0,140)+'…' : s; }
    return String(v);
  }
  static full(v){ return v==null ? '' : typeof v==='object' ? JSON.stringify(v, null, 1) : String(v); }

  // понятные имена полей истории: ['defaults', 'kp.vat'] → «Умолчания → НДС в ценах КП»
  static PART = {defaults:'Умолчания', lists:'Списки', features:'Функции', ai:'Нейросеть', userLogin:'Вход менеджеров', productEditModeration:'Модерация',
    auditYears:'Срок журнала', backup2:'Вторая папка копий', host:'Сервер', port:'Порт', security:'Защита', login:'Логин', fromEmail:'Адрес отправителя',
    fromName:'Имя отправителя', bccSelf:'Копия себе', subject:'Тема письма', body:'Текст письма', types:'Категории', items:'Фиды', enabled:'Включено',
    model:'Модель', base:'Адрес API', on:'Включено', path:'Папка', keep:'Хранить копий', images:'Изображения'};
  static path(p){
    const [a, b]=p, name=x=>this.PART[x]||x;
    if (!b) return name(a)||'всё значение';
    let second=b;
    if (a==='defaults' && typeof DEF_BY!=='undefined' && DEF_BY[b]) second=DEF_BY[b][2];
    else if (a==='features' && typeof FEAT!=='undefined' && FEAT.get(b)) second=FEAT.get(b).label;
    else if (a==='lists' && typeof LISTS!=='undefined' && LISTS.get(b)) second=LISTS.get(b).label;
    else second=this.PART[b]||b;
    return name(a)+' → '+second;
  }
}

// ---------------------------------------------------------------- история изменений
class SettingsHistoryPanel {
  static filter = '';      // вкладка, по которой отфильтрована история (кнопка «История» в заголовке вкладки)
  static TABS = {defaults:'Умолчания', lists:'Списки и выборы', features:'Функции программы', texts:'Тексты интерфейса', types:'Категории оборудования',
    logistics:'Тарифы доставки', mail:'Почта', feeds:'Фиды поставщиков', access:'Вход менеджеров', moderation:'Модерация правок', ai:'Нейросеть', backup:'Копии и база'};

  constructor(m){ this.m=m; }
  async open(){
    const r=await aapi('history?limit=500'); this.items=r.items||[];
    this.render(); this.bind();
  }
  list(){ const f=SettingsHistoryPanel.filter; return f ? this.items.filter(x=>x.tab===f) : this.items; }
  render(){ const f=SettingsHistoryPanel.filter, L=this.list();
    this.m.innerHTML=`<div class="st-card"><div class="row" style="gap:8px;flex-wrap:wrap"><label class="f" style="margin:0"><span>Раздел</span><select id="shF" data-nodirty>
        <option value="">Все разделы</option>${Object.entries(SettingsHistoryPanel.TABS).map(([k,l])=>`<option value="${k}"${f===k?' selected':''}>${esc(l)}</option>`).join('')}</select></label>
        <span class="sp"></span><span class="muted">Записей: ${L.length}</span></div>
      <p class="muted">Каждое сохранение настроек: что было и что стало, кто изменил. «Вернуть как было» отменяет только эту правку — более поздние изменения других полей остаются. Пароли и ключи API в историю не попадают.</p></div>
      <div class="st-card">${L.length?L.map(x=>`<div class="st-row sh-r" data-shid="${x.id}"><div><b>${esc(x.title)}</b>
          <span class="muted">${esc(stTime(x.ts))} · ${esc(x.by||'')} · ${x.count} ${plural(x.count,'поле','поля','полей')}${x.rolled?` · <b class="ok-t">возвращено ${esc(stTime(x.rolled))}</b>`:''}</span>
          <span class="muted sh-p">${esc(x.paths.slice(0,4).map(p=>StVal.path(p)).join('; '))}${x.paths.length>4?'…':''}</span></div>
          <div class="acts"><button class="btn" type="button" data-shopen="${x.id}">Подробнее</button></div></div>`).join('')
        :'<p class="empty">Изменений пока нет. История ведётся с версии 3.47.0.</p>'}</div>`; }
  async details(id){
    const d=await aapi('history/'+id), later=d.diff.some(x=>x.later);
    const html=`<h3>${esc(d.title)}</h3><p class="muted">${esc(stTime(d.ts))} · ${esc(d.by||'')}${d.rolled?' · уже возвращалось '+esc(stTime(d.rolled)):''}</p>
      <div class="sh-tw"><table class="pv-t sh-t"><thead><tr><th>Поле</th><th>Было</th><th>Стало</th><th>Сейчас</th></tr></thead><tbody>
      ${d.diff.map(x=>`<tr${x.later?' class="sh-later"':''}><td>${esc(StVal.path(x.path))}</td><td data-l="Было" title="${esc(StVal.full(x.before))}">${esc(StVal.text(x.before))}</td><td data-l="Стало" title="${esc(StVal.full(x.after))}">${esc(StVal.text(x.after))}</td><td data-l="Сейчас" title="${esc(StVal.full(x.now))}">${esc(StVal.text(x.now))}</td></tr>`).join('')}</tbody></table></div>
      ${later?'<p class="msg warn" style="text-align:left">Отмеченные поля после этого меняли ещё раз — откат вернёт им значение «Было».</p>':''}
      <div class="row"><button class="btn" type="button" data-v="0">Закрыть</button><button class="btn ghost" type="button" data-v="go">Открыть вкладку</button><button class="btn primary" type="button" data-v="back">Вернуть как было</button></div>`;
    const v=await stModal(html);
    if (v==='go'){ StNav.select(d.tab); return stTab(); }
    if (v==='back'){
      try{ await aapi('history/'+id+'/rollback', {method:'POST'}); toast('Возвращено как было: '+d.title); await StRefresh.all(); }
      catch(e){ toast('Не возвращено: '+(e.message||e)); }
      this.open(); }
  }
  bind(){
    this.m.onchange=e=>{ if (e.target.id==='shF'){ SettingsHistoryPanel.filter=e.target.value; this.render(); } };
    this.m.onclick=e=>{ const b=e.target.closest('[data-shopen]'); if (b) this.details(b.dataset.shopen); };
  }
}

// ---------------------------------------------------------------- проверка подключений
class ConnectionsPanel {
  static ICON = {ok:['✓','работает','ok-t'], warn:['!','есть замечания','warn-t'], fail:['✕','не работает','bad-t'], off:['—','не настроено','muted']};
  constructor(m){ this.m=m; }
  async open(){ this.r=await aapi('connections'); this.render(); this.bind(); }
  render(busy){ const r=this.r||{}, L=r.items||[], cnt=k=>L.filter(x=>x.status===k).length;
    const row=x=>{ const [ic, lab, cls]=ConnectionsPanel.ICON[x.status]||ConnectionsPanel.ICON.fail;
      return `<tr><td class="cn-s ${cls}" title="${lab}"><b aria-hidden="true">${ic}</b> ${lab}</td><td><b>${esc(x.name)}</b><small class="muted">${esc(x.group)}${x.ms>=1000?' · '+(x.ms/1000).toFixed(1).replace('.',',')+' с':''}</small></td>
        <td>${esc(x.msg||'')}</td><td>${x.status==='ok'?'':`<button class="btn ghost sm" type="button" data-sttab="${esc(x.tab)}">Настроить</button>`}</td></tr>`; };
    this.m.innerHTML=`<div class="st-card"><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-cnrun${busy?' disabled':''}>${busy?'Проверяю… до 45 секунд':'Проверить всё'}</button>
        <span class="muted">${r.at?'Проверено '+esc(stTime(r.at)):'Ещё не проверялось'}</span><span class="sp"></span>
        ${L.length?`<span class="muted">работает: <b class="ok-t">${cnt('ok')}</b> · замечания: <b class="warn-t">${cnt('warn')}</b> · не работает: <b class="bad-t">${cnt('fail')}</b> · не настроено: ${cnt('off')}</span>`:''}</div>
      <p class="muted">Почта — только вход на сервер, письмо не отправляется. Нейросеть — короткий запрос (несколько токенов). Checko — показывается остаток лимита, запросы не тратятся. Перевозчики — пробный расчёт 300 кг Москва → Санкт-Петербург. Фиды — доступность адреса прайса.</p></div>
      ${L.length?`<div class="st-card"><div class="ac-tw"><table class="pv-t cn-t"><tbody>${L.map(row).join('')}</tbody></table></div></div>`:''}`; }
  bind(){ this.m.onclick=async e=>{ if (!e.target.closest('[data-cnrun]')) return; this.render(true);
    try{ this.r=await aapi('connections', {method:'POST'}); }catch(err){ toast('Проверка не выполнена: '+(err.message||err)); }
    this.render(); }; }
}

// ---------------------------------------------------------------- изменённые настройки
class ChangedPanel {
  constructor(m){ this.m=m; }
  async open(){
    const [d, f, l, mb]=await Promise.all([aapi('defaults'), aapi('features'), aapi('lists'), aapi('maint/mirror').catch(()=>null)]);
    if (typeof uitLoad==='function') await uitLoad();
    this.vals=d.values||{}; this.feat=f.config||{}; this.lists=l.values||{}; this.mirror=mb;
    this.render(); this.bind();
  }
  defRows(){ return (typeof DEF_SCHEMA!=='undefined'?DEF_SCHEMA:[]).filter(([k])=>this.vals[k]!=null).map(([k, , label, type, builtin])=>{
    const x=this.vals[k]; const now=type==='bool'?((x.on??builtin)?'да':'нет'):(x.on===false?'выключено':String(x.v??''));
    return {label, now, was:type==='bool'?(builtin?'да':'нет'):String(builtin??'—'), reset:{defaults:k}, tab:'defaults', focus:`[data-dk="${CSS.escape(k)}"]`}; }).filter(x=>x.now!==x.was); }
  featRows(){ return (typeof FEAT!=='undefined'?FEAT.defs:[]).filter(d=>{ const c=this.feat[d.key]; return c && (c.on===false || (c.who&&c.who!=='all')); }).map(d=>{ const c=this.feat[d.key];
    return {label:d.label, now:c.on===false?'выключено':'доступ: '+({admin:'только администратору',users:'выбранным менеджерам'}[c.who]||c.who), was:'включено для всех', reset:{features:d.key}, tab:'features', focus:`[data-ft="${CSS.escape(d.key)}"]`}; }); }
  listRows(){ return (typeof LISTS!=='undefined'?[...LISTS.defs.values()]:[]).filter(d=>this.lists[d.key]!=null).map(d=>({label:d.label, now:StVal.text(this.lists[d.key]), was:StVal.text(d.builtin), reset:{lists:d.key}, tab:'lists', before:()=>{ ListsPanel.last=d.key; }})); }
  otherRows(){ const out=[]; const n=typeof UIT!=='undefined'?Object.keys(UIT.map||{}).length:0;
    if (n) out.push({label:'Тексты интерфейса', now:'заменено: '+n, was:'исходные надписи', tab:'texts'});
    const ut=typeof userTypesList==='function'?userTypesList():[]; if (ut.length) out.push({label:'Категории оборудования', now:'своих и изменённых: '+ut.length, was:'встроенные', tab:'types'});
    if (this.mirror && this.mirror.on) out.push({label:'Вторая папка для копий базы', now:this.mirror.path, was:'не задана', tab:'backup'});
    return out; }
  render(){
    const sec=[['Умолчания', this.defRows()], ['Функции программы', this.featRows()], ['Списки и выборы', this.listRows()], ['Другое', this.otherRows()]];
    this.rows=sec.flatMap(([, r])=>r); let i=0;
    const total=this.rows.length;
    this.m.innerHTML=`<div class="st-card"><p class="muted" style="margin:0">Всё, что настроено «под себя», — отличается от встроенного в программу. «↺» — вернуть встроенное значение (правка попадёт в историю, её можно отменить). Изменено: <b>${total}</b>.</p></div>
      ${sec.map(([t, r])=>r.length?`<div class="st-card"><p class="sub">${esc(t)} · ${r.length}</p><div class="ac-tw"><table class="pv-t ch-t"><thead><tr><th>Настройка</th><th>Сейчас</th><th>Встроенное</th><th></th></tr></thead><tbody>
        ${r.map(x=>{ const k=i++; return `<tr><td><b>${esc(x.label)}</b></td><td data-l="Сейчас">${esc(x.now)}</td><td class="muted" data-l="Встроенное">${esc(x.was)}</td><td class="acts"><button class="btn ghost sm" type="button" data-chgo="${k}">Открыть</button>${x.reset?`<button class="icon" type="button" data-chrs="${k}" title="Вернуть встроенное" aria-label="Вернуть встроенное">↺</button>`:''}</td></tr>`; }).join('')}</tbody></table></div></div>`:'').join('')}
      ${total?'':'<p class="empty">Всё как в программе — изменённых настроек нет.</p>'}`; }
  async reset(x){
    if (!await stConfirm('Вернуть встроенное?', '«'+x.label+'» — станет как в программе: '+x.was+'.', 'Вернуть')) return;
    const [kind, key]=Object.entries(x.reset)[0];
    try{ await ajson(kind, {values:{[key]: null}}); toast('Возвращено встроенное: '+x.label); await StRefresh.all(); }
    catch(e){ toast('Не возвращено: '+(e.message||e)); }
    this.open(); }
  bind(){ this.m.onclick=async e=>{ const g=e.target.closest('[data-chgo]'), r=e.target.closest('[data-chrs]');
    if (r) return this.reset(this.rows[+r.dataset.chrs]);
    if (g){ const x=this.rows[+g.dataset.chgo]; if (x.before) x.before(); StNav.select(x.tab); await stTab(); StNav.highlight(x.focus, x.label); } }; }
}

// ---------------------------------------------------------------- вторая папка для копий базы
class MirrorCard {
  constructor(box){ this.box=box; this.t=0; }
  async open(){ try{ this.s=await aapi('maint/mirror'); }catch(e){ this.box.innerHTML=`<p class="muted">${esc(e.message||e)}</p>`; return; } this.render(); this.bind(); this.poll(); }
  render(note){ const s=this.s, L=s.last||{};
    const last=L.at?(L.ok?`<b class="ok-t">✓ ${esc(stTime(L.at))}</b>${L.bytes?' · '+stSize(L.bytes):''}${L.images?` · изображений: ${stNum(L.images.total)}, новых скопировано: ${stNum(L.images.copied)}`:''}`
      :`<b class="bad-t">✕ ${esc(stTime(L.at))}: ${esc(L.error||'ошибка')}</b>`):'<span class="muted">копий ещё не было</span>';
    this.box.innerHTML=`<div class="row"><p class="sub" style="margin:0">Вторая папка для копий базы</p><span class="sp"></span>
        <label class="sw"><input type="checkbox" id="mbOn"${s.on?' checked':''} data-nodirty><span>${s.on?'включена':'выключена'}</span></label></div>
      <p class="muted">Копии в data\\backup лежат на том же диске, что и база: откажет диск — пропадёт всё. Укажите вторую папку на другом устройстве: сетевой диск (\\\\сервер\\копии), флешку или папку Яндекс Диска / OneDrive. Каждый день после обычной копии файл базы копируется туда и проверяется.</p>
      ${note?`<p class="msg${note.err?' err':''}" style="text-align:left">${esc(note.t)}</p>`:''}
      <div class="grid g2"><label class="f"><span>Папка</span><input type="text" id="mbPath" value="${esc(s.path||'')}" placeholder="D:\\Копии КП или \\\\сервер\\копии" autocomplete="off"></label>
        <label class="f"><span>Хранить копий (последних дней)</span><input type="number" id="mbKeep" min="1" max="365" value="${esc(s.keep||14)}"></label></div>
      <label class="ck"><input type="checkbox" id="mbImg"${s.images?' checked':''}> Копировать туда и изображения каталога (только новые и изменённые)</label>
      <p>Последняя копия: ${s.running?'<b>идёт копирование…</b>':last}${s.copies?` · в папке копий: ${s.copies} (${stSize(s.copiesBytes)})`:''}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-mb="save">Сохранить</button><button class="btn" type="button" data-mb="check">Проверить папку</button>
        <button class="btn" type="button" data-mb="run"${s.on&&!s.running?'':' disabled'}>Копировать сейчас</button></div>`; }
  body(){ return {on:$('#mbOn').checked, path:$('#mbPath').value.trim(), keep:+$('#mbKeep').value||14, images:$('#mbImg').checked}; }
  poll(){ clearTimeout(this.t); if (!this.s.running) return;
    this.t=setTimeout(async()=>{ if (!document.body.contains(this.box)) return; try{ this.s=await aapi('maint/mirror'); }catch(e){ return; }
      this.render(this.s.running?null:{t:this.s.last&&this.s.last.ok?'Копия во вторую папку готова':'Копия не сделана: '+((this.s.last||{}).error||''), err:!(this.s.last&&this.s.last.ok)}); this.poll(); }, 2500); }
  bind(){
    this.box.onchange=async e=>{ if (e.target.id!=='mbOn') return; try{ this.s=await ajson('maint/mirror', this.body()); this.render({t:this.s.on?'Вторая папка включена':'Вторая папка выключена'}); }
      catch(err){ this.render({t:err.message||String(err), err:true}); } };
    this.box.onclick=async e=>{ const b=e.target.closest('[data-mb]'); if (!b) return; const a=b.dataset.mb;
      try{
        if (a==='save'){ this.s=await ajson('maint/mirror', {...this.body(), on:true}); this.render({t:'Сохранено. Копия будет делаться каждый день.'}); }
        if (a==='check'){ const r=await ajson('maint/mirror/check', {path:$('#mbPath').value.trim()}); this.render({t:`Папка доступна для записи${r.free!=null?', свободно '+stSize(r.free):''}.`}); }
        if (a==='run'){ this.s=await ajson('maint/mirror/run', {}); this.render(); this.poll(); }
      }catch(err){ this.render({t:err.message||String(err), err:true}); } };
  }
}
