"""Описание и характеристики позиции фида: очистка текста, блоки описания, единицы, слияние таблиц."""

import html as html_mod
import re
from typing import Any

from feed_xlsx import _num, _unit_parts

LIST_ITEMS_MIN = 3
SENT_KEY_MIN = 8
HEADING_MAX = 60
CM_VALUES_BELOW = 1000
SPEC_SEEN_MAX = 50000
GLUED_WORDS = 2
LPM_FROM = 60
DIMS_COUNT = 3
UNIT_LABEL = {
    'бар': 'Макс. давление',
    'квт': 'Мощность',
    'кг': 'Масса',
    'дб': 'Уровень шума',
    'м³/мин': 'Производительность',
    'м3/мин': 'Производительность',
    'л/мин': 'Производительность',
    'м³/ч': 'Производительность',
    'м3/час': 'Производительность',
    'лит': 'Объём ресивера',
    'л': 'Объём ресивера',
}
SPEC_UNITS = {
    'лит': 'л',
    'м3/мин': 'м³/мин',
    'м3/час': 'м³/ч',
    'м3/ч': 'м³/ч',
    'кВт.': 'кВт',
    'кВт/ч': 'кВт',
    'дБ(А)': 'дБ',
    'мбар': 'мбар',
    '(л)': 'л',
    '(кг)': 'кг',
}


def _spec_split(label, v, u) -> list:
    """Составной столбец: «Габариты / Масса / Упаковка» «81 х 41 х 64 / 65» «см / кг / r (ü)» → [(Габариты, 81×41×64 см), (Масса, 65 кг)]."""
    units = _unit_parts(u) if u else None
    values = [x.strip() for x in re.split(r'\s+/\s+', v)]
    labels = [x.strip() for x in label.split(' / ')]
    if units and len(units) > 1 and len(values) > 1:
        if len(labels) >= len(values):
            return [
                (labels[k][:60], _spec_val(values[k], units[k] if k < len(units) else '')) for k in range(len(values))
            ]
        if len(labels) == 1 and len(values) == len(units):
            return [(label[:60], ' / '.join(_spec_val(values[k], units[k]) for k in range(len(values))))]
    return [(label[:60], _spec_val(re.sub(r'\s+', ' ', v), units[0] if units else u))]


def _spec_val(v, u) -> str:
    u = SPEC_UNITS.get(str(u).strip(), str(u).strip())
    v = str(v).strip()
    num = _num(v)
    if num is not None:
        v = (f'{num}') if float(num).is_integer() else (f'{num:.3f}').rstrip('0').rstrip('.').replace('.', ',')
    v = v.replace('x', '×').replace('х', '×') if re.match(r'^\d+\s*[xх×]\s*\d+', v) else v
    return (f'{v} {u}') if u and re.match(r'^[-+]?\d', v) and not re.search(r'["\'“”]|^\d+/\d+$|^DN', v) else v


JUNK_SENT = re.compile(
    r'\bваш(е|ем|у|им|их|а|и)?\b|\bвам\b|верный способ|обратитесь|звоните|позвоните|менеджер|оставьте заявку|заказать|купить|'
    r'\bцен[аыу]\b|доставк|примерн|индивидуально|согласно проекту|официальн\S* (дилер|представител|поставщик)|'
    r'в наличии|со склада|гарантия качества|лучшее решение|не имеет аналогов|по выгодн|скидк|акци[яи]\b|\bоплат|\bфишк',
    re.I,
)
HEAD_RX = re.compile(
    r'\s*(технические особенности|главное о серии|общие характеристики|основные характеристики|основные преимущества|особенности|преимущества|опции|комплектация|применение|области применения)([^:\n•]{0,50}):\s*',
    re.I,
)
LIST_HEAD_RX = re.compile(
    r'(Общие характеристики|Основные характеристики|Основные преимущества)\s+([^.:\n•►]{20,}?)(?=\s*(?:$|\n|\.\s|Технические особенности|Опции))'
)


def _list_items(match) -> str:
    """Склеенный перечень пунктов («Общие характеристики Блок … Система …») — списком."""
    items = [x.strip(' ,;') for x in re.split(r'\s+(?=[А-ЯЁ][а-яё])(?<![«/]\s)', match.group(2)) if x.strip(' ,;')]
    if len(items) < LIST_ITEMS_MIN:
        return match.group(0)
    return '\n' + match.group(1) + ':\n' + '\n'.join('• ' + x for x in items) + '\n'


BLOCK_LABELS = {
    'Назначение',
    'Конструкция и принцип работы',
    'Диапазон серии',
    'Исполнения',
    'Особенности',
    'Технические особенности',
    'Главное о серии',
    'Общие характеристики',
    'Преимущества',
    'Опции',
    'Комплектация',
    'Применение',
    'Описание',
    'Устройство',
    'Исполнения и опции',
}
# схема блоков карточки: «Назначение», «Устройство», «Преимущества», «Исполнения и опции», «Комплектация»; заголовки страниц
# поставщиков сводятся к ней, одноимённые блоки объединяются
BLOCK_MAP = {
    'Конструкция и принцип работы': 'Устройство',
    'Технические особенности': 'Преимущества',
    'Общие характеристики': 'Преимущества',
    'Главное о серии': 'Преимущества',
    'Особенности': 'Преимущества',
    'Опции': 'Исполнения и опции',
    'Исполнения': 'Исполнения и опции',
    'Диапазон серии': 'Исполнения и опции',
    'Применение': 'Назначение',
}
BLOCK_ORDER = ['Назначение', 'Устройство', 'Преимущества', 'Исполнения и опции', 'Комплектация']


def clean_desc(text) -> str:
    """Описание со страницы → текст без «воды»: вводный абзац, подзаголовки, список «• …»; повторы и рекламные фразы убраны."""
    desc_text = html_mod.unescape(str(text or '')).replace('\xa0', ' ')
    desc_text = LIST_HEAD_RX.sub(_list_items, desc_text)
    desc_text = re.sub(r'["«»]{2,}|\s*"\s*;|\s*"(?=\s|$)|(?<=\s)"\s*', ' ', desc_text)  # сломанные кавычки из CSV
    desc_text = re.sub(r'\s*[►▪■●♦➢➤✓]\s*(?=[А-ЯA-Zа-я0-9])|\s+-\s+(?=[А-Я])', '\n• ', desc_text)
    keep: dict = {}  # заголовки блоков отдельной строкой («Исполнения и опции:») — не разбирать на подзаголовки
    for lab in sorted(BLOCK_LABELS, key=len, reverse=True):
        tok = f'\x00{len(keep)}\x00'
        cleaned = re.sub(r'(?m)^\s*' + re.escape(lab) + r':\s*$', tok, desc_text)
        if cleaned != desc_text:
            keep[tok], desc_text = lab + ':', cleaned
    desc_text = HEAD_RX.sub(lambda match: '\n' + match.group(1).strip().capitalize() + ':\n', desc_text)
    for tok, lab in keep.items():
        desc_text = desc_text.replace(tok, '\n' + lab + '\n')
    desc_text = desc_text.replace('С°', '°C').replace('C°', '°C').replace('м3/', 'м³/').replace('м3 /', 'м³/')
    out, seen = [], set()
    for raw_line in desc_text.split('\n'):
        line = re.sub(r'\s+', ' ', raw_line).strip()
        if not line:
            continue
        if line.startswith('• ') or line.endswith(':'):
            parts = [line]
        else:
            parts = [x.strip() for x in re.split(r'(?<=[.!?;])\s+(?=[А-ЯA-Z0-9«])', line) if x.strip()]
        for sent in parts:
            body = sent[2:] if sent.startswith('• ') else sent
            body = body.strip(' ;"').rstrip('.;') + ('' if sent.endswith(':') else '.')
            key = re.sub(r'[^а-яa-z0-9]', '', body.lower())
            if (len(key) < SENT_KEY_MIN and not sent.endswith(':')) or key in seen:
                continue
            if JUNK_SENT.search(body) and not sent.endswith(':'):
                continue
            seen.add(key)
            out.append(('• ' + body) if sent.startswith('• ') else (sent if sent.endswith(':') else body))
    # подзаголовок без пунктов после него не нужен (кроме заголовков блоков карточки: «Назначение:» и т. п. — перед абзацем)
    res = []
    for i, x in enumerate(out):
        nxt = out[i + 1] if i + 1 < len(out) else ''
        if (
            x.endswith(':')
            and not nxt.startswith('• ')
            and not (x[:-1] in BLOCK_LABELS and nxt and not nxt.endswith(':'))
        ):
            continue
        res.append(x)
    return '\n'.join(res)[:4000].strip()


HEAD_LABEL = {
    'технические особенности': 'Технические особенности',
    'главное о серии': 'Главное о серии',
    'особенности': 'Особенности',
    'общие характеристики': 'Общие характеристики',
    'основные характеристики': 'Общие характеристики',
    'основные преимущества': 'Преимущества',
    'преимущества': 'Преимущества',
    'опции': 'Опции',
    'комплектация': 'Комплектация',
    'применение': 'Применение',
    'области применения': 'Применение',
}
PURPOSE_RX = re.compile(
    r'предназначен|применя(ет|ют)ся|использу(ет|ют)ся|решает|для предприятий|подходит для|отрасл|задач', re.I
)
DESIGN_RX = re.compile(
    r'принцип|конструкц|состоит|состав|оборудован|оснащ|установлен|теплообменник|контроллер|двигател|блок|корпус|кожух|'
    r'панел|клапан|фильтр|систем|привод|ресивер|сенсорн|экран|датчик|колонн|адсорбент|сито|сечени|ремен|подшипник|ротор|'
    r'сепаратор|шкаф|отсек|насос|охлажден|цилиндр',
    re.I,
)
PARAM_RX = re.compile(
    r'^(производительность|давление|избыточное давление|рабочее давление|вакуум|разрежение|мощность|расход|напряжение|'
    r'точка росы|объ[её]м|чистота|уровень шума)\b[^.]{0,70}\.?$',
    re.I,
)
VARIANT_RX = re.compile(r'исполнени', re.I)
BLOCK_LIMIT = 12


def _sents(text) -> list:
    return [x.strip() for x in re.split(r'(?<=[.!?])\s+(?=[А-ЯA-Z0-9«(])', text) if x.strip()]


def _intro_blocks(prose, bullets) -> list:
    """Вводный текст без подзаголовков: назначение → конструкция и принцип работы → диапазон серии → исполнения/особенности."""
    buckets: dict[str, list[str]] = {'Назначение': [], 'Конструкция и принцип работы': [], 'Диапазон серии': []}
    cur = 'Назначение'
    sents = [sent for line in prose for sent in _sents(line)]
    for i, sent in enumerate(sents):
        if PARAM_RX.match(sent):
            buckets['Диапазон серии'].append(sent)
            continue
        if cur == 'Назначение' and i > 0 and not PURPOSE_RX.search(sent) and DESIGN_RX.search(sent):
            cur = 'Конструкция и принцип работы'
        buckets[cur].append(sent)
    out = [(lab, ' '.join(v)) for lab, v in buckets.items() if v and lab != 'Диапазон серии']
    if buckets['Диапазон серии']:
        out.append(('Диапазон серии', '\n'.join('• ' + sent for sent in buckets['Диапазон серии'])))
    if bullets:
        lab = (
            'Исполнения'
            if sum(1 for bullet in bullets if VARIANT_RX.search(bullet)) * 2 >= len(bullets)
            else 'Особенности'
        )
        out.append((lab, '\n'.join(bullets)))
    return out


def desc_blocks(text) -> list:
    """Очищенное описание → блоки карточки [(заголовок, текст)] по схеме BLOCK_LABELS."""
    text = str(text or '').strip()
    if not text:
        return []
    sections: list[dict[str, Any]] = []
    cur: dict[str, Any] = {'label': '', 'prose': [], 'bullets': []}
    for raw_line in text.split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        if line.endswith(':') and not line.startswith('• ') and len(line) <= HEADING_MAX:
            if cur['prose'] or cur['bullets']:
                sections.append(cur)
            key = line[:-1].strip().lower()
            cur = {
                'label': HEAD_LABEL.get(key) or (line[:-1].strip()[:1].upper() + line[:-1].strip()[1:]),
                'prose': [],
                'bullets': [],
            }
            continue
        (cur['bullets'] if line.startswith('• ') else cur['prose']).append(line)
    if cur['prose'] or cur['bullets']:
        sections.append(cur)
    out = []
    for sec in sections:
        if not sec['label']:
            out.extend(_intro_blocks(sec['prose'], sec['bullets']))
        elif sec['label'] in ('Модельный ряд', 'Диапазон серии') and not sec['bullets']:
            out.append(('Исполнения и опции', '\n'.join('• ' + x for x in sec['prose'])))
        else:
            out.append((sec['label'], '\n'.join(([' '.join(sec['prose'])] if sec['prose'] else []) + sec['bullets'])))
    out = [(lab, block_text) for lab, block_text in out if block_text.strip()]
    if len(out) == 1 and sections and not sections[0]['label']:
        return [('Описание', out[0][1])]
    merged = {}
    for raw_lab, block_text in out:  # к схеме блоков; одинаковые пункты не повторяются
        lab = BLOCK_MAP.get(raw_lab, raw_lab)
        if lab not in merged:
            merged[lab] = block_text
            continue
        have = set(merged[lab].split('\n'))
        add = [x for x in block_text.split('\n') if x not in have]
        if add:
            merged[lab] += ('\n' if merged[lab] else '') + '\n'.join(add)
    order = {k: i for i, k in enumerate(BLOCK_ORDER)}
    return sorted(merged.items(), key=lambda pair: order.get(pair[0], len(order)))[:BLOCK_LIMIT]


SPEC_CLASS = [
    ('pressure_min', r'^мин\S*\s+давлен'),
    ('pressure_in', r'давлен\S*\s+на входе'),
    ('vacuum', r'разряжени|вакуум'),
    ('relay', r'реле\s+давлени'),
    ('pressure', r'давлен'),
    ('flow_out', r'по\s+нагнетани|привед'),
    ('flow_clean', r'по\s+очистке'),
    ('flow_rpm', r'при\s+оборотах'),
    ('flow', r'производительн|пропускн\S*\s+способн'),
    ('power', r'мощност'),
    ('dims', r'габарит'),
    ('length', r'^(длина|глубина)'),
    ('width', r'^ширина'),
    ('height', r'^высота'),
    ('mass_ads', r'масс\S*\s+адсорбент'),
    ('mass', r'^(масса|вес|общий вес)'),
    ('noise', r'шум'),
    ('outlet', r'выход\S*,?\s+сжатого|^соединение$|^присоединительн|соединение по воздуху'),
    ('receiver', r'ресивер|^объ[её]м$'),
    ('dryer', r'встроенн\S*\s+осушител|модель осушителя'),
    ('filters', r'встроенн\S*\s+фильтр|тип фильтров|фильтры в составе'),
    ('voltage', r'напряжени'),
    ('refrigerant', r'^(?!.*компрессор).*хлад(о|а)гент'),
    ('controller', r'контроллер'),
    ('cartridge', r'картридж|катридж'),
    ('purity', r'чистот'),
    ('country', r'страна'),
    ('ip', r'степень защиты'),
    ('rpm', r'скорост\S*\s+вращени'),
]
SPEC_LABEL = {
    'pressure_min': 'Минимальное давление',
    'pressure_in': 'Давление на входе',
    'vacuum': 'Максимальное разрежение',
    'pressure': 'Давление',
    'flow': 'Производительность',
    'power': 'Мощность',
    'dims': 'Габариты (Д × Ш × В)',
    'mass': 'Масса',
    'mass_ads': 'Масса адсорбента',
    'noise': 'Уровень шума',
    'outlet': 'Выход сжатого воздуха',
    'receiver': 'Объём ресивера',
    'dryer': 'Встроенный осушитель',
    'filters': 'Встроенные фильтры',
    'voltage': 'Напряжение',
    'refrigerant': 'Хладагент',
    'controller': 'Контроллер',
    'cartridge': 'Картридж',
    'purity': 'Чистота',
    'rpm': 'Скорость вращения',
}
SPEC_DROP = re.compile(
    r'^(аналог|примечание|все характеристики|new price|количество комментариев|тема форума|похожие товары)', re.I
)
# единица в названии характеристики («Давление, атм.», «Габариты, см») — переносится в значение
KEY_UNIT = re.compile(
    r'^(.*?\S)\s*,\s*(атм\.?|бар|л\.?|л/мин\.?|квт(?:/в)?|см|мм|кг\.?|дба|дб\(а\)|°\s?[cс]|град,?\s*°?[cс]|г/час|лет|'
    r'м³/мин|м3/мин|мг/м³|мг/м3|мкм|м²/ч|м2/ч|м|час|дюйм)$',
    re.I,
)
UNIT_FIX = {
    'атм.': 'атм',
    'л.': 'л',
    'л/мин.': 'л/мин',
    'кг.': 'кг',
    'дба': 'дБ(А)',
    'квт': 'кВт',
    'м3/мин': 'м³/мин',
    'мг/м3': 'мг/м³',
    'м2/ч': 'м²/ч',
}
# подписи прайса и сайта АСО → одна подпись для одинаковых характеристик
SPEC_RENAME = [
    (r'^(макс\.?\s*раб(\.|очее)?\s*давл(\.|ение)?|макс\.?\s*давление|рабочее давление|давление)$', 'Давление'),
    (r'^мин\.?\s*давление$', 'Минимальное давление'),
    (r'^(произв\.?|производит\.?)$', 'Производительность'),
    (
        r'^(произв\.?\s*привед\.?\s*к\s*н\.?\s*услов\.?|произв\.?\s*по\s*нагнетанию)$',
        'Производительность по нагнетанию',
    ),
    (r'^произв\.?\s*при оборотах$', 'Производительность при оборотах'),
    (r'^произв(\.|одительность)?\s*по очистке( поверхности)?$', 'Производительность по очистке'),
    (r'^(объем ресивера|ресивер)$', 'Объём ресивера'),
    (r'^объем$', 'Объём'),
    (r'^объем камеры$', 'Объём камеры'),
    (r'^(вход\s*/\s*выход|выход)$', 'Вход/выход'),
    (r'^(сталь|марка стали)$', 'Марка стали'),
    (r'^расход абразива на 1\s*м[2²]\*?$', 'Расход абразива на 1 м²'),
    (r'^рекоменд\.?\s*рабочее давление$', 'Рабочее давление'),
]
POWER_KEY = re.compile(r'^(привод|эл\.?\s*питание|электропривод)$', re.I)


def _spec_rows(k, v) -> list:
    """Строка характеристики → строки каталога: единица — в значение, составные значения — по строкам."""
    k = re.sub(r'\s+', ' ', re.sub(r'^[PР](?=асход)', 'Р', str(k or '').strip()))
    k = re.sub(r'(?i)производит\s+ельн', 'Производительн', k)  # перенос внутри слова в шапке прайса
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    k = re.sub(r'^C(?=тепень)', 'С', k)
    unit = ''
    match = KEY_UNIT.match(k) or re.match(r'^(.*?\S)\s+(мг/м3|мг/м³|мкм)$', k)  # «Степень очистки по воде мг/м3»
    if match:
        k, unit = match.group(1), match.group(2)
    match = re.match(
        r'^(наружное покрытие),\s*(.+)$', k, re.I
    )  # «Наружное покрытие, полиэфирная порошковая краска: RAL 5010»
    if match:
        k, v = match.group(1), f'{match.group(2)} {v}'
    unit = re.sub(r'^град,?\s*°?[cс]$|^°\s?[cс]$', '°C', unit, flags=re.I)
    unit = UNIT_FIX.get(unit.lower(), unit)
    v = re.sub(r'(?<=\d)\s*град,?\s*°?[CС]$|(?<=\d)\s*°\s?С$', ' °C', v)
    for regex, label in SPEC_RENAME:
        if re.match(regex, k, re.I):
            k = label
            break
    if POWER_KEY.match(k):
        main = 'Мощность' if re.match(r'^эл', k, re.I) else 'Мощность двигателя'
        if not re.match(r'^\d', v):
            return [('Двигатель', v)] if v else []
        parts = [x.strip() for x in re.split(r'\s*/\s*', v) if x.strip()]
        out = []
        for i, x in enumerate(parts[:2]):
            num_text = re.sub(r'\s*(кВт|В)$', '', x, flags=re.I).replace('.', ',')
            num_text = re.sub(r'\s*[*×xх]\s*', ' × ', num_text)  # «2*75» — два двигателя
            match = re.match(r'^([\d ×,]+?)\s*(\(.*\))$', num_text)  # «11(S=1,15)» → «11 кВт (S=1,15)»
            u = 'В' if i == 1 else 'кВт'
            out.append(
                (
                    'Напряжение' if i == 1 else main,
                    f'{match.group(1)} {u} {match.group(2)}' if match else f'{num_text} {u}',
                )
            )
        return [_spec_fix(first, second) for first, second in out]
    v = re.sub(r'^(\d+)\.(\d+)$', r'\1,\2', v)
    if (
        unit
        and re.match(r'^([-+−≤<]?\s*\d|до\b|от\b|не более|не менее)', v, re.I)
        and not re.search(r'[a-zа-я°³²"]\.?\s*$', v, re.I)
    ):
        v = f'{v} {unit}'
    if unit == 'кВт' and re.match(r'^\d+\s*[*×xх]\s*\d', v):
        v = re.sub(r'\s*[*×xх]\s*', ' × ', v)
    if spec_class(k) == 'dims':
        nums = re.findall(r'\d+(?:[.,]\d+)?', v)
        if re.search(r'см\s*$', v) or (unit == 'см' and nums):
            v = re.sub(r'\s*(см|мм)\s*$', '', v)
            vals = [float(x.replace(',', '.')) for x in nums]
            if vals and max(vals) < CM_VALUES_BELOW:  # «7515*2540*2495» с подписью «см» — это уже миллиметры
                v = ' × '.join((f'{x * 10:g}').replace('.', ',') for x in vals)
            else:
                v = re.sub(r'\s*[*×xхX]\s*', ' × ', v)
            v += ' мм'
    if re.match(r'^условия эксплуатации|температур', k, re.I) and re.search(r'\d$', v) and '°' not in v:
        v += ' °C'
    return [_spec_fix(k, v)]


_SPEC_SEEN: dict = {}  # подпись характеристики → класс: одни и те же подписи у тысяч позиций разбираются один раз


def spec_class(key) -> str:
    key = str(key or '')
    cached = _SPEC_SEEN.get(key)
    if cached is not None:
        return cached
    k = re.sub(r'\s*\([^)]*\)\s*$', '', key).strip().lower()
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', k)  # «Производи-тельность» — перенос в ячейке прайса
    k = k.replace('производитсть', 'производительность')  # «Производит-сть» — сокращение в шапке прайса
    cached = next((cached for cached, regex in SPEC_CLASS if re.search(regex, k)), None) or 'k:' + re.sub(
        r'[^а-яa-z0-9]', '', k
    )
    if len(_SPEC_SEEN) < SPEC_SEEN_MAX:
        _SPEC_SEEN[key] = cached
    return cached


def _tidy_label(k) -> str:
    k = re.sub(r'\s+', ' ', str(k or '')).strip(' *:')
    k = re.sub(r'\*+$', '', k).strip()
    words = k.split(' ')
    if (
        len(words) == GLUED_WORDS and words[0].lower() == words[1].lower()
    ):  # «Ширина ширина» — склейка объединённых ячеек
        k = words[0]
    k = re.sub(r'\s*\((Д[/хx×]Ш[/хx×]В)\)|\s+Д[/хx×]Ш[/хx×]В$', '', k)
    k = (
        k.replace('Производи-тельность', 'Производительность')
        .replace('Производит-сть', 'Производительность')
        .replace('Присое-динение', 'Присоединение')
        .replace('приблизительно', '')
        .replace('Максиальное', 'Максимальное')
        .strip()
    )
    if re.fullmatch(r'[A-ZА-Я]', k):
        k = 'Размер ' + k
    return k[:60]


EMPTY_VALS = {'-', '—', '–', 'нет данных', 'n/a', 'нет', ''}


def _spec_fix(k, v) -> tuple:
    """Строка характеристики без прочерков, единицы — без скобок, подписи — как в каталоге."""
    k = re.sub(r'(?<=[а-я])-(?=[а-я])', '', str(k or '').strip())
    v = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    if v.lower() in EMPTY_VALS or re.match(r'^[а-яa-z]', k) or re.match(r'^артикул\s*\d', k, re.I):
        return k, ''  # «имеют температурный режим…», «Артикул 6006400004» — обрывки примечаний прайса
    match = re.match(r'^(?:размер\s+)?([A-HА-ЕНa-h])(?:\s*\(мм\))?$', k, re.I)
    if match:  # размеры на чертеже: «A (мм)», «Размер А» (кириллица) — одинаково
        lat = match.group(1).upper().translate(str.maketrans('АВСЕН', 'ABCEH'))
        k = f'Размер {lat}, мм'
        v = re.sub(r'\s*мм$', '', v)
    v = re.sub(r'\s*\((м³/мин|м3/мин|м³/ч|м3/ч|л/мин|нм3/час|нм³/ч|бар|л|кг|мм|кВт|дБ)\)', r' \1', v)
    for regex, replacement in (
        (r'(?<=\d)\s*bar\b', ' бар'),
        (r'(?<=\d)\s*m3/min\b', ' м³/мин'),
        (r'(?<=\d)\s*dB\s*\(A\)', ' дБ(А)'),
        (r'(?<=\d)\s*dB\b', ' дБ'),
        (r'^IP\s+(\d\d)$', r'IP\1'),
        (r'(?<=\d)\s*kW\b', ' кВт'),
        (r'(?<=\d)\s*V\b', ' В'),
        (r'(?<=\d)\s*Hz\b', ' Гц'),
        (r'\s*В/Гц$', ''),
        (r'\bБар\b', 'бар'),
        (r'(?<=\d)\s*(нм3|нм³)\s*/\s*час?\b', ' нм³/ч'),
        (r'(?<=\d)\s*м3\s*/\s*(мин|час|ч)\b', r' м³/\1'),
        (r'(?<=\d)м³', ' м³'),
        (r'м³/час\b', 'м³/ч'),
        (r"''|”|“", '"'),
        (r'(?<=\d)\s*литр\w*', ' л'),
        (r'Гц\s+В$', 'Гц'),
    ):
        v = re.sub(regex, replacement, v, flags=re.I)
    if re.match(r'^степень защиты', k, re.I) and re.match(r'^IE\d', v):
        k = 'Класс энергоэффективности'
    cls_name = spec_class(k)
    if cls_name == 'dims':  # «1940 X 950 X 2125 ДхШхВ мм» → «1940 × 950 × 2125 мм»
        v = re.sub(r'\(?\s*Д\s*[хx×]\s*Ш\s*[хx×]\s*В\s*\)?', ' ', v, flags=re.I)
        v = re.sub(r'(?<=\d)\s*[xхX×]\s*(?=\d)', ' × ', v).strip()
        v = re.sub(r'\s+', ' ', v)
        if re.search(r'\d$', v):
            v += ' мм'
    if cls_name == 'receiver' and re.fullmatch(r'\d+(?:\s*[×x]\s*\d+)?', v):
        v = re.sub(r'\s*[×x]\s*', ' × ', v) + ' л'
    if cls_name == 'flow' and re.fullmatch(r'\d+(?:[.,]\d+)?', v) and not re.search(r'\(', k):
        num = float(v.replace(',', '.'))
        v = (f'{v} л/мин') if num >= LPM_FROM else (f'{v} м³/мин')
    return k, v


def merge_specs(parse_rows, price_specs) -> list:
    """Характеристики: парс, затем прайс; одинаковые параметры — значение прайса (точнее)."""
    rows: list = []
    idx = {}
    for k, v in (row for pair in parse_rows for row in _spec_rows(*pair)):
        if SPEC_DROP.match(k) or not v:
            continue
        cls_name = spec_class(k)
        if cls_name in idx:
            continue
        idx[cls_name] = len(rows)
        rows.append([k, v])
    dims = {}
    for k, v in (row for pair in price_specs for row in _spec_rows(*pair)):
        if SPEC_DROP.match(k) or not v:
            continue
        cls_name = spec_class(k)
        if cls_name in ('length', 'width', 'height'):
            dims[cls_name] = (_tidy_label(k), v)
            continue
        label = SPEC_LABEL.get(cls_name) or _tidy_label(k)
        if cls_name in idx:
            if (
                not str(rows[idx[cls_name]][1]).lower().startswith(str(v).lower())
            ):  # «YNT55A (Baosi)» в парсе полнее «YNT55A» прайса
                rows[idx[cls_name]][1] = v  # прайс точнее парса
        else:
            idx[cls_name] = len(rows)
            rows.append([label, v])
    if len(dims) == DIMS_COUNT and all(re.search(r'^[\d.,\s]+(мм)?$', str(dims[cls_name][1])) for cls_name in dims):
        v = '{} × {} × {} мм'.format(
            *tuple(re.sub(r'\s*мм$', '', str(dims[cls_name][1])) for cls_name in ('length', 'width', 'height'))
        )
        if 'dims' in idx:
            rows[idx['dims']][1] = v
        else:
            rows.append([SPEC_LABEL['dims'], v])
    else:  # одна «Длина» (рукав 10 м) — это не габариты
        rows += [
            [dim_label, v]
            for cls_name, (dim_label, v) in dims.items()
            if cls_name not in idx and not ('dims' in idx and cls_name != 'length')
        ]  # «Высота H» фильтра — уже в габаритах
    return [(k, str(v)[:300]) for k, v in rows]
