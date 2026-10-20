"""Однократный перенос каталога в новую структуру категорий (с копией базы перед изменениями)."""

import json
import math
import os
import re
from collections.abc import Iterator
from datetime import datetime

MIGRATION_ID = 'catalog-structure-2026-10'

# свои категории отдела, которые теперь есть среди встроенных (по названию категории)
USER_TYPE_MAP = [
    (r'адсорбц', 'dryer_ads'),
    (r'осушител', 'dryer_refrig'),
    (r'спиральн', 'comp_scroll'),
    (r'дизельн\S*\s+компрессор', 'comp_diesel'),
    (r'ресивер', 'receiver'),
    (r'магистральн\S*\s+фильтр', 'filter'),
    (r'запчаст|запасн|(^|\s)зип(\s|$)', 'spare'),
]
# встроенные категории, в которые позиции переносятся по названию даже из другой категории
SPECIFIC = {'comp_diesel', 'comp_scroll', 'dryer_ads', 'dryer_refrig', 'filter', 'receiver', 'spare'}
# откуда такой перенос допустим (общие категории, куда эти позиции раньше складывали)
GENERAL = {'', 'other', 'comp_screw', 'comp_piston'}

NUM = r'(\d+(?:[  ]\d{3})*(?:[.,]\d+)?)'
UNIT_RX = {
    'м³/мин': r'м[³3]\s*/\s*мин',
    'л/мин': r'л\s*/\s*мин',
    'кВт': r'квт',
    'бар': r'(бар|атм|кгс)',
    'л': r'л(?![а-я])',
    'м³/ч': r'м[³3]\s*/\s*ч(?:ас)?(?![а-я])',
    'кг': r'кг',
    'дБ(А)': r'дб',
    'мм': r'мм',
    '%': r'%',
    'л/ч': r'л\s*/\s*ч',
    'моточасов': r'(моточас|ч(?![а-я]))',
}


CONVERT = {
    'м³/мин': (('л/мин', 0.001), ('м³/ч', 1 / 60)),
    'л/мин': (('м³/мин', 1000), ('м³/ч', 1000 / 60)),
    'м³/ч': (('м³/мин', 60), ('л/мин', 0.06)),
}


def _num(text) -> float:
    return float(re.sub(r'[  ]', '', text).replace(',', '.'))


def _clean(v) -> float:
    return int(v) if float(v).is_integer() else round(v, 3)


def parse_num(text, unit) -> float | None:
    """Число из значения характеристики с учётом единиц: «800 л/мин» → 0,8 для поля в м³/мин."""
    low = str(text or '').lower()
    if unit:
        regex = UNIT_RX.get(unit)
        if regex:
            match = re.search(NUM + r'\s*' + regex, low)
            if match:
                return _clean(_num(match.group(1)))
        for src, k in CONVERT.get(unit, ()):  # другая единица той же величины: л/мин ↔ м³/мин ↔ м³/ч
            match = re.search(NUM + r'\s*' + UNIT_RX[src], low)
            if match:
                return _clean(round(_num(match.group(1)) * k, 3))
    match = re.search(NUM, low)
    return _clean(_num(match.group(1))) if match else None


def _canon(v) -> str:
    return re.sub(r'[\s°c]', '', v.lower().replace('−', '-').replace('–', '-'))


def dew_point(v, vals=()) -> str:
    """Точка росы: первое число со знаком; к значению из списка категории, если отличается не больше чем на 1 °C."""
    match = re.search(r'([+\-−–]?)\s*(\d+(?:[.,]\d+)?)', str(v or ''))
    if not match:
        return ''
    num = float(match.group(2).replace(',', '.')) * (-1 if match.group(1) in ('-', '−', '–') else 1)
    for x in vals:
        try:
            if abs(float(x.replace('−', '-').replace('+', '')) - num) <= 1:
                return x
        except ValueError:
            pass
    num = int(num) if num.is_integer() else num
    return (f'+{num}' if num > 0 else f'−{-num!s}' if num < 0 else '0').replace('.', ',')


def parse_text(text, field) -> str:
    v = re.sub(r'\s+', ' ', str(text or '')).strip()
    if field.get('key') == 'oilFree' and field.get('values') == [
        'Да',
        'Нет',
    ]:  # «Тип компрессора: Безмасляный / Масляный»
        return (
            'Да'
            if re.search(r'безмасл|oil[- ]?free|класс 0', v, re.I)
            else 'Нет'
            if re.search(r'масл', v, re.I)
            else ''
        )
    vals = [x for x in field.get('values') or [] if isinstance(x, str)]
    for x in vals:  # значение из списка категории: «-40 °C» → «−40»
        if _canon(x) and _canon(x) == _canon(v):
            return x
    if field.get('key') == 'dewPoint':  # «3 °C» → «+3», «-40…-70 °C» → «−40», «2-10 °C» → «+3» (ближайшее из списка)
        return dew_point(v, vals)
    if field.get('key') == 'voltage':
        match = re.search(r'(\d{3})\s*в\b', v.lower())
        x = match.group(1) if match else ''
        return {'230': '220', '400': '380'}.get(x, x) if {'220', '380'} <= set(vals) else x
    if (
        field.get('key') == 'refrigerant'
    ):  # «R134a, 0,275 кг» → «R134A»; «Тип компрессора хладагента: поршневой» — не хладагент
        match = re.search(r'\bR-?\d{2,4}[A-Za-z]?\b', v)
        return match.group(0).replace('-', '').upper() if match else ''
    if len(_canon(v)) >= 4:  # «Горячая» → «Горячая (с нагревом)»: единственное значение списка с таким началом
        pre = [x for x in vals if _canon(x).startswith(_canon(v))]
        if len(pre) == 1:
            return pre[0]
    u = field.get('unit')
    if u and v.lower().endswith(u.lower()):
        v = v[: -len(u)].strip()
    return v[:120]


def rows_of(doc: dict) -> Iterator[tuple[str, str]]:
    for group in doc.get('groups') or []:
        for row in group.get('rows') or []:
            k, v = str(row.get('k') or '').strip(), str(row.get('v') or '').strip()
            if k and v:
                yield k, v


def detect(doc, types, with_dgu=False) -> str:
    """Категория по названию — как в программе (core/types.js detectCat): по порядку типов, ДГУ — последней."""
    dgu = next((tdef for tdef in types if tdef.get('id') == 'dgu'), None)
    for text in (
        ' '.join(str(x or '') for x in (doc.get('name'), doc.get('pageTitle'))),
        str((doc.get('hint') or {}).get('title') or ''),
    ):
        for tdef in types:
            if tdef.get('id') == 'dgu' or not tdef.get('match'):
                continue
            try:
                if re.search(tdef['match'], text, re.I):
                    return tdef['id']
            except re.error:
                pass
        if with_dgu and dgu and re.search(dgu.get('match') or '$^', text, re.I):
            return 'dgu'
    return ''


def fill_from_name(doc, cat, attrs) -> None:
    name = str(doc.get('name') or '')
    low = name.lower()

    def put(k, v) -> None:
        if v not in (None, '') and attrs.get(k) in (None, ''):
            attrs[k] = v

    if cat == 'receiver':
        match = re.search(NUM + r'\s*л(?![а-я])', low)
        put('volume', _clean(_num(match.group(1))) if match else None)
        match = re.search(r'/\s*(\d{1,2})\b', name)
        put('pressure', int(match.group(1)) if match else None)
        put('orient', 'Горизонтальный' if 'горизонт' in low else 'Вертикальный' if 'вертикал' in low else None)
    if cat == 'comp_scroll':
        put(
            'execution',
            'На ресивере с осушителем'
            if 'ресивер' in low and 'осушител' in low
            else 'На ресивере'
            if 'ресивер' in low
            else 'Стационарный',
        )
        put('dryer', 'Да' if 'осушител' in low else 'Нет')
        put('oilFree', 'Да' if 'безмасл' in low or 'класс 0' in str(doc.get('spec') or '').lower() else None)
    if cat == 'comp_diesel':
        put('execution', 'На шасси' if 'шасси' in low or 'передвижн' in low else None)
    if cat in ('dryer_refrig', 'dryer_ads'):
        put('cooling', 'Водяное' if 'водян' in low else None)
    if cat == 'filter':
        match = re.search(r'фм\s*(\d+)\s*/\s*(\d+)', low)
        put('pressure', int(match.group(2)) if match else None)


def fill_attrs(doc, tdef, attrs) -> int:
    """Пустые параметры категории — из таблицы характеристик; возвращает число заполненных."""
    count = 0
    rows = list(rows_of(doc))
    for field in tdef.get('fields') or []:
        k, regex = field.get('key'), field.get('find')
        if not k or not regex or attrs.get(k) not in (None, ''):
            continue
        unit_rx = UNIT_RX.get(field.get('unit')) if field.get('num') else None
        # сначала строки в единицах поля («1,7 м³/мин» раньше «100 м³/ч»), затем остальные — с пересчётом
        for row_key, row_val in sorted(
            rows, key=lambda row: 0 if unit_rx and re.search(r'\d\s*' + unit_rx, row[1].lower()) else 1
        ):
            try:
                if not re.search(regex, row_key, re.I):
                    continue
            except re.error:
                break
            if field.get('num') and re.search(
                r'(?i)снижени|уменьшени', row_val
            ):  # «снижение уровня шума на 8 дБ» — не значение
                continue
            v = parse_num(row_val, field.get('unit')) if field.get('num') else parse_text(row_val, field)
            if v not in (None, ''):
                attrs[k] = v
                count += 1
                break
    return count


def tidy_dgu(attrs) -> None:
    eng = str(attrs.get('engine') or '')
    match = re.match(r'^([A-Za-zА-Яа-я]+(?: [A-Za-z]+)?)\s+([A-Z0-9][A-Z0-9-]{3,})$', eng)
    if match and not attrs.get('engineModel') and re.search(r'\d', match.group(2)):
        attrs['engine'], attrs['engineModel'] = match.group(1), match.group(2)
    if str(attrs.get('execution') or '').strip().lower() == 'кожух':
        attrs['execution'] = 'В кожухе'


def photo_ok(photo, img_dir: str) -> bool:
    if not isinstance(photo, dict) or not photo.get('src'):
        return False
    src = str(photo['src'])
    if src.startswith('/img/'):
        return os.path.isfile(os.path.join(img_dir, src[5:]))
    return True


def main_val(doc, tdef) -> float | None:
    attrs = doc.get('attrs') or {}
    v = attrs.get(tdef.get('main') or 'kw') if tdef else None
    try:
        return float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def pick_donor(doc, tdef, pool) -> dict | None:
    attrs = doc.get('attrs') or {}
    main = main_val(doc, tdef)
    best, score = None, None
    for donor in pool:
        donor_attrs = donor.get('attrs') or {}
        if not attrs.get('maker') or donor_attrs.get('maker') != attrs.get('maker'):
            continue  # фото другого производителя не подставляем
        sim = 0.0
        if attrs.get('series') and donor_attrs.get('series') == attrs.get('series'):
            sim += 4
        if attrs.get('execution') and donor_attrs.get('execution') == attrs.get('execution'):
            sim += 3
        donor_val = main_val(donor, tdef)
        if main and donor_val:
            sim -= min(3.0, abs(math.log((donor_val + 1e-6) / (main + 1e-6))))
        if score is None or sim > score:
            best, score = donor, sim
    return best


def _done(store) -> tuple:
    """(отметки выполненных обновлений из kv «migrations», выполнено ли это)"""
    done = store.kv_get('migrations') or []
    return done, any(isinstance(move, dict) and move.get('id') == MIGRATION_ID for move in done)


def mark_done(store) -> None:
    """Отметить обновление выполненным без изменений (новая база — каталог ещё пуст)."""
    done, ok = _done(store)
    if not ok:
        store.kv_set(
            'migrations',
            [
                *done,
                {'id': MIGRATION_ID, 'at': datetime.now().isoformat(timespec='seconds'), 'report': {'empty': True}},
            ],
        )


def run(store, types_builtin, types_user, img_dir: str, backup_dir: str, log=print) -> dict | None:
    """Обновление каталога (один раз); → отчёт или None — уже выполнено или каталог пуст."""
    done, ok = _done(store)
    if ok:
        return None
    docs = json.loads(store.catalog_full() or '[]')
    if not docs:
        mark_done(store)
        return None

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = os.path.join(backup_dir, f'kp-{stamp}-до-обновления-каталога.zip')
    store.backup(backup)

    # свои категории, которые теперь встроенные
    user_map, keep_user = {}, []
    for tdef in types_user or []:
        name = str(tdef.get('name') or '')
        target = next((tid for regex, tid in USER_TYPE_MAP if re.search(regex, name, re.I)), None)
        if target and not any(builtin.get('id') == tdef.get('id') for builtin in types_builtin):
            user_map[tdef['id']] = (
                target if not (target == 'dryer_refrig' and re.search('адсорбц', name, re.I)) else 'dryer_ads'
            )
        else:
            keep_user.append(tdef)
    types = list(types_builtin) + [
        tdef for tdef in keep_user if not any(builtin.get('id') == tdef.get('id') for builtin in types_builtin)
    ]
    tmap = {tdef['id']: tdef for tdef in types}
    names = {tdef.get('id'): tdef for tdef in (types_user or [])}
    titles = {}
    for tdef in types:
        for k in (tdef.get('name'), tdef.get('coverTitle')):
            if k:
                titles.setdefault(k, tdef['id'])

    # производители, встречающиеся в каталоге: позиция без производителя получает его по названию
    makers = sorted(
        {str((doc.get('attrs') or {}).get('maker') or '').strip() for doc in docs} - {''}, key=len, reverse=True
    )
    moved, filled, photos, logos, nophoto = {}, 0, 0, 0, []
    changed = set()
    for doc in docs:
        attrs = dict(doc.get('attrs') or {})
        old = attrs.get('cat') or ''
        new = old
        if old in user_map:
            new = user_map[old]
            if new == 'dryer_refrig' and detect(doc, types) == 'dryer_ads':
                new = 'dryer_ads'
        elif old not in tmap:
            new = detect(doc, types, with_dgu=True) or 'other'
        else:
            det = detect(doc, types)
            if det in SPECIFIC and det != old and old in GENERAL:
                new = det
        if new != old:
            attrs['cat'] = new
            old_name = (tmap.get(old) or {}).get('name')
            if not old_name:
                old_name = names[old].get('name', old) + ' (своя категория)' if old in names else old
            key = '{} → {}'.format(old_name or 'без категории', tmap[new]['name'])
            moved[key] = moved.get(key, 0) + 1
        tdef = tmap.get(new)
        # заголовок титула от другой категории («Винтовые компрессоры» у ДГУ) — по категории позиции
        hint = doc.get('hint')
        if tdef and isinstance(hint, dict) and hint.get('title') in titles and titles[hint['title']] != new:
            doc['hint'] = dict(hint, title=tdef.get('coverTitle') or tdef.get('name'))
            changed.add(doc['id'])
        before = json.dumps(attrs, sort_keys=True, ensure_ascii=False)
        if not str(attrs.get('maker') or '').strip():
            maker = next(
                (
                    maker_rec
                    for maker_rec in makers
                    if re.search(
                        r'(^|[\s«"(])' + re.escape(maker_rec) + r'($|[\s»",)])', str(doc.get('name') or ''), re.I
                    )
                ),
                None,
            )
            if maker:
                attrs['maker'] = maker
        if tdef:
            fill_from_name(doc, new, attrs)
            filled += fill_attrs(doc, tdef, attrs)
        if new == 'dgu':
            tidy_dgu(attrs)
        if json.dumps(attrs, sort_keys=True, ensure_ascii=False) != before or new != old:
            doc['attrs'] = attrs
            changed.add(doc['id'])

    # фото и логотипы по аналогии: та же категория и производитель
    by_cat = {}
    for doc in docs:
        by_cat.setdefault((doc.get('attrs') or {}).get('cat'), []).append(doc)
    for doc in docs:
        attrs = doc.get('attrs') or {}
        tdef = tmap.get(attrs.get('cat'))
        if not photo_ok(doc.get('photo'), img_dir):
            pool = [
                x
                for x in by_cat.get(attrs.get('cat'), [])
                if x is not doc and photo_ok(x.get('photo'), img_dir) and not x.get('photoFrom')
            ]
            donor = pick_donor(doc, tdef, pool)
            if donor:
                doc['photo'] = dict(donor['photo'])
                doc['photoFrom'] = {'id': donor['id'], 'name': donor.get('name', '')}
                photos += 1
                changed.add(doc['id'])
            else:
                nophoto.append(doc.get('name', doc['id']))
        if not photo_ok(doc.get('logo'), img_dir) and attrs.get('maker'):
            cands = [
                x.get('logo')
                for x in docs
                if (x.get('attrs') or {}).get('maker') == attrs.get('maker') and photo_ok(x.get('logo'), img_dir)
            ]
            if cands:
                srcs = [cand['src'] for cand in cands]
                top = max(set(srcs), key=srcs.count)
                doc['logo'] = dict(next(cand for cand in cands if cand['src'] == top))
                logos += 1
                changed.add(doc['id'])

    # изображения галереи, файлов которых нет, — убираем (иначе документ КП не соберётся)
    gal_fixed = 0
    for doc in docs:
        gallery = doc.get('gallery') or []
        ok = [x for x in gallery if photo_ok(x, img_dir)]
        if len(ok) != len(gallery):
            doc['gallery'] = ok
            gal_fixed += len(gallery) - len(ok)
            changed.add(doc['id'])

    for doc in docs:
        if doc['id'] in changed:
            for k in ('_light', 'pricesCount', 'st'):
                doc.pop(k, None)
            store.catalog_put(doc['id'], json.dumps(doc, ensure_ascii=False))
    if user_map:
        store.kv_set('types', {'version': 1, 'types': keep_user})

    report = {
        'moved': moved,
        'attrsFilled': filled,
        'photos': photos,
        'logos': logos,
        'galleryFixed': gal_fixed,
        'noPhoto': nophoto[:50],
        'noPhotoCount': len(nophoto),
        'changed': len(changed),
        'userTypesMerged': [tdef.get('name') for tdef in (types_user or []) if tdef.get('id') in user_map],
    }
    store.kv_set(
        'migrations',
        [
            *done,
            {
                'id': MIGRATION_ID,
                'at': datetime.now().isoformat(timespec='seconds'),
                'backup': backup,
                'report': report,
            },
        ],
    )
    report = dict(report, backup=backup)
    log(
        f'Каталог обновлён под новые категории: изменено позиций {len(changed)}, перенесено {sum(moved.values())}, параметров заполнено {filled}, фото {photos}, логотипов {logos}. Копия базы: {backup}'
    )
    return report
