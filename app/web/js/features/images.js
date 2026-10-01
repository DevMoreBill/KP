// Изображения: подготовка фото и схем, галерея позиции.
'use strict';

function pickImage(kind,i){ const f=$('#filePick'); f.value=''; f.onchange=()=>f.files[0]&&loadImage(f.files[0],kind,i); f.click(); }

function readImg(src){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }); }

function fileToURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }

async function prepImage(src, kind){
  const im=await readImg(src); const max=1600, sc=Math.min(1, max/Math.max(im.width,im.height));
  let w=Math.round(im.width*sc), h=Math.round(im.height*sc);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.drawImage(im,0,0,w,h);
  // обрезка белых/прозрачных полей
  const d=g.getImageData(0,0,w,h).data; let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y+=1) for(let x=0;x<w;x+=1){ const o=(y*w+x)*4; if (d[o+3]>20 && (d[o]<240||d[o+1]<240||d[o+2]<240)){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
  let out=c;
  if (x1>x0 && y1>y0){ const pad=Math.round(Math.max(w,h)*0.015); x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad); x1=Math.min(w-1,x1+pad); y1=Math.min(h-1,y1+pad);
    out=document.createElement('canvas'); out.width=x1-x0+1; out.height=y1-y0+1; const og=out.getContext('2d');
    if (kind!=='logo'){ og.fillStyle='#fff'; og.fillRect(0,0,out.width,out.height); }
    og.drawImage(c,-x0,-y0); }
  const type = kind==='logo' ? 'image/png' : 'image/jpeg';
  return { src: out.toDataURL(type, 0.9), w: out.width, h: out.height };
}

async function loadImage(file, kind, i){
  if (!file.type.startsWith('image/')) return toast('Нужен файл изображения: JPG, PNG или WEBP');
  try { const img=await prepImage(await fileToURL(file), kind); S.items[i][kind]=img; renderForm(); persist(); }
  catch(e){ toast('Не удалось открыть изображение'); }
}

function tileFrom(img){ // скруглённая плитка для страницы оборудования
  return readImg(img.src).then(im=>{
    const W=1300,H=860,c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
    const rr=(x,y,w,h,r)=>{ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); };
    g.fillStyle='#CFE0F2'; rr(0,0,W,H,28); g.fill(); g.fillStyle='#FFFFFF'; rr(3,3,W-6,H-6,26); g.fill();
    const sc=Math.min((W-180)/im.width,(H-160)/im.height), w=im.width*sc, h=im.height*sc; g.drawImage(im,(W-w)/2,(H-h)/2,w,h);
    return { url:c.toDataURL('image/png'), w:W, h:H };
  });
}

const WIDE_RX=/схем|чертёж|чертеж|характеристик|диаграм|график/i;

const galWide=g=> g.wide==='full' ? true : g.wide==='half' ? false : (WIDE_RX.test(g.caption||g.slot||'') || (g.w/g.h)>2.6);

async function prepGallery(file){
  const url=await fileToURL(file); const im=await readImg(url);
  const max=2000, sc=Math.min(1,max/Math.max(im.width,im.height)); const w=Math.round(im.width*sc), h=Math.round(im.height*sc);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,w,h); g.drawImage(im,0,0,w,h);
  // обрезать белые поля
  const d=g.getImageData(0,0,w,h).data; let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y+=2) for(let x=0;x<w;x+=2){ const o=(y*w+x)*4; if(d[o]<242||d[o+1]<242||d[o+2]<242){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
  let out=c;
  if (x1>x0&&y1>y0){ const pad=Math.round(Math.max(w,h)*0.01); x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad); x1=Math.min(w-1,x1+pad+1); y1=Math.min(h-1,y1+pad+1);
    out=document.createElement('canvas'); out.width=x1-x0+1; out.height=y1-y0+1; const og=out.getContext('2d'); og.fillStyle='#fff'; og.fillRect(0,0,out.width,out.height); og.drawImage(c,-x0,-y0); }
  const png = file.type==='image/png' || file.type==='image/gif' || file.type==='image/bmp';
  return { src: out.toDataURL(png?'image/png':'image/jpeg', 0.9), w: out.width, h: out.height };
}

async function addGallery(i, files, slot){
  const it=S.items[i]; it.gallery=it.gallery||[]; let n=0;
  for (const f of files){ if (!f.type.startsWith('image/')) continue;
    try{ const im=await prepGallery(f); it.gallery.push({id:uid(), ...im, caption:slot||'', slot:slot||'', at:'', on:true}); n++; slot=''; }catch(e){} }
  if (!n) return toast('Нужен файл изображения: JPG, PNG, WEBP');
  it.page=true; it._open=true; renderForm(); persist(); toast(n>1?`Добавлено изображений: ${n}`:'Изображение добавлено');
}

function pickGallery(i, slot){ const f=$('#filePick'); f.value=''; f.multiple=!slot; f.onchange=()=>{ const L=[...f.files]; f.multiple=false; if(L.length) addGallery(i,L,slot); }; f.click(); }

document.addEventListener('paste', e=>{
  const fz=document.activeElement?.closest?.('[data-fimg]');
  if (fz){ const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/')); if(files.length){ e.preventDefault(); addFeatImage(+fz.dataset.fimg, fz.dataset.fid, files); } return; }
  const z=document.activeElement?.closest?.('[data-gal]'); if(!z) return;
  const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/')); if(!files.length) return;
  e.preventDefault(); addGallery(+z.dataset.gal, files, '');
});
