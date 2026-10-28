(o)=>{
  const phone=o.phone, root=o.root;
  let rootEl=root?document.querySelector(root):null;
  if (!rootEl){ const ds=[...document.querySelectorAll('dialog[open]')]; rootEl=ds.length?ds[ds.length-1]:document.body; }
  const isBody=rootEl===document.body;
  const R=isBody?{left:0,right:innerWidth,top:0,bottom:1e9}:rootEl.getBoundingClientRect();
  const vis=e=>{ if(!e.getClientRects().length) return false; const cs=getComputedStyle(e); if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0) return false; if(e.closest('details:not([open]) > :not(summary)')) return false; return true; };
  const name=e=>{ let s=e.tagName.toLowerCase(); if(e.id) s+='#'+e.id; if(typeof e.className==='string'&&e.className.trim()) s+='.'+e.className.trim().split(/\s+/).slice(0,2).join('.'); for(const k of ['a','cw','sttab','step','nw','id','tab']) if(e.dataset&&e.dataset[k]!=null){ s+=`[data-${k}=${String(e.dataset[k]).slice(0,20)}]`; break; } return s; };
  const path=e=>{ const p=[]; let a=e; for(let k=0;k<3&&a&&a!==document.body;k++){ p.unshift(name(a)); a=a.parentElement; } return p.join('>'); };
  const txt=e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,40);
  const all=[...rootEl.querySelectorAll('*')].filter(e=>!e.closest('svg')||e.tagName==='svg');
  const out=[], btnTxt=[], small=[], font=[], contrast=[], overlap=[], img=[];
  // 1. выход за границы окна/экрана (не внутри прокручиваемого контейнера)
  for(const e of all){ if(['OPTION','SCRIPT','STYLE','DATALIST','BR'].includes(e.tagName)||!vis(e)) continue; const r=e.getBoundingClientRect(); if(r.width<2||r.height<2) continue;
    let a=e.parentElement, sc=false; while(a&&a!==rootEl){ const cs=getComputedStyle(a); if(/(auto|scroll|hidden|clip)/.test(cs.overflowX)){ sc=true; break; } a=a.parentElement; }
    if(sc) continue; const cs=getComputedStyle(e); if(cs.position==='fixed'&&!isBody) continue;
    const lim=isBody?innerWidth:R.right; if(r.right>lim+2||r.left<(isBody?0:R.left)-2) out.push(path(e)+` «${txt(e)}» [${Math.round(r.left)}..${Math.round(r.right)} / ${Math.round(isBody?0:R.left)}..${Math.round(lim)}]`); }
  // 2. текст вылезает из кнопки
  for(const e of rootEl.querySelectorAll('button,.btn,summary,a.btn,[role=button],.chip,.tab')){ if(!vis(e)) continue; const cs=getComputedStyle(e);
    // декоративный значок (absolute, без нажатия) под overflow:hidden — не текст: на время замера убрать
    const deco=[...e.querySelectorAll('*')].filter(c=>{ const k=getComputedStyle(c); return k.position==='absolute'&&k.pointerEvents==='none'; }); deco.forEach(c=>{ c.dataset.ckD=c.style.display; c.style.display='none'; });
    try{
    if(e.scrollWidth>e.clientWidth+2 && cs.textOverflow!=='ellipsis') btnTxt.push(path(e)+` «${txt(e)}» w ${e.scrollWidth}>${e.clientWidth}`);
    else if(e.scrollHeight>e.clientHeight+3 && cs.overflowY!=='visible' ) btnTxt.push(path(e)+` «${txt(e)}» h ${e.scrollHeight}>${e.clientHeight}`);
    else { // детский текст за пределами кнопки
      const r=e.getBoundingClientRect(); for(const c of e.children){ if(!vis(c)) continue; const q=c.getBoundingClientRect(); if(q.width>0&&(q.right>r.right+2||q.left<r.left-2||q.bottom>r.bottom+2)){ btnTxt.push(path(e)+` «${txt(e)}» child ${name(c)} out`); break; } } } }
    finally{ deco.forEach(c=>{ c.style.display=c.dataset.ckD; delete c.dataset.ckD; }); } }
  // 3. телефон: размер области нажатия и шрифт полей
  if(phone){ for(const e of rootEl.querySelectorAll('button,a[href],input,select,textarea,summary,[role=button],[data-a],[tabindex="0"]')){
      if(!vis(e)||e.type==='hidden'||e.disabled) continue; let t=e; if((e.type==='checkbox'||e.type==='radio'||e.type==='file')&&e.closest('label')) t=e.closest('label');
      const r=t.getBoundingClientRect(); if(r.width<1||r.height<1) continue; if(r.bottom<0) continue;
      if(r.width<44-0.5||r.height<44-0.5) small.push(`${path(t)} «${txt(t)}» ${Math.round(r.width)}×${Math.round(r.height)}`); }
    for(const e of rootEl.querySelectorAll('input,select,textarea')){ if(!vis(e)||['hidden','checkbox','radio','range','color','file','button','submit'].includes(e.type)) continue; const fs=parseFloat(getComputedStyle(e).fontSize); if(fs<16) font.push(`${path(e)} ${fs}px`); } }
  // 4. контраст текста
  const parse=c=>{ const m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const v=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0],v[1],v[2],v.length>3?v[3]:1]; };
  const lum=c=>{ const f=x=>{x/=255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
  const bgOf=e=>{ let layers=[]; for(let a=e;a;a=a.parentElement){ const cs=getComputedStyle(a); if(cs.backgroundImage&&cs.backgroundImage!=='none'&&!/url\(/.test(cs.backgroundImage)) return null; const c=parse(cs.backgroundColor); if(c&&c[3]>0){ layers.push(c); if(c[3]>=0.99) break; } }
    let base=[255,255,255]; if(document.documentElement.dataset.theme==='dark'||matchMedia('(prefers-color-scheme: dark)').matches){ const bc=parse(getComputedStyle(document.body).backgroundColor); if(bc) base=bc; }
    for(let i=layers.length-1;i>=0;i--){ const c=layers[i]; if(i===layers.length-1&&c[3]>=0.99){ base=c.slice(0,3); continue; } base=base.map((b,k)=>b*(1-c[3])+c[k]*c[3]); } return base; };
  const seenC=new Set();
  for(const e of all){ if(!vis(e)||e.closest('svg,canvas,.docx-wrapper,.docx,.pv-doc,iframe,.brand')) continue; const own=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1); if(!own) continue;
    if(e.disabled||e.closest('[disabled],.off,.disabled')) continue; const cs=getComputedStyle(e); const fg=parse(cs.color); if(!fg) continue; const bg=bgOf(e); if(!bg) continue;
    let op=1; for(let a=e;a;a=a.parentElement) op*=+getComputedStyle(a).opacity; const f=fg.slice(0,3).map((v,k)=>v*fg[3]*op+bg[k]*(1-fg[3]*op));
    const L1=lum(f),L2=lum(bg), cr=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); const fs=parseFloat(cs.fontSize), big=fs>=24||(fs>=18.6&&+cs.fontWeight>=700);
    const need=big?3:4.5; if(cr<need){ const k=name(e)+'|'+cs.color; if(seenC.has(k)) continue; seenC.add(k); contrast.push(`${path(e)} «${txt(e)}» ${cr.toFixed(2)}:1 (${cs.color} на rgb(${bg.map(Math.round)})) ${fs}px`); } }
  // 5. наложение интерактивных элементов
  const pop=e=>{ for(let a=e.parentElement,k=0;a&&k<5;a=a.parentElement,k++){ const cs=getComputedStyle(a); if((cs.position==='absolute'||cs.position==='fixed')&&a.getBoundingClientRect().height>60&&a.tagName!=='DIALOG') return true; } return false; };
  const ints=[...rootEl.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary')].filter(e=>vis(e)&&!e.closest('.cw-split')&&!pop(e));
  // видимая часть: прокрутка и overflow предков обрезают элемент (под нижним краем прокрутки он не «наложен» на кнопку снаружи)
  const clip=e=>{ const r=e.getBoundingClientRect(); let L=r.left,T=r.top,Rt=r.right,B=r.bottom; for(let a=e.parentElement;a&&a!==document.documentElement;a=a.parentElement){ const cs=getComputedStyle(a); if(cs.overflowX==='visible'&&cs.overflowY==='visible') continue; const q=a.getBoundingClientRect(); L=Math.max(L,q.left); T=Math.max(T,q.top); Rt=Math.min(Rt,q.right); B=Math.min(B,q.bottom); } return {left:L,top:T,right:Rt,bottom:B}; };
  const rs=ints.map(clip);
  // закреплённая панель (sticky): содержимое проходит под ней при прокрутке — наложение, только если его нельзя прокрутить выше
  const bar=e=>{ for(let a=e,k=0;a&&k<4;a=a.parentElement,k++) if(getComputedStyle(a).position==='sticky') return a; return null; };
  const scroller=e=>{ for(let a=e.parentElement;a;a=a.parentElement){ const cs=getComputedStyle(a); if(/auto|scroll/.test(cs.overflowY)&&a.scrollHeight>a.clientHeight) return a; } return document.scrollingElement; };
  const under=(e,h,stick)=>{ const s=scroller(e); return s.contains(stick)&&s.scrollHeight-s.clientHeight-s.scrollTop>=h; };
  const passes=(a,b,h)=>{ const ba=bar(a), bb=bar(b); if(!ba===!bb) return false; return ba?under(b,h,ba):under(a,h,bb); };
  for(let i=0;i<ints.length;i++) for(let j=i+1;j<ints.length;j++){ const a=ints[i],b=ints[j]; if(a.contains(b)||b.contains(a)) continue; const p=rs[i],q=rs[j];
    const w=Math.min(p.right,q.right)-Math.max(p.left,q.left), h=Math.min(p.bottom,q.bottom)-Math.max(p.top,q.top); if(w>3&&h>3&&!passes(a,b,h)){
      const cx=Math.max(p.left,q.left)+w/2, cy=Math.max(p.top,q.top)+h/2; if(cy<0||cy>innerHeight) { overlap.push(`${path(a)} «${txt(a)}» ⟂ ${path(b)} «${txt(b)}» ${Math.round(w)}×${Math.round(h)} (вне экрана)`); continue; }
      const top=document.elementFromPoint(cx,cy); overlap.push(`${path(a)} «${txt(a)}» ⟂ ${path(b)} «${txt(b)}» ${Math.round(w)}×${Math.round(h)} сверху: ${top?name(top):'-'}`); } }
  // 6. картинки: обрезка (object-fit: cover / растянуто) и не загрузилось
  for(const e of rootEl.querySelectorAll('img')){ if(!vis(e)) continue; const r=e.getBoundingClientRect(); if(r.width<8) continue; const cs=getComputedStyle(e);
    if(e.complete&&e.naturalWidth===0&&e.getAttribute('src')){ img.push(`${path(e)} не загрузилась: ${(e.getAttribute('src')||'').slice(0,80)}`); continue; }
    if(!e.naturalWidth||(e.naturalWidth<=2&&e.naturalHeight<=2)) continue; // заглушка 1×1 до загрузки — не картинка
    // повёрнутый на 90° лист (transform у картинки или предка): рамка на экране — с переставленными сторонами
    let turned=false; for(let a=e,k=0;a&&k<4;a=a.parentElement,k++){ const t=getComputedStyle(a).transform; const m=t&&t!=='none'?t.match(/matrix\(([^,]+),/):null; if(m&&Math.abs(+m[1])<0.01){ turned=!turned; } }
    const ar=e.naturalWidth/e.naturalHeight, br=turned?r.height/r.width:r.width/r.height;
    if(Math.abs(ar/br-1)>0.04 && (cs.objectFit==='cover'||cs.objectFit==='fill')) img.push(`${path(e)} object-fit:${cs.objectFit} ${e.naturalWidth}×${e.naturalHeight} → ${Math.round(r.width)}×${Math.round(r.height)}`);
    let a=e.parentElement; for(let k=0;k<4&&a;k++,a=a.parentElement){ const ps=getComputedStyle(a); if(/(auto|scroll)/.test(ps.overflow)) break; if(/(hidden|clip)/.test(ps.overflow)){ const q=a.getBoundingClientRect(); if(r.right>q.right+2||r.bottom>q.bottom+2||r.left<q.left-2||r.top<q.top-2){ img.push(`${path(e)} обрезана рамкой ${name(a)} (${Math.round(r.width)}×${Math.round(r.height)} в ${Math.round(q.width)}×${Math.round(q.height)})`);} break; } } }
  const dlgs=[...document.querySelectorAll('dialog[open]')].map(d=>({id:d.id||d.className, len:(d.innerText||'').trim().length, h:Math.round(d.getBoundingClientRect().height), w:Math.round(d.getBoundingClientRect().width), top:Math.round(d.getBoundingClientRect().top), bottom:Math.round(d.getBoundingClientRect().bottom)}));
  const U=a=>[...new Set(a)];
  return {root:name(rootEl), docScroll:document.scrollingElement.scrollWidth>innerWidth+1?document.scrollingElement.scrollWidth:0, out:U(out).slice(0,25), btnTxt:U(btnTxt).slice(0,25), small:U(small), font:U(font), contrast:contrast.slice(0,40), overlap:U(overlap).slice(0,25), img:U(img).slice(0,20), dlgs, vw:innerWidth, vh:innerHeight};
}
