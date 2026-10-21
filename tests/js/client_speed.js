// Быстродействие интерфейса: разбор характеристик карточки каталога — один раз на карточку (CatAttrs, core/item-attrs.js),
// позиции КП — каждый раз; строка поиска окна подбора — один раз на карточку (PickFind, features/kit/kit-pick.js); черновик КП в
// браузере — большие картинки отдельными записями, пишутся один раз (LocalDraft, core/state.js).
// Запуск из корня репозитория: node tests/js/client_speed.js — код выхода 0, если всё прошло (tests/test_client_speed.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), JS=f=>fs.readFileSync(path.join(ROOT, 'app', 'web', 'js', f), 'utf8');
let ok=0; const t=(name, fn)=>{ fn(); ok++; console.log('ok', name); };

const WebScripts=require('./web.js');
WebScripts.load(path.join(ROOT, 'app', 'web', 'js', 'core', 'index.js'));
EquipTypes.list=[{ id:'comp_screw', name:'Винтовой компрессор', match:'винтов', main:'kw', fields:[] }, { id:'other', name:'Прочее', fields:[] }];
EquipTypes.builtin=null;

t('карточка каталога: разбор один раз, копия — для правки', ()=>{
  const card={ id:'c1', name:'Компрессор винтовой Пример 15 кВт', attrs:{ maker:'Пример' } }, L=[card];
  CatAttrs.mark(L);
  const a=Attrs.of(card); assert.strictEqual(a.cat, 'comp_screw'); assert.strictEqual(Attrs.of(card), a, 'второй раз — тот же разбор');
  delete card._a; assert.notStrictEqual(Attrs.of(card), a, 'окно каталога сбросило разбор — разбирается заново');
  assert.ok(/const attrs = \{ \.\.\.Attrs\.of\(doc\) \};/.test(JS('features/kit/kit-part.js')), 'KitPart.fromCat дописывает габариты в копию разбора');
});
t('позиция КП (не карточка): разбор каждый раз, правка видна сразу', ()=>{
  const it={ name:'Компрессор винтовой', attrs:{ maker:'А' } };
  const a=Attrs.of(it); it.attrs.maker='Б'; assert.notStrictEqual(Attrs.of(it), a); assert.strictEqual(Attrs.of(it).maker, 'Б'); assert.ok(!('_a' in it));
});
t('служебные поля разбора не уходят на сервер и в выгрузку', ()=>{
  for (const [f, rx] of [['features/catalog/catalog-cache.js', /delete copy\._pq/], ['features/catalog/catalog-actions.js', /CatalogCache\.clean\(card\)/], ['features/catalog/catalog-edit.js', /'_pq'/]])
    assert.ok(rx.test(JS(f)), f);
});

t('окно подбора: строка поиска карточки — один раз, у позиции КП — каждый раз', ()=>{
  const card={ id:'c2', name:'Компрессор винтовой Remeza ВК 15' }; CatAttrs.mark([card]);
  const a=Attrs.of(card), h=PickFind.hay(card, a); assert.ok(h.includes('remeza')); assert.strictEqual(card._pq, h);
  card.name='другое'; assert.strictEqual(PickFind.hay(card, a), h, 'карточка не меняется на месте — строка из памяти');
  const it={ name:'Remeza' }; PickFind.hay(it, Attrs.of(it)); assert.ok(!('_pq' in it));
  assert.strictEqual(PickFind.key({ name:'Изделие', attrs:{ cat:'other', kw:'15' } }), 15, 'не компрессор — по главному параметру'); assert.strictEqual(PickFind.key({ name:'Компрессор винтовой', attrs:{ cat:'comp_screw', flow:'2,5' } }), TzPick.flow({ attrs:{ cat:'comp_screw', flow:'2,5' } }), 'компрессор — по производительности');
});

// черновик в браузере: localStorage в памяти, счётчик записей
const store=new Map(); let writes=[];
global.localStorage={ get length(){ return store.size; }, key:i=>[...store.keys()][i] ?? null, getItem:k=>store.has(k) ? store.get(k) : null,
  setItem:(k, v)=>{ writes.push(k); store.set(k, String(v)); }, removeItem:k=>store.delete(k) };
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
