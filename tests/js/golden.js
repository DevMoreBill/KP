// Слепок результатов: обёртка над методами классов записывает отпечаток каждого вызова (sha1 канонического JSON —
// ключи по алфавиту, числа до 0,01) по порядку. Переписывание кода без изменения поведения даёт тот же слепок.
'use strict';
const crypto=require('crypto'), fs=require('fs');

class Golden {
  static rows=[];
  static label='';

  static canon(v){
    if (v==null || typeof v==='boolean' || typeof v==='string') return v;
    if (typeof v==='number') return Number.isFinite(v) ? Math.round(v*100)/100 : String(v);
    if (typeof v==='function') return undefined;
    if (Array.isArray(v)) return v.map(x=>Golden.canon(x));
    if (v instanceof Map) return Golden.canon(Object.fromEntries(v));
    if (v instanceof Set) return Golden.canon([...v]);
    return Object.fromEntries(Object.keys(v).sort().map(k=>[k, Golden.canon(v[k])]).filter(([, x])=>x!==undefined));
  }

  static hash(v){ return crypto.createHash('sha1').update(JSON.stringify(Golden.canon(v)) ?? '').digest('hex').slice(0, 16); }

  static wrap(cls, names){
    for (const name of names){
      const fn=cls[name]; let depth=0;
      cls[name]=function(...args){
        depth++;
        try{
          const out=fn.apply(this, args);
          if (depth===1){ Golden.rows.push([Golden.label, `${cls.name}.${name}`, Golden.hash(out)]);
            if (process.env.KP_GOLDEN_DUMP==String(Golden.rows.length-1)) fs.writeFileSync(process.env.KP_GOLDEN+'.dump', JSON.stringify(Golden.canon(out), null, 1)); }
          return out;
        } finally{ depth--; }
      };
    }
  }

  /** 3D-сцена: геометрия по материалам, наклейки и что где поставлено оснащением — отпечаток после build() */
  static wrapScene(cls){
    const fn=cls.prototype.build;
    cls.prototype.build=function(...args){
      const out=fn.apply(this, args);
      const g=[...this.groups].map(([k, e])=>[k, e.mesh.p, e.mesh.n, e.mesh.i, e.mesh.t]);
      Golden.rows.push([Golden.label, `${cls.name}.build`, Golden.hash({ g, d:[...this.decals.keys()], log:this.outfit ? this.outfit.log : null })]);
      return out;
    };
  }

  static save(file){ fs.writeFileSync(file, JSON.stringify(Golden.rows)); }
}

module.exports=Golden;
