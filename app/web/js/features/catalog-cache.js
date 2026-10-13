'use strict';
// Каталог в браузере для 20 000+ позиций: облегчённые карточки хранятся в IndexedDB вместе с номером последнего изменения
// (seq) и меткой поколения базы (epoch). При запуске и после правок программа спрашивает у сервера только изменённое
// (/api/catalog/sync?since=…): сохранение КП или правка одной позиции — это несколько карточек, а не весь каталог.
// Без IndexedDB (приватный режим) — каталог целиком с сервера, как раньше.

class CatalogCache {
  static DB = 'kp-catalog';
  static STORE = 'snap';
  static KEY = 'cat';
  static snap = null;          // {epoch, seq, items}
  static _t = 0;

  static _db(){
    if (this._dbp) return this._dbp;
    this._dbp = new Promise((res, rej)=>{
      if (!window.indexedDB) return rej(new Error('нет IndexedDB'));
      const r = indexedDB.open(this.DB, 1);
      r.onupgradeneeded = ()=>{ r.result.createObjectStore(this.STORE); };
      r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); r.onblocked = ()=>rej(new Error('IndexedDB занята'));
    }).catch(e=>{ this._dbp=null; throw e; });
    return this._dbp;
  }

  static async _read(){
    try{ const db=await this._db();
      return await new Promise(res=>{ const q=db.transaction(this.STORE).objectStore(this.STORE).get(this.KEY); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }); }
    catch(e){ return null; }
  }

  /** сохранить в IndexedDB — с задержкой и в свободное время (запись 20 000 карточек — заметная работа) */
  static _save(){
    clearTimeout(this._t);
    this._t = setTimeout(()=>(window.requestIdleCallback||setTimeout)(async()=>{
      const s=this.snap; if (!s) return;
      try{ const db=await this._db(); const tx=db.transaction(this.STORE, 'readwrite'); tx.objectStore(this.STORE).put({epoch:s.epoch, seq:s.seq, items:s.items.map(this.clean)}, this.KEY); }
      catch(e){ /* нет места или приватный режим — каталог просто загрузится с сервера в следующий раз */ }
    }), 1500);
  }

  /** карточка без служебных полей окна каталога (они пересчитываются) */
  static clean(x){ if (!x._a && !x._hay && !x._nv && !x._sup && !x._pq) return x; const y={...x}; delete y._a; delete y._hay; delete y._nv; delete y._sup; delete y._pq; return y; }

  /** применить изменения: заменить и добавить карточки, убрать удалённые */
  static apply(snap, r){
    if (!r.items.length && !r.gone.length) return {...snap, seq:r.seq};
    const gone=new Set(r.gone), byId=new Map(r.items.map(x=>[x.id, x]));
    const items=[];
    for (const x of snap.items){ if (gone.has(x.id)) continue; const n=byId.get(x.id); if (n){ items.push(n); byId.delete(x.id); } else items.push(x); }
    for (const x of byId.values()) items.push(x);
    if (byId.size) items.sort((a,b)=>CatalogCache.COLL.compare(String(a.name||''), String(b.name||'')));
    return {epoch:r.epoch, seq:r.seq, items};
  }
  static COLL = new Intl.Collator('ru');

  /** облегчённые карточки каталога: из памяти или IndexedDB + изменения с сервера */
  static async load(){
    let s = this.snap || await this._read();
    const q = s && s.seq ? `?since=${s.seq}&epoch=${encodeURIComponent(s.epoch||'')}` : '?since=0';
    const r = await api('/api/catalog/sync'+q);
    const changed = r.full || r.items.length || r.gone.length || !s || s.seq!==r.seq;
    s = r.full ? {epoch:r.epoch, seq:r.seq, items:r.items} : this.apply(s, r);
    this.snap = s;
    if (changed) this._save();
    return s.items;
  }

  /** забыть сохранённое (например, после замены базы) */
  static async forget(){ this.snap=null; try{ const db=await this._db(); db.transaction(this.STORE,'readwrite').objectStore(this.STORE).delete(this.KEY); }catch(e){ /* нет IndexedDB */ } }
}

// поиск по характеристикам — на сервере: id позиций, где есть все слова запроса (браузер ищет сам по названию, модели, артикулу)
class CatalogSearch {
  static cache = new Map();      // запрос → Set(id); последние 30
  static key(q){ return norm(q||'').trim(); }
  static has(q){ return this.cache.has(this.key(q)); }
  static ids(q){ return this.cache.get(this.key(q)) || null; }
  static async ask(q){
    const k=this.key(q); if (k.replace(/\s/g,'').length<2) return null;
    if (this.cache.has(k)) return this.cache.get(k);
    try{ const r=await api('/api/catalog/search?q='+encodeURIComponent(k)); const s=new Set(r.ids||[]);
      this.cache.set(k, s); if (this.cache.size>30) this.cache.delete(this.cache.keys().next().value); return s; }
    catch(e){ return null; }
  }
  static drop(){ this.cache.clear(); }
}
