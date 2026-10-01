# -*- coding: utf-8 -*-
"""Обновление каталога под новую структуру категорий — один раз, при первом запуске новой версии.

База не заменяется: перед изменениями делается копия (data/backup/…), затем правятся только записи каталога
и свои типы оборудования. Что сделано — записывается в базу (kv «migrations») и в журнал запуска.

1. Категории. Позиции переносятся в новые встроенные категории по названию: дизельные и спиральные компрессоры,
   осушители рефрижераторные и адсорбционные, магистральные фильтры, ресиверы, запасные части. Позиции из своих
   категорий отдела с тем же смыслом («Спиральные компрессоры», «Осушители воздуха»…) переходят во встроенные,
   а сами свои категории убираются. Позиции без категории получают её по названию.
2. Параметры. Пустые параметры категории заполняются из таблицы характеристик (поле find в equipment_types.json)
   и из названия (объём ресивера, исполнение спирального компрессора…). Заполненные вручную значения не меняются.
3. Фото. Ссылки на изображения галереи, файлов которых нет, убираются. Позиция без фото (или с потерянным файлом фото) получает фото похожей модели той же категории и того же
   производителя (та же серия и исполнение, ближайшая мощность/производительность); позиция без логотипа — логотип
   своего производителя. Фото другого производителя не подставляется.
"""
import json
import math
import os
import re
from datetime import datetime

MIGRATION_ID = 'catalog-structure-2026-10'

# свои категории отдела, которые теперь есть среди встроенных (по названию категории)
USER_TYPE_MAP = [
    (r'адсорбц', 'dryer_ads'), (r'осушител', 'dryer_refrig'), (r'спиральн', 'comp_scroll'),
    (r'дизельн\S*\s+компрессор', 'comp_diesel'), (r'ресивер', 'receiver'), (r'магистральн\S*\s+фильтр', 'filter'),
    (r'запчаст|запасн|(^|\s)зип(\s|$)', 'spare'),
]
# встроенные категории, в которые позиции переносятся по названию даже из другой категории
SPECIFIC = {'comp_diesel', 'comp_scroll', 'dryer_ads', 'dryer_refrig', 'filter', 'receiver', 'spare'}
# откуда такой перенос допустим (общие категории, куда эти позиции раньше складывали)
GENERAL = {'', 'other', 'comp_screw', 'comp_piston'}

NUM = r'(\d+(?:[  ]\d{3})*(?:[.,]\d+)?)'
UNIT_RX = {
    'м³/мин': r'м[³3]\s*/\s*мин', 'л/мин': r'л\s*/\s*мин', 'кВт': r'квт', 'бар': r'(бар|атм|кгс)', 'л': r'л(?![а-я])',
    'кг': r'кг', 'дБ(А)': r'дб', 'мм': r'мм', '%': r'%', 'л/ч': r'л\s*/\s*ч', 'моточасов': r'(моточас|ч(?![а-я]))',
}


def _num(s):
    return float(re.sub(r'[  ]', '', s).replace(',', '.'))


def _clean(v):
    return int(v) if float(v).is_integer() else round(v, 3)


def parse_num(text, unit):
    """Число из значения таблицы характеристик с учётом единиц: «800 л/мин» → 0,8 для поля в м³/мин,
    «0,2 кВт / 220 В» → 0,2 для поля в кВт. Без подходящей единицы — первое число."""
    t = str(text or '').lower()
    if unit:
        rx = UNIT_RX.get(unit)
        if rx:
            m = re.search(NUM + r'\s*' + rx, t)
            if m:
                return _clean(_num(m.group(1)))
        if unit == 'м³/мин':
            m = re.search(NUM + r'\s*' + UNIT_RX['л/мин'], t)
            if m:
                return _clean(_num(m.group(1)) / 1000)
    m = re.search(NUM, t)
    return _clean(_num(m.group(1))) if m else None


def parse_text(text, f):
    v = re.sub(r'\s+', ' ', str(text or '')).strip()
    if f.get('key') == 'voltage':
        m = re.search(r'(\d{3})\s*в\b', v.lower())
        return m.group(1) if m else ''
    if f.get('key') == 'refrigerant':   # «R134a, 0,275 кг» → «R134a»: заправка хладагента в фильтр не нужна
        m = re.search(r'\bR-?\d{2,4}[A-Za-z]?\b', v)
        return m.group(0).replace('-', '') if m else v
    u = f.get('unit')
    if u and v.lower().endswith(u.lower()):
        v = v[:-len(u)].strip()
    return v[:120]


def rows_of(doc):
    for g in doc.get('groups') or []:
        for r in g.get('rows') or []:
            k, v = str(r.get('k') or '').strip(), str(r.get('v') or '').strip()
            if k and v:
                yield k, v


def detect(doc, types, with_dgu=False):
    """Категория по названию — как в программе (core/types.js detectCat): по порядку типов, ДГУ — последней.
    Сначала по наименованию и заголовку страницы; заголовок титула — только если по ним не определилось
    (он бывает скопирован от другой позиции)."""
    dgu = next((t for t in types if t.get('id') == 'dgu'), None)
    for text in (' '.join(str(x or '') for x in (doc.get('name'), doc.get('pageTitle'))), str((doc.get('hint') or {}).get('title') or '')):
        for t in types:
            if t.get('id') == 'dgu' or not t.get('match'):
                continue
            try:
                if re.search(t['match'], text, re.I):
                    return t['id']
            except re.error:
                pass
        if with_dgu and dgu and re.search(dgu.get('match') or '$^', text, re.I):
            return 'dgu'
    return ''


def fill_from_name(doc, cat, a):
    name = str(doc.get('name') or '')
    low = name.lower()

    def put(k, v):
        if v not in (None, '') and a.get(k) in (None, ''):
            a[k] = v
    if cat == 'receiver':
        m = re.search(NUM + r'\s*л(?![а-я])', low)
        put('volume', _clean(_num(m.group(1))) if m else None)
        m = re.search(r'/\s*(\d{1,2})\b', name)
        put('pressure', int(m.group(1)) if m else None)
        put('orient', 'Горизонтальный' if 'горизонт' in low else 'Вертикальный' if 'вертикал' in low else None)
    if cat == 'comp_scroll':
        put('execution', 'На ресивере с осушителем' if 'ресивер' in low and 'осушител' in low else 'На ресивере' if 'ресивер' in low else 'Стационарный')
        put('dryer', 'Да' if 'осушител' in low else 'Нет')
        put('oilFree', 'Да' if 'безмасл' in low or 'класс 0' in str(doc.get('spec') or '').lower() else None)
    if cat == 'comp_diesel':
        put('execution', 'На шасси' if 'шасси' in low or 'передвижн' in low else None)
    if cat in ('dryer_refrig', 'dryer_ads'):
        put('cooling', 'Водяное' if 'водян' in low else None)
    if cat == 'filter':
        m = re.search(r'фм\s*(\d+)\s*/\s*(\d+)', low)
        put('pressure', int(m.group(2)) if m else None)


def fill_attrs(doc, t, a):
    """Пустые параметры категории — из таблицы характеристик; возвращает число заполненных."""
    n = 0
    rows = list(rows_of(doc))
    for f in t.get('fields') or []:
        k, rx = f.get('key'), f.get('find')
        if not k or not rx or a.get(k) not in (None, ''):
            continue
        for rk, rv in rows:
            try:
                if not re.search(rx, rk, re.I):
                    continue
            except re.error:
                break
            v = parse_num(rv, f.get('unit')) if f.get('num') else parse_text(rv, f)
            if v not in (None, ''):
                a[k] = v
                n += 1
                break
    return n


def tidy_dgu(a):
    eng = str(a.get('engine') or '')
    m = re.match(r'^([A-Za-zА-Яа-я]+(?: [A-Za-z]+)?)\s+([A-Z0-9][A-Z0-9-]{3,})$', eng)
    if m and not a.get('engineModel') and re.search(r'\d', m.group(2)):
        a['engine'], a['engineModel'] = m.group(1), m.group(2)
    if str(a.get('execution') or '').strip().lower() == 'кожух':
        a['execution'] = 'В кожухе'


def photo_ok(p, img_dir):
    if not isinstance(p, dict) or not p.get('src'):
        return False
    src = str(p['src'])
    if src.startswith('/img/'):
        return os.path.isfile(os.path.join(img_dir, src[5:]))
    return True


def main_val(doc, t):
    a = doc.get('attrs') or {}
    v = a.get(t.get('main') or 'kw') if t else None
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def pick_donor(doc, t, pool):
    a = doc.get('attrs') or {}
    mv = main_val(doc, t)
    best, score = None, None
    for d in pool:
        da = d.get('attrs') or {}
        if not a.get('maker') or da.get('maker') != a.get('maker'):
            continue    # фото другого производителя не подставляем
        s = 0.0
        if a.get('series') and da.get('series') == a.get('series'):
            s += 4
        if a.get('execution') and da.get('execution') == a.get('execution'):
            s += 3
        dv = main_val(d, t)
        if mv and dv:
            s -= min(3.0, abs(math.log((dv + 1e-6) / (mv + 1e-6))))
        if score is None or s > score:
            best, score = d, s
    return best


def mark_done(store):
    done = store.kv_get('migrations') or []
    if not any(isinstance(m, dict) and m.get('id') == MIGRATION_ID for m in done):
        store.kv_set('migrations', done + [{'id': MIGRATION_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])


def run(store, types_builtin, types_user, img_dir, backup_dir, log=print):
    done = store.kv_get('migrations') or []
    if any(isinstance(m, dict) and m.get('id') == MIGRATION_ID for m in done):
        return None
    docs = json.loads(store.catalog_full() or '[]')
    if not docs:
        store.kv_set('migrations', done + [{'id': MIGRATION_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}}])
        return None

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = os.path.join(backup_dir, 'kp-%s-до-обновления-каталога.sqlite3' % stamp)
    store.backup(backup)

    # свои категории, которые теперь встроенные
    user_map, keep_user = {}, []
    for t in types_user or []:
        nm = str(t.get('name') or '')
        target = next((tid for rx, tid in USER_TYPE_MAP if re.search(rx, nm, re.I)), None)
        if target and not any(b.get('id') == t.get('id') for b in types_builtin):
            user_map[t['id']] = target if not (target == 'dryer_refrig' and re.search('адсорбц', nm, re.I)) else 'dryer_ads'
        else:
            keep_user.append(t)
    types = [t for t in types_builtin] + [t for t in keep_user if not any(b.get('id') == t.get('id') for b in types_builtin)]
    tmap = {t['id']: t for t in types}
    names = {t.get('id'): t for t in (types_user or [])}
    titles = {}
    for t in types:
        for k in (t.get('name'), t.get('coverTitle')):
            if k:
                titles.setdefault(k, t['id'])

    # производители, встречающиеся в каталоге: позиция без производителя получает его по названию
    makers = sorted({str((d.get('attrs') or {}).get('maker') or '').strip() for d in docs} - {''}, key=len, reverse=True)
    moved, filled, photos, logos, tidied, nophoto = {}, 0, 0, 0, 0, []
    changed = set()
    for d in docs:
        a = dict(d.get('attrs') or {})
        old = a.get('cat') or ''
        new = old
        if old in user_map:
            new = user_map[old]
            if new == 'dryer_refrig' and detect(d, types) == 'dryer_ads':
                new = 'dryer_ads'
        elif old not in tmap:
            new = detect(d, types, with_dgu=True) or 'other'
        else:
            det = detect(d, types)
            if det in SPECIFIC and det != old and old in GENERAL:
                new = det
        if new != old:
            a['cat'] = new
            key = '%s → %s' % ((tmap.get(old) or {}).get('name') or (names[old].get('name', old) + ' (своя категория)' if old in names else old) or 'без категории', tmap[new]['name'])
            moved[key] = moved.get(key, 0) + 1
        t = tmap.get(new)
        # заголовок титула от другой категории («Винтовые компрессоры» у ДГУ) — по категории позиции
        h = d.get('hint')
        if t and isinstance(h, dict) and h.get('title') in titles and titles[h['title']] != new:
            d['hint'] = dict(h, title=t.get('coverTitle') or t.get('name'))
            changed.add(d['id'])
        before = json.dumps(a, sort_keys=True, ensure_ascii=False)
        if not str(a.get('maker') or '').strip():
            mk = next((m for m in makers if re.search(r'(^|[\s«"(])' + re.escape(m) + r'($|[\s»",)])', str(d.get('name') or ''), re.I)), None)
            if mk:
                a['maker'] = mk
        if t:
            fill_from_name(d, new, a)
            filled += fill_attrs(d, t, a)
        if new == 'dgu':
            tidy_dgu(a)
        if json.dumps(a, sort_keys=True, ensure_ascii=False) != before or new != old:
            d['attrs'] = a
            changed.add(d['id'])

    # фото и логотипы по аналогии: та же категория и производитель
    by_cat = {}
    for d in docs:
        by_cat.setdefault((d.get('attrs') or {}).get('cat'), []).append(d)
    for d in docs:
        a = d.get('attrs') or {}
        t = tmap.get(a.get('cat'))
        if not photo_ok(d.get('photo'), img_dir):
            pool = [x for x in by_cat.get(a.get('cat'), []) if x is not d and photo_ok(x.get('photo'), img_dir) and not x.get('photoFrom')]
            donor = pick_donor(d, t, pool)
            if donor:
                d['photo'] = dict(donor['photo'])
                d['photoFrom'] = {'id': donor['id'], 'name': donor.get('name', '')}
                photos += 1
                changed.add(d['id'])
            else:
                nophoto.append(d.get('name', d['id']))
        if not photo_ok(d.get('logo'), img_dir) and a.get('maker'):
            cands = [x.get('logo') for x in docs if (x.get('attrs') or {}).get('maker') == a.get('maker') and photo_ok(x.get('logo'), img_dir)]
            if cands:
                srcs = [c['src'] for c in cands]
                top = max(set(srcs), key=srcs.count)
                d['logo'] = dict(next(c for c in cands if c['src'] == top))
                logos += 1
                changed.add(d['id'])

    # изображения галереи, файлов которых нет, — убираем (иначе документ КП не соберётся)
    gal_fixed = 0
    for d in docs:
        g = d.get('gallery') or []
        ok = [x for x in g if photo_ok(x, img_dir)]
        if len(ok) != len(g):
            d['gallery'] = ok
            gal_fixed += len(g) - len(ok)
            changed.add(d['id'])

    for d in docs:
        if d['id'] in changed:
            for k in ('_light', 'pricesCount', 'st'):
                d.pop(k, None)
            store.catalog_put(d['id'], json.dumps(d, ensure_ascii=False))
    if user_map:
        store.kv_set('types', {'version': 1, 'types': keep_user})

    report = {'moved': moved, 'attrsFilled': filled, 'photos': photos, 'logos': logos, 'galleryFixed': gal_fixed,
              'noPhoto': nophoto[:50], 'noPhotoCount': len(nophoto), 'changed': len(changed),
              'userTypesMerged': [t.get('name') for t in (types_user or []) if t.get('id') in user_map]}
    store.kv_set('migrations', done + [{'id': MIGRATION_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'backup': backup, 'report': report}])
    report = dict(report, backup=backup)
    log('Каталог обновлён под новые категории: изменено позиций %d, перенесено %d, параметров заполнено %d, фото %d, логотипов %d. Копия базы: %s'
        % (len(changed), sum(moved.values()), filled, photos, logos, backup))
    return report
