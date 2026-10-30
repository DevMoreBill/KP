"""Категория, производитель и модель позиции фида — по названию, разделу сайта и описанию."""

import re

import catalog_migrate

_TRANSLIT = dict(
    zip(
        'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
        [
            'a',
            'b',
            'v',
            'g',
            'd',
            'e',
            'e',
            'zh',
            'z',
            'i',
            'i',
            'k',
            'l',
            'm',
            'n',
            'o',
            'p',
            'r',
            's',
            't',
            'u',
            'f',
            'h',
            'c',
            'ch',
            'sh',
            'sch',
            '',
            'y',
            '',
            'e',
            'yu',
            'ya',
        ],
        strict=False,
    )
)


def _brand_key(text) -> str:
    """«Ремеза» и «Remeza» — один производитель."""
    return re.sub(r'[^a-z0-9]', '', ''.join(_TRANSLIT.get(char, char) for char in str(text or '').lower()))


# явные правила (по названию позиции, затем по разделу фида) — до общего определения по названию
NAME_RULES = [
    (
        r'сепаратор\S*\s+масляного тумана|масловлагоразделител|сепаратор\S*\s+конденсата|водомаслян\S*\s+сепаратор',
        'oil_sep',
    ),
    (r'угольн\S*\s+колонн', 'filter'),
    (
        r'компрессор\S*\s+медицинск|медицинск\S*\s+компрессор',
        'comp_piston',
    ),  # медицинские Remeza — поршневые безмасляные
    (r'^\s*кожух', 'spare'),
    (r'^\s*конденсатоотводчик', 'condensate'),  # отдельный узел «Очистка и отвод конденсата»; нет такой категории — ЗИП
    (
        r'фильтроэлемент|корпус\S*\s+фильтр|патрон\S*\s+воздушн|картридж|блок\S*\s+поршнев|^\s*(поршень|шатун|цилиндр|палец|вкладыш|сапун|'
        r'прессостат|манометр|редуктор|муфта|полумуфта|радиатор|переходник|пластина|термоэлемент|конденсатоотводчик|комплект колец|кольцо)',
        'spare',
    ),
    (r'циклонн\S*\s+сепаратор', 'filter'),
    (r'модульн\S*\s+компрессорн\S*\s+станци|\bВМКС\b', 'st_comp'),  # АСО: станция в блок-контейнере
    (r'шкаф\S*\s+управления', 'automation'),
    (r'^\s*(рукав|сопло|соплодержател|сцеплени)', 'spare'),  # к аппаратам струйной очистки
    # русские модели без латиницы («Поршневой компрессор К2»): «Поршневой компрессор высокого давления … W 64» не трогается
    (r'^(?!.*[A-Za-z])\s*поршнев\S*\s+компрессор', 'comp_piston'),
    (
        r'^(?!.*[A-Za-z])\s*(винтов\S*\s+компрессор|агрегат\S*\s+компрессорн\S*\s+винтов|установк\S*\s+компрессорн\S*\s+винтов)',
        'comp_screw',
    ),
]
PATH_RULES = [
    (r'воздуходувк', 'blower'),
    (r'генератор\S*\s+азота', 'gen_n2'),
    (r'генератор\S*\s+кислорода', 'gen_o2'),
    (r'адсорбц\S*\s+осушител|осушител\S*.*адсорбц', 'dryer_ads'),
    (r'рефрижераторн\S*\s+осушител|осушител\S*.*рефрижер', 'dryer_refrig'),
    (r'воздушн\S*\s+ресивер', 'receiver'),
    (r'фильтр\S*\s+сжатого воздуха', 'filter'),
    (r'циклонн\S*\s+сепаратор', 'filter'),
    (
        r'винтов\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|компрессорн\S*\s+станци|лазерн|'
        r'безмасл\S*\s+компрессор\S*\s+(сухого сжатия|с водяным впрыском)',
        'comp_screw',
    ),  # Dali CAT, VFW — безмасляные винтовые
    (r'поршнев\S*\s+(маслозаполн\S*\s+|безмасл\S*\s+)?компрессор|медицинск\S*\s+компрессор', 'comp_piston'),
    (r'спиральн\S*\s+компрессор|компрессор\S*\s+серии\s+акс', 'comp_scroll'),
    (r'дизель-генератор|дизельн\S*\s+генератор|газопоршнев\S*\s+электростанц', 'dgu'),
    (r'ввод\S*\s+резерв', 'ats'),
]


def _rule(rules, text, ids) -> str:
    for regex, cat in rules:
        if cat in ids and re.search(regex, text or '', re.I):
            return cat
    return ''


def item_cat(offer, types) -> str:
    """Категория программы для позиции фида — только из существующих категорий."""
    ids = {tdef.get('id') for tdef in types}
    path, crumbs = str(offer.get('path') or ''), str(offer.get('crumbs') or '')
    spare = next((tdef for tdef in types if tdef.get('id') == 'spare'), None)
    for part in (crumbs, path):  # «Запчасти и расходные материалы / Для винтовых компрессоров»
        if part and spare and spare.get('match') and re.search(spare['match'], part, re.I):
            return 'spare'
    cat = _rule(NAME_RULES, offer['name'], ids)
    if cat:
        return cat
    if (
        'comp_diesel' in ids
        and re.search(r'компрессор', offer['name'], re.I)
        and re.search(r'дизел', offer['name'], re.I)
    ):
        return 'comp_diesel'  # «Компрессор винтовой дизельный PDP 15-7» — дизельный, а не винтовой
    cat = _rule(
        PATH_RULES, re.split(r'\s+[A-Z]', offer['name'])[0], ids
    )  # вид в начале названия: «Винтовой компрессор EXELUTE EXDM-RD …»
    if cat:  # (в описании станции 4 в 1 первым может идти осушитель)
        return cat
    cat = _rule(PATH_RULES, crumbs, ids)  # настоящий раздел сайта (страница товара) надёжнее подборок фида
    if cat:
        return cat
    kind = ' '.join(
        part['v'] for part in offer.get('params') or [] if re.match(r'^(вид|тип) компрессора$', part['k'], re.I)
    )
    cat = _rule(PATH_RULES, kind + ' компрессор', ids) if kind else ''  # параметр фида «Вид компрессора: винтовой»
    if cat:
        return cat
    if re.match(
        r'^\s*осушител', offer['name'], re.I
    ):  # «Осушитель воздуха Dali CAAD-27MP-D», параметр «Осушитель: Адсорбционный»
        cat = _rule(
            PATH_RULES,
            ' '.join(
                'осушитель ' + part['v']
                for part in offer.get('params') or []
                if re.match(r'^(тип )?осушител', part['k'], re.I)
            ),
            ids,
        )
        if cat:
            return cat
    diesel = re.search(r'дизел', offer['name'] + ' ' + path, re.I)
    cat = catalog_migrate.CatDetect.of({'name': offer['name']}, types)
    if cat == 'comp_diesel' and not diesel:  # «Компрессорная станция МВК» — электрическая, винтовая
        cat = 'comp_screw'
    if cat:
        return cat
    cat = _rule(PATH_RULES, path, ids)
    if cat:
        return cat
    for seg in reversed(path.split(' / ')):
        cat = catalog_migrate.CatDetect.of({'name': seg}, types)
        if cat and not (cat == 'comp_diesel' and not diesel):
            return cat
    if 'comp_diesel' in ids and re.search(r'бензин\S*\s+(\S+\s+)?компрессор', offer['name'], re.I):
        return 'comp_diesel'  # компрессор с бензиновым двигателем — рядом с дизельными (свой двигатель)
    return ''


SPARE_PART = [
    (r'маслян\S*\s+фильтр|фильтр\S*\s+маслян', 'Фильтр масляный'),
    (r'сепаратор|маслоотделител', 'Сепаратор (маслоотделитель)'),
    (r'воздушн\S*\s+фильтр|фильтр\S*\s+воздушн|патрон|картридж', 'Фильтр воздушный'),
    (r'фильтроэлемент', 'Фильтроэлемент магистрального фильтра'),
    (r'масло', 'Масло компрессорное'),
    (r'ремень|ремни', 'Ремень приводной'),
    (r'датчик|термоэлемент|прессостат|манометр|конденсаторн', 'Датчики и электрика'),
    (r'клапан|прокладк|сальник|кольц|уплотн', 'Ремкомплект (клапаны, уплотнения)'),
    (r'блок\S*\s+поршнев|поршн|поршень|шатун|цилиндр|палец|пальц|вкладыш', 'Поршневой блок и детали'),
]
PISTON_SERIES = r'(?<![\w])(?:LB|LT|LH|OLD|AB|АВ)\d[\w.]*(?:[-/][\w.]+)*'


def spare_info(offer) -> dict:
    """Запасная часть: вид, для какого оборудования, к каким моделям (название, раздел фида, страница товара)."""
    name, path = offer['name'], str(offer.get('crumbs') or offer.get('path') or '')
    last = path.rsplit(' / ', maxsplit=1)[-1] if path else ''
    use = next(
        (v for k, v in offer.get('props') or [] if re.match(r'(?i)^(применение|назначение|тип оборудования)$', k)), ''
    )
    part = (
        next((v for regex, v in SPARE_PART if re.search(regex, name, re.I)), '')
        or next((v for regex, v in SPARE_PART if re.search(regex, last, re.I)), '')
        or 'Прочее'
    )
    series = re.findall(PISTON_SERIES, name)
    text = use + ' ' + path + ' ' + name
    for_type = (
        'Винтовые компрессоры'
        if re.search(r'винтов|\bВК\s*\d', text, re.I)
        else 'Поршневые компрессоры'
        if series or re.search(r'поршнев|медицинск|кожух', text, re.I)
        else 'Спиральные компрессоры'
        if re.search(r'спиральн', text, re.I)
        else 'Магистральные фильтры'
        if re.search(r'фильтроэлемент|корпус\S*\s+фильтр|фильтр\S*\s+сжатого', text, re.I)
        else ''
    )
    models = offer.get('apply') or ', '.join(dict.fromkeys(series))
    svc = next(
        (
            match.group(1)
            for k, v in offer.get('props') or []
            for match in [re.search(r'(?i)замен\S*\D{0,25}?(\d[\d\s]{1,6})\s*(?:моточас|час|ч\b)', v)]
            if match
        ),
        '',
    )
    return {
        'part': part,
        'forType': for_type,
        'forModels': models[:600],
        'service': int(re.sub(r'\s', '', svc)) if svc else None,
    }


CRUMB_ATTRS = [  # признаки, которые видны только по разделу сайта: (категории, раздел/название, поле, значение)
    (('dryer_ads',), r'холодн\S* регенерац', 'regen', 'Холодная (без нагрева)'),
    (('dryer_ads',), r'горяч\S* регенерац', 'regen', 'Горячая (с нагревом)'),
    (('comp_piston', 'comp_scroll', 'comp_screw'), r'безмасл', 'oilFree', 'Да'),
    (('comp_piston', 'comp_screw'), r'маслозаполн|масл\S+\s+компрессор', 'oilFree', 'Нет'),
    (('comp_piston', 'comp_scroll'), r'ремен\S* привод', 'drive', 'Ременной'),
    (('comp_piston', 'comp_scroll'), r'прям\S* привод', 'drive', 'Прямой'),
    (('comp_screw',), r'частотн|постоянн\S* магнит', 'vsd', 'Да'),
    (('comp_piston',), r'передвижн', 'execution', 'Передвижной'),
    (('comp_screw', 'comp_scroll'), r'на ресивере|ресивер\S* \d', 'execution', 'На ресивере'),
    (('comp_screw', 'comp_scroll'), r'с осушител|осушител\S* встроен', 'dryer', 'Да'),
]
DESC_ATTRS = [  # пустые поля — из описания, когда характеристик на странице нет: (поле, выражение, значение или группа)
    ('drive', r'ремённ\S*|ременн\S*\s+(?:привод|передач)', 'Ременной'),
    ('drive', r'прям\S*\s+привод', 'Прямой'),
    ('voltage', r'напряжени\S*\s+(?:сети\s+)?(220|380|400)\s*в\b', 1),
    ('receiver', r'ресивер\S*\s+(?:объ[её]мом\s+)?(?:на\s+)?(\d{2,4})\s*(?:л|литр)', 1),
    (
        'stages',
        r'(двухступенчат|одноступенчат)',
        lambda match: '2' if match.group(1).lower().startswith('дву') else '1',
    ),
]
# параметры фида вида «Частотный преобразователь: есть», «Тип охлаждения: воздушное» → поля категории (Да / Нет, Воздушное / Водяное)
ROW_ATTRS = (
    ('vsd', r'^частотн|преобразовател\S*\s+частот', ((r'^(есть|да)\b', 'Да'), (r'^нет\b', 'Нет'))),
    ('dryer', r'^(встроенный\s+)?осушител', ((r'^нет\b', 'Нет'), (r'^(есть|да)\b|встроен|рефриж|адсорб', 'Да'))),
    ('cooling', r'^(тип\s+)?охлаждени', ((r'воздуш', 'Воздушное'), (r'водян', 'Водяное'))),
)


def row_attrs(tdef, rows, attrs) -> None:
    fields = {field.get('key'): field for field in tdef.get('fields') or []}
    for key, krx, vals in ROW_ATTRS:
        field = fields.get(key)
        if not field or attrs.get(key) not in (None, ''):
            continue
        for row in rows:
            if not re.search(krx, row['k'], re.I):
                continue
            v = next((out for vrx, out in vals if re.search(vrx, str(row['v']).strip(), re.I)), '')
            if v and (not field.get('values') or v in field['values']):
                attrs[key] = v
            break


def desc_attrs(tdef, text, attrs) -> None:
    fields = {field.get('key'): field for field in tdef.get('fields') or []}
    for k, regex, v in DESC_ATTRS:
        match = re.search(regex, text or '', re.I)
        if (
            k == 'drive'
            and match
            and sum(1 for attr_key, rx2, _ in DESC_ATTRS if attr_key == 'drive' and re.search(rx2, text or '', re.I))
            > 1
        ):
            continue  # «прямой привод надёжнее ременной передачи» — не угадывать
        if k not in fields or attrs.get(k) or not match:
            continue
        if callable(v):
            attrs[k] = v(match)
        elif isinstance(v, int):  # номер группы выражения
            attrs[k] = int(match.group(v)) if k == 'receiver' else match.group(v)
        else:
            attrs[k] = v


def crumb_attrs(tdef, text, attrs) -> None:
    keys = {field.get('key') for field in tdef.get('fields') or []}
    for cats, regex, k, v in CRUMB_ATTRS:
        if tdef.get('id') in cats and k in keys and not attrs.get(k) and re.search(regex, text or '', re.I):
            attrs[k] = v


def model_of(offer, maker) -> str:
    """Модель: <model> из фида, иначе из названия, иначе артикул."""
    if offer['model']:
        return offer['model'][:80]
    brands = {_brand_key(maker), _brand_key(offer['vendor'])} - {''}
    words = [word for word in offer['name'].split() if _brand_key(word) not in brands]
    if offer['sku'] and words and words[0] == offer['sku']:
        return offer['sku'][:80]
    i = 0
    while (
        i < len(words)
        and re.fullmatch(r'[А-Яа-яЁёA-Za-z-]+', words[i])
        and not (len(words[i]) > 1 and words[i].isupper())
    ):
        i += 1
    rest = re.sub(r'^(\([^)]*\)\s*)+', '', ' '.join(words[i:]))  # «Сепаратор (маслоотделитель) для ВК20» — не модель
    rest = re.split(r'(?:^|\s+)(?:с|со|для|в комплекте)\s+', rest)[0].strip(' ,–-')
    rest = re.sub(r'(\s+[а-яё]+)+$', '', rest)  # «РВ 500/11 вертикальный» → «РВ 500/11»
    return (rest or offer['sku'] or '')[:80]


def makers(feed) -> list:
    """Производители фида: «EXELUTE, LUPAMAT, ALMIG» — у дистрибьютора несколько марок (у позиции — своя, из парса)."""
    return [x.strip() for x in re.split(r'[,;]', feed.get('maker') or '') if x.strip()]


def maker_of(offer, feed) -> str:
    makers_list = makers(feed)
    for maker_name in makers_list:
        if not offer['vendor'] or _brand_key(offer['vendor']) == _brand_key(maker_name):
            return maker_name
    return offer['vendor'] or (makers_list[0] if makers_list else '')
