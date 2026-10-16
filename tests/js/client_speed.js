// Быстродействие интерфейса: разбор характеристик карточки каталога — один раз на карточку (CatAttrs, core/types.js),
// позиции КП — каждый раз; строка поиска окна подбора — один раз на карточку (PickFind, features/kit.js); черновик КП в
// браузере — большие картинки отдельными записями, пишутся один раз (LocalDraft, core/state.js).
// Запуск из корня репозитория: node tests/js/client_speed.js — код выхода 0, если всё прошло (tests/test_client_speed.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), JS=f=>fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', f), 'utf8');
// класс из файла целиком (файлы страницы тянут за собой весь интерфейс — берём только нужное)
const cls=(f, name)=>{ const s=JS(f), m=s.match(new RegExp('\\nclass '+name+' \\{[\\s\\S]*?\\n\\}\\n')); assert.ok(m, name+' в '+f); return m[0]; };
let ok=0; const t=(name, fn)=>{ fn(); ok++; console.log('ok', name); };

global.document={ addEventListener(){}, querySelector(){ return null; } }; global.window={ addEventListener(){} }; global.KPGen={ CURS:{} };
vm.runInThisContext(JS('core/util.js'), { filename:'util.js' });
vm.runInThisContext(JS('core/types.js'), { filename:'types.js' });
vm.runInThisContext(`TYPES=[{ id:'comp_screw', name:'Винтовой компрессор', match:'винтов', main:'kw', fields:[] }, { id:'other', name:'Прочее', fields:[] }];`);

t('карточка каталога: разбор один раз, копия — для правки', ()=>{
  const card={ id:'c1', name:'Компрессор винтовой Пример 15 кВт', attrs:{ maker:'Пример' } }, L=[card];
  CatAttrs.mark(L);
  const a=attrsOf(card); assert.strictEqual(a.cat, 'comp_screw'); assert.strictEqual(attrsOf(card), a, 'второй раз — тот же разбор');
  delete card._a; assert.notStrictEqual(attrsOf(card), a, 'окно каталога сбросило разбор — разбирается заново');
  assert.ok(/const a=\{ \.\.\.attrsOf\(doc\) \}/.test(JS('features/kit.js')), 'KitPart.fromCat дописывает габариты в копию разбора');
});
t('позиция КП (не карточка): разбор каждый раз, правка видна сразу', ()=>{
  const it={ name:'Компрессор винтовой', attrs:{ maker:'А' } };
  const a=attrsOf(it); it.attrs.maker='Б'; assert.notStrictEqual(attrsOf(it), a); assert.strictEqual(attrsOf(it).maker, 'Б'); assert.ok(!('_a' in it));
});
t('служебные поля разбора не уходят на сервер и в выгрузку', ()=>{
  for (const [f, rx] of [['features/catalog-cache.js', /delete y\._pq/], ['features/catalog-window.js', /delete x\._pq/], ['features/catalog-edit.js', /'_pq'/]])
    assert.ok(rx.test(JS(f)), f);
});

vm.runInThisContext(cls('features/kit.js', 'PickFind')+'\nglobal.PickFind=PickFind;');
t('окно подбора: строка поиска карточки — один раз, у позиции КП — каждый раз', ()=>{
  const card={ id:'c2', name:'Компрессор винтовой Remeza ВК 15' }; CatAttrs.mark([card]);
  const a=attrsOf(card), h=PickFind.hay(card, a); assert.ok(h.includes('remeza')); assert.strictEqual(card._pq, h);
  card.name='другое'; assert.strictEqual(PickFind.hay(card, a), h, 'карточка не меняется на месте — строка из памяти');
  const it={ name:'Remeza' }; PickFind.hay(it, attrsOf(it)); assert.ok(!('_pq' in it));
  assert.strictEqual(PickFind.key({ name:'Компрессор винтовой', attrs:{ kw:'15' } }), 15);
});

// черновик в браузере: localStorage в памяти, счётчик записей
const store=new Map(); let writes=[];
global.localStorage={ get length(){ return store.size; }, key:i=>[...store.keys()][i] ?? null, getItem:k=>store.has(k) ? store.get(k) : null,
  setItem:(k, v)=>{ writes.push(k); store.set(k, String(v)); }, removeItem:k=>store.delete(k) };
vm.runInThisContext(cls('core/state.js', 'LocalDraft')+'\nglobal.LocalDraft=LocalDraft;');
t('черновик: картинки отдельно и один раз, восстановление, чистка', ()=>{
  const big='data:image/jpeg;base64,'+'A'.repeat(50000), big2='data:image/png;base64,'+'B'.repeat(30000), small='data:image/png;base64,AAAA';
  const st={ items:[{ photo:{ src:big }, gallery:[{ src:big2 }, { src:small }] }], n:1 };
  LocalDraft.save(st); assert.strictEqual(writes.length, 3); assert.ok(store.get('kp.draft').length<500, 'в черновике — ссылки, не картинки');
  writes=[]; st.n=2; LocalDraft.save(st); assert.deepStrictEqual(writes, ['kp.draft'], 'правка без новых картинок — одна маленькая запись');
  LocalDraft.ids.clear(); const back=LocalDraft.load();
  assert.strictEqual(back.items[0].photo.src, big); assert.strictEqual(back.items[0].gallery[0].src, big2); assert.strictEqual(back.items[0].gallery[1].src, small); assert.strictEqual(back.n, 2);
  writes=[]; LocalDraft.save(back); assert.deepStrictEqual(writes, ['kp.draft'], 'после восстановления картинки не переписываются');
  back.items[0].gallery.shift(); LocalDraft.save(back);
  assert.strictEqual([...store.keys()].filter(k=>k.startsWith('kp.img.')).length, 1, 'убранная картинка удалена из браузера');
  store.set('kp.draft', JSON.stringify({ items:[{ photo:{ src:big } }] })); LocalDraft.ids.clear();
  assert.strictEqual(LocalDraft.load().items[0].photo.src, big, 'черновик прежних версий (картинки внутри) читается');
  LocalDraft.saveLite({ items:[] }); assert.strictEqual([...store.keys()].filter(k=>k.startsWith('kp.img.')).length, 0, 'черновик без фото — записи картинок убраны');
});
console.log(`client_speed: ${ok} проверок пройдено`);
