"""Сопоставление прайса со страницами и моделями: подпись и код модели, давление и ресивер исполнения."""

import json
import re
from typing import Any

from num import Num

SIG_MIN = 2
RECEIVER_MIN = 50
PRICE_NAME_MAX = 90
PRICE_NAME_WORDS = 9
CODE_MIN = 3
SHORT_UP_MAX = 5
NUMS_WITH_RECEIVER = 3
NUMS_WITH_PRESSURE = 2
PRESSURE_CODE_MAX = 50
RECEIVER_MAX = 3000
PRESSURE_ALIAS: dict[float, float] = {7: 7.5}  # «7 бар» в названиях и характеристиках — исполнение 7,5 бар


def _norm(text) -> str:
    text = (
        str(text or '')
        .lower()
        .replace('ё', 'е')
        .replace('х', 'x')
        .replace('–', '-')
        .replace('—', '-')
        .replace(',', '.')
    )
    text = re.sub(r'\s*\((?:compact|o)\)\s*$', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def name_key(text) -> str:
    """Название для сравнения: только буквы и цифры («DVK 30 (O)» → «dvk30»)."""
    return re.sub(r'[^a-z0-9а-я]', '', _norm(text))


def _model_key(text) -> str:
    """Код модели из названия: слова с цифрами и латиница заглавными («Осушитель DryAir DA 440» → «dryairda440»)."""
    words = [
        word
        for word in re.split(r'\s+', str(text or ''))
        if re.search(r'\d', word)
        or (len(word) > 1 and re.fullmatch(r'[A-Za-z][A-Za-z-]*', word) and word.upper() == word)
    ]
    return name_key(' '.join(words))


def _model_set(text) -> frozenset | None:
    """Те же слова модели, но как множество — порядок слов в прайсе и на сайте бывает разным («EAGLE-N VSD 132 7,5 BAR» и «EAGLE-N 132-7,5 VSD»)."""
    words: list = []
    for word_raw in re.split(r'[\s/]+', str(text or '').replace('–', '-').replace('—', '-')):
        word = word_raw.strip('(),;')
        if (
            not word
            or word.lower() in ('bar', 'бар')
            or not (re.search(r'\d', word) or re.fullmatch(r'[A-Z][A-Z-]*', word))
        ):
            continue
        words.extend(x.lower().replace(',', '.') for x in re.split(r'-(?=[A-Za-z\d])', word) if x)
    return frozenset(words) if len(words) >= SIG_MIN else None


def _char(page, regex) -> str:
    for k, v in page.get('chars') or []:
        if re.search(regex, k, re.I):
            text = str(v).strip()
            return '' if text in ('-', '—', '–', 'нет', 'Нет') else text
    return ''


def page_cfg(page) -> dict:
    """Исполнение позиции парса: по названию и характеристикам (давление, ресивер, осушитель) — как model_cfg у прайса."""
    cfg = model_cfg(page['name'], page['name'])
    pressure = Num.parse(re.sub(r'[^\d,.]', '', _char(page, r'^давление')).replace(',', '.') or None)
    if pressure:
        cfg['p'] = pressure
    recv = _char(page, r'объ[её]м ресивера')
    match2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', recv, re.I)  # «2 × 270» — два ресивера
    rec = int(match2.group(1)) * int(match2.group(2)) if match2 else Num.parse(re.sub(r'[^\d,.]', '', recv) or None)
    if rec and rec >= RECEIVER_MIN:
        cfg['rec'] = int(rec)
    if _char(page, r'модель осушителя') or re.search(r'\d+d$', (page.get('url') or '').rstrip('/'), re.I):
        cfg['dry'] = True
    return cfg


def lat_series(cfg) -> tuple:
    """Латинские серии исполнения (Dalgakiran: «DVK», «TIDY») — по ним сопоставляются позиции парса, прайса и каталога."""
    return tuple(
        sorted(ser for ser in cfg['ser'] if re.match(r'^[A-Z]', ser) and ser != 'R')
    )  # R — резьба «R1 1/2"», не серия


def _cfg_key(cfg) -> tuple:
    pressure = PRESSURE_ALIAS.get(cfg['p'], cfg['p'])  # в прайсе «7» и «7,5» — одно исполнение (на сайте — 7,5)
    return (lat_series(cfg), cfg['size'], pressure, cfg['rec'], cfg['dry'], cfg['vsd'], cfg['w'])


def cfg_compatible(cfg_a, cfg_b) -> bool:
    """Не противоречат ли исполнения: серия (латинские слова), типоразмер, частотник, водяное охлаждение. Без серии — не судим."""
    if not lat_series(cfg_a) or not lat_series(cfg_b) or cfg_a['size'] is None or cfg_b['size'] is None:
        return True
    if (
        lat_series(cfg_a) != lat_series(cfg_b)
        or cfg_a['size'] != cfg_b['size']
        or cfg_a['vsd'] != cfg_b['vsd']
        or cfg_a['w'] != cfg_b['w']
    ):
        return False
    key_a, key_b = _cfg_key(cfg_a), _cfg_key(cfg_b)
    if cfg_a['p'] and cfg_b['p'] and key_a[2] != key_b[2]:  # давление известно с обеих сторон — должно совпасть
        return False
    return cfg_a['rec'] == cfg_b['rec'] and cfg_a['dry'] == cfg_b['dry']


def unique_names(pages) -> list:
    """Одинаковые названия в парсе — уникальными по исполнению (давление, ресивер, D); копии — убираются."""
    groups: dict = {}
    out = []
    seen = set()
    for page_rec in pages:
        groups.setdefault(page_rec['name'], []).append(page_rec)
    for page in pages:
        page_rec = page
        same = groups[page_rec['name']]
        if len(same) > 1:
            cfg = page_cfg(page_rec)
            suf = ''
            if cfg['p']:
                suf += '-' + ('{:g}'.format(cfg['p'])).replace('.', ',')
            recv = _char(page_rec, r'объ[её]м ресивера')
            match2 = re.match(r'^\s*(\d+)\s*[xх×]\s*(\d+)', recv, re.I)
            if match2:
                suf += f'-{match2.group(1)}×{match2.group(2)}'
            elif cfg['rec']:
                suf += '-' + str(cfg['rec'])
            if cfg['dry']:
                suf += 'D'
            if suf and not re.search(re.escape(suf) + r'$', page_rec['name']):
                page_rec = dict(
                    page_rec, name=page_rec['name'] + suf, model=((page_rec.get('model') or '') + suf).strip('-')
                )
        sig = (page_rec['name'], json.dumps(page_rec.get('chars') or [], ensure_ascii=False))
        if sig in seen:
            continue  # та же позиция на сайте дважды
        seen.add(sig)
        out.append(page_rec)
    names: dict = {}
    for page_rec in out:
        names.setdefault(page_rec['name'], []).append(page_rec)
    for name, lst in names.items():  # всё ещё одинаковые (разная производительность) — с номером варианта
        for i, page_rec in enumerate(lst[1:], 2):
            page_rec['name'] = f'{name} (вариант {i})'
    return out


def match_prices(pages, prices) -> tuple:
    """Каждой позиции парса — строка прайса по исполнению, названию, модели, коду изделия."""
    by_norm: dict = {}
    by_key: dict = {}
    by_model: dict = {}
    by_short: dict = {}
    by_set: dict = {}
    by_cfg: dict = {}
    for price in prices:
        if (
            len(price['name']) > PRICE_NAME_MAX or len(price['name'].split()) > PRICE_NAME_WORDS
        ):  # примечания и сноски в столбце названий — не товары
            continue
        by_norm.setdefault(_norm(price['name']), price)
        by_key.setdefault(name_key(price['name']), price)
        cfg = model_cfg(price['name'])
        price['_cfg'] = cfg
        if lat_series(cfg) and cfg['size'] is not None:
            by_cfg.setdefault(_cfg_key(cfg), []).append(price)
        model_key = _model_key(price['name'])
        if model_key:
            by_model.setdefault(model_key, []).append(price)
        if price['short']:
            by_short.setdefault(name_key(price['short']), []).append(price)
        model_set = _model_set(price['name'])
        if model_set:
            by_set.setdefault(model_set, []).append(price)

    by_code: dict = {}
    by_sig: dict = {}
    for price in prices:
        for code in {_code(price['name']), _code(price['short'])} - {''}:
            by_code.setdefault(code, []).append(price)
        for name_match in [price['name']] + [
            re.sub(r'\s+EKON$', '', v, flags=re.I) for k, v in price['specs'] if re.match(r'^модель\b', k, re.I)
        ]:  # «Модель Liutech»
            core, opt = _sig(name_match)
            if len(core) >= SIG_MIN and any(re.search(r'\d', x) for x in core):
                by_sig.setdefault(core, []).append((opt, price))
                if price.get('pbar'):  # «LENTO 15 LK» без давления в названии — строки «… -6 / -8 / -10»
                    by_sig.setdefault((*core[:-1], '*'), []).append((opt, price))

    def one(
        lst,
    ) -> dict | None:  # модель → строка прайса, только если все строки этой модели с одной ценой (иначе — не угадывать)
        if not lst:
            return None
        priced = [cand for cand in lst if cand['price']] or lst
        priced = [cand for cand in priced if not cand.get('sale')] or priced  # РРЦ важнее строки распродажи
        return priced[0] if len({cand['price'] for cand in priced}) == 1 else None

    hit, how = {}, {'cfg': 0, 'name': 0, 'key': 0, 'model': 0, 'short': 0, 'set': 0}
    for page in pages:
        cfg = page_cfg(page)
        price = one(by_cfg.get(_cfg_key(cfg))) if lat_series(cfg) and cfg['size'] is not None and cfg['p'] else None
        if price:
            how['cfg'] += 1
            hit[page['url']] = price
            continue
        model_key = _model_key(page['name']) or name_key(page.get('model'))
        model_set = _model_set(page['name'])
        steps = (
            ('name', lambda page_rec=page: by_norm.get(_norm(page_rec['name']))),
            ('key', lambda page_rec=page: by_key.get(name_key(page_rec['name']))),
            ('model', lambda mkey=model_key: one(by_model.get(mkey)) if mkey else None),
            (
                'short',
                lambda page_rec=page: one(by_short.get(name_key(page_rec['model']))) if page_rec.get('model') else None,
            ),
            ('set', lambda mset=model_set: one(by_set.get(mset)) if mset else None),
            ('code', lambda page_rec=page: _by_code(page_rec['name'], by_code)),
        )
        price = None
        for step, find in steps:  # по очереди — до первого найденного
            price = find()
            if price:
                how[step] = how.get(step, 0) + 1
                break
        if price and not cfg_compatible(cfg, price.get('_cfg') or model_cfg(price['name'])):
            how['rejected'] = how.get('rejected', 0) + 1  # «DVK 75-7» ≠ «DVK D 75-7»: другое исполнение
            price = None
        if not price:
            price = _by_sig(
                page, by_sig, one
            )  # последний шаг: «EXDM 5.5/7 IP54» = «EXDM 5,5/7 IP54», «G-Drive-T-20-7» = «G Drive T 20-7»
            if price:
                how['sig'] = how.get('sig', 0) + 1
        if price:
            hit[page['url']] = price
    used = {id(price) for price in hit.values()}
    return hit, {'matched': len(hit), 'how': how, 'priceOnly': sum(1 for price in prices if id(price) not in used)}


LAT_CYR = str.maketrans('АВЕКМНОРСТХ', 'ABEKMHOPCTX')
SIG_BRANDS = re.compile(r'^(EXELUTE|LUPAMAT|ALMIG|LIUTECH|TEWATT|DALGAKIRAN|REMEZA)$')
SIG_OPT = re.compile(r'^(IP\d\d|ZONCN|OMRON|INNOVANCE|INOVANCE|YASKAWA|MITSUBISHI)$')


def _sig(name) -> tuple:
    """Подпись модели из названия → (серия, размер, исполнение) для сравнения с прайсом."""
    text = re.sub(r'\([^)]*\)', ' ', str(name or '')).upper().replace(',', '.')
    text = re.sub(r'\bIP\s+(\d\d)\b', r'IP\1', text)  # «IP 54»
    text = re.sub(r'\bZONCH\b', 'ZONCN', text).replace('INNOVANCE', 'INOVANCE')  # опечатки в выгрузке склада
    text = re.sub(r'(IP\d\d)-\d+-\d+', r'\1', text)  # «IP54-10-54» — хвост выгрузки сайта
    text = re.sub(r'\b[A-Z]+/[A-Z]+\b', ' ', text)  # «OMRON/INOVANCE» — любой из двух
    words = [
        word.translate(LAT_CYR) for word in text.split() if not re.fullmatch(r'[А-ЯЁ.:-]+', word)
    ]  # «ВИНТОВОЙ» — не код
    text = ' '.join(words)
    text = re.sub(r'\b(?!IP\d)([A-Z]{2,})(\d{2,})\b', r'\1 \2', text)  # «XED180», «LUY130-12»
    text = re.sub(r'\bDHK\d\b', 'DHK', text)
    toks = [x.strip('.') for x in re.split(r'[\s\-]+', text)]
    toks = [x for x in toks if x and not SIG_BRANDS.match(x)]
    return tuple(x for x in toks if not SIG_OPT.match(x)), frozenset(x for x in toks if SIG_OPT.match(x))


def _code(text) -> str:
    """Код изделия из названия латиницей («РВ 500/10» → «PB500/10»)."""
    run = _code_run(text)
    code = re.sub(r'[\s.\-]', '', ''.join(run)).upper().replace(',', '.').translate(LAT_CYR)
    return code if len(code) >= CODE_MIN else ''


def _code_run(text) -> list:
    """Слова кода изделия в названии: первое слово с цифрой и соседние короткие заглавные («РВ», «АСО-ВК», «ESQ»)."""
    words = [word.strip(',;:') for word in re.sub(r'\([^)]*\)', ' ', str(text or '')).split()]
    words = [word for word in words if word]
    i = next((k for k, word in enumerate(words) if re.search(r'\d', word)), None)
    if i is None:
        return []

    def short_up(token) -> Any:
        return re.fullmatch(r'[A-ZА-ЯЁ][A-ZА-ЯЁ-]*', token) and len(token.replace('-', '')) <= SHORT_UP_MAX

    first, second = i, i + 1
    while first > 0 and short_up(words[first - 1]):
        first -= 1
    while second < len(words) and (
        re.search(r'\d', words[second]) or short_up(words[second]) or words[second].startswith('-')
    ):
        second += 1
    return words[first:second]


def code_cfg(name, model='') -> dict | None:
    """Исполнение по коду изделия русских моделей (серия, размер, давление, ресивер)."""
    for src in (model, name):
        run = _code_run(src)
        if run and len(run) > 1 and re.fullmatch(r'АСО|ASO', run[0], re.I) and re.match(r'[A-ZА-ЯЁ]+\d', run[1]):
            run = run[1:]  # «АСО К1/10» — марка завода, а не серия «АСО-К»
        raw = ' '.join(run).upper().translate(LAT_CYR).replace(',', '.')
        match = re.match(r'^([A-ZА-ЯЁ]+(?:[\s-]+[A-ZА-ЯЁ]+)?)[\s-]*(\d+(?:\.\d+)?)(.*)$', raw)
        if match:
            break
    else:
        return None
    rest, low = match.group(3), (str(name or '') + ' ' + str(model or '')).lower()
    pic_match = re.search(r'/\s*(\d+(?:\.\d+)?)', rest)
    rec = re.search(r'-\s*(\d{3,4})\b', rest[pic_match.end() :] if pic_match else '')
    gen = re.search(r'(?:^|[/\d\s.])([MH]\d?Э?)(?=$|[\s.\-/]|OB)', rest)  # «КТ16МЭ» — поколение «МЭ», не «М»
    var = re.match(r'^\s*-\s*(\d{2})\b', rest)
    flags = set(re.findall(r'ESQ|ПЭ|ПД|ГЦ|Ц\b', rest.replace('ГЦ', ' ГЦ ')))
    return {
        'ser': re.sub(r'[\s-]', '', match.group(1)),
        'size': float(match.group(2)),
        'cyr': bool(re.search(r'[А-ЯЁ]', ' '.join(run).upper())),
        'p': float(pic_match.group(1)) if pic_match else None,
        'rec': int(rec.group(1)) if rec else None,
        'gen': gen.group(1) if gen else '',
        'var': var.group(1) if var else '',
        'dry': bool(re.search(r'\bOB\b|OB-|\.OB|M\dOB', rest) or 'осушител' in low),
        'vsd': 'ESQ' in flags or bool(re.search(r'частотн', low)),
        'flags': sorted(flags - {'ESQ'}),
    }


def _by_sig(page, by_sig, one) -> dict | None:
    """Строка прайса с той же подписью модели (степень защиты и частотник — совпадают)."""
    core, opt = _sig(page['name'])
    if len(core) < SIG_MIN:
        return None
    cands = [(opt_n, price) for opt_n, price in by_sig.get(core, []) if opt_n <= opt]
    if not cands:
        bar = next((v for k, v in page.get('chars') or [] if re.search(r'давлен', k, re.I)), '')
        nums = re.findall(r'\d+(?:[.,]\d+)?', str(bar))
        pairs = by_sig.get((*core, '*'), [])
        cands = [
            (opt_n, price)
            for opt_n, price in pairs
            if opt_n <= opt and nums and Num.parse(price.get('pbar')) == Num.parse(nums[-1])
        ] or [(opt_n, price) for opt_n, price in pairs if opt_n <= opt]
    if not cands:
        return None
    best = max(len(opt_n) for opt_n, _ in cands)
    return one([price for opt_n, price in cands if len(opt_n) == best])


def _by_code(name, by_code) -> dict | None:
    """Строка прайса с тем же кодом изделия; несколько — ближайшая по словам."""
    code = _code(name)
    lst = by_code.get(code)
    if not lst:
        return None

    def words(x) -> set:
        return {word[:5] for word in re.findall(r'[а-яёa-z]{3,}', str(x).lower())}

    mine = words(name)

    # код в модели надёжнее кода в номенклатуре (в прайсе АСО у «РГ 110/10» номенклатура «РЕСИВЕР РВ110/16»)
    def score(price) -> int:
        return (
            (_code(price['name']) == code) * 10
            + len(mine & (words(price['name']) | words(price['short']))) * 2
            - len(words(price['name']) - mine)
        )

    best = sorted(lst, key=score, reverse=True)
    if len(best) > 1 and score(best[0]) == score(best[1]) and best[0]['price'] != best[1]['price']:
        return None
    return best[0]


# Карточка, заведённая вручную, описывает модель целиком («TIDY-N 15 с ресивером и осушителем», давление 7,5 / 8,5 / 10 / 13 бар),
# а прайс — каждое исполнение отдельно («TIDY-N 15-7,5-250D»). Цена у давлений до 13 бар одна, отличается исполнение:
# ресивер (250 / 500 л), осушитель (D после ресивера или ID), водяное охлаждение (W), частотник (VSD). Сопоставление — по серии,
# типоразмеру и исполнению; давление не учитывается, если цены совпадают.
CFG_SKIP = {
    'КОМПРЕССОР',
    'ВИНТОВОЙ',
    'БЕЗМАСЛЯНЫЙ',
    'ПОРШНЕВОЙ',
    'СПИРАЛЬНЫЙ',
    'ДВУХСТУПЕНЧАТЫЙ',
    'ДОЖИМНОЙ',
    'DALGAKIRAN',
    'COMPACT',
    'BAR',
    'БАР',
}


def model_cfg(model, text='') -> dict:
    """Модель → исполнение {ser, size, p, rec, dry, vsd} для сравнения карточек и прайса."""
    model_text = re.sub(r'\([^)]*\)', ' ', str(model or '').replace('\\', '')).upper().replace(',', '.')
    model_text = re.sub(r'(?<=\d)\s*[XХ×]\s*(?=\d)', 'X', model_text)  # «2х270», «2 × 270» → «2X270»
    low_text = str(text or '').lower()
    cfg: dict[str, Any] = {'ser': set(), 'size': None, 'p': None, 'rec': None, 'dry': False, 'vsd': False, 'w': False}
    nums = []
    for tok in re.split(r'[\s/]+', model_text):
        if not tok:
            continue
        if tok in ('VSD', 'VFD'):
            cfg['vsd'] = True
            continue
        if tok == 'ID':
            cfg['dry'] = True
            continue
        if tok == 'W':  # «EAGLE-N VSD 200 10 BAR W» — водяное охлаждение
            cfg['w'] = True
            continue
        parts = []
        for x in tok.split('-'):
            group_match = re.match(r'^([A-ZА-Я]{2,})(\d+(?:\.\d+)?)$', x)  # «DS11» → «DS», «11»
            parts += [group_match.group(1), group_match.group(2)] if group_match else ([x] if x else [])
        for x in parts:
            num_match = re.match(r'^(\d+(?:\.\d+)?)([A-ZА-Я]*)$', x)
            if num_match:
                nums.append(float(num_match.group(1)))
                suf = num_match.group(2)
                if suf == 'W':
                    cfg['w'] = True
                elif suf == 'D' and len(nums) >= NUMS_WITH_RECEIVER:  # «-250D» — ресивер с осушителем
                    cfg['dry'] = True
                elif suf == 'D':  # «DVK 220D» — серия с прямым приводом
                    cfg['ser'].add('D')
                continue
            if re.match(r'^\d+X\d', x):  # «2X270D» — два ресивера
                match = re.match(r'^(\d+)X(\d+)(D?)$', x)
                if match:
                    cfg['rec'] = int(match.group(1)) * int(match.group(2))
                    cfg['dry'] = cfg['dry'] or bool(match.group(3))
                continue
            if re.match(r'^[A-ZА-Я]+$', x) and x not in CFG_SKIP:
                cfg['ser'].add(x)
    if any(ser.startswith('INVERS') for ser in cfg['ser']):  # INVERSYS — всегда с частотным преобразователем
        cfg['vsd'] = True
    if 'DS' in cfg['ser']:  # спиральные DS: S/D/T/Q — число головок, не серия
        cfg['ser'] -= {'S', 'D', 'T', 'Q'}
    if nums:
        cfg['size'] = nums[0]
    if len(nums) >= NUMS_WITH_PRESSURE and nums[1] <= PRESSURE_CODE_MAX:
        cfg['p'] = nums[1]
    if len(nums) >= NUMS_WITH_RECEIVER and RECEIVER_MIN <= nums[2] <= RECEIVER_MAX:
        cfg['rec'] = int(nums[2])
    if re.search(r'частот|инвертор|\bvsd\b', low_text):
        cfg['vsd'] = True
    if re.search(r'водян', low_text):
        cfg['w'] = True
    if re.search(
        r'(с|со встроенным|и)\s+осушител', low_text
    ):  # «с ресивером и осушителем»; сам «Осушитель DK 10» — не признак
        cfg['dry'] = True
    match2 = re.search(r'ресивер\S*\s*(\d{3,4})', low_text)
    if match2:
        cfg['rec'] = int(match2.group(1))
    elif re.search(r'(с|на) ресивер', low_text) and not cfg['rec']:
        cfg['rec'] = -1  # с ресивером, объём не указан
    return cfg
