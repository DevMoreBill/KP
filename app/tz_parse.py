"""Требования к станции из текста ТЗ правилами (без ИИ): каждое значение — с цитатой и страницей."""

import re

from num import Num

NUM = r'(\d+(?:[.,]\d+)?)'
MINUS = '−–-'
MINUS_RX = r'−–\-'  # те же знаки — внутри [ ] регулярного выражения
NOT_LETTER = r'(?<![А-Яа-яЁёA-Za-z])'
END_LETTER = r'(?![А-Яа-яЁёA-Za-z0-9])'


class TzParse:
    BAR_MIN = 0.5
    BAR_MAX = 400
    PDP_MIN = -100
    PDP_MAX = 20
    WATER_STRICT = 3
    PERCENT_MAX = 100
    LOAD_MIN = 5
    LOAD_MAX = 110
    ALT_MAX = 5000
    WARRANTY_MAX = 120
    WORK_MAX = 4
    RESERVE_MAX = 2
    CLIMATE_MIN = -70
    CLIMATE_MAX = 60
    NOISE_MIN = 40
    NOISE_MAX = 120
    RECEIVER_M3_MAX = 100
    INSULATION_MIN = 30
    INSULATION_MAX = 300
    NOTE_MIN = 25
    NOTE_MAX = 300
    NOTES_MAX = 6
    FIRE = ('А', 'Б', 'В1', 'В2', 'В3', 'В4', 'Г', 'Д')
    LOW_WINS = ('tmin',)  # противоречие: здесь требовательнее меньшее значение (холоднее), в остальных — большее

    def __init__(self, text) -> None:
        self.text = re.sub(r'[ \t\xa0]+', ' ', str(text or ''))
        self.low = self.text.lower()
        self.req: dict = {}
        self.found: list = []
        self.conflicts: list = []
        self.paged = '\f' in self.text

    @classmethod
    def parse(cls, text) -> dict:
        """{'kind', 'req': {…}, 'found': [{key, label, value, src, page}], 'conflicts', 'fields', 'questions', 'later'}"""
        parser = cls(text)
        parser.run()
        review = TzReview(parser)
        return {
            'kind': parser.req.get('kind', ''),
            'req': parser.req,
            'found': parser.found,
            'conflicts': parser.conflicts,
            'fields': review.fields(),
            'questions': review.questions(),
            'later': review.later(),
        }

    # ---- помощники
    def src(self, match) -> str:
        start, end = max(0, match.start() - 60), min(len(self.text), match.end() + 60)
        text = re.sub(r'\s+', ' ', self.text[start:end].replace('\f', ' ')).strip()
        return ('…' if start else '') + text + ('…' if end < len(self.text) else '')

    def page(self, match) -> int | None:
        """номер страницы цитаты (PDF) или None"""
        return self.text.count('\f', 0, match.start()) + 1 if match and self.paged else None

    def put(self, key, value, match, label) -> None:
        if key in self.req or value in (None, ''):
            return
        self.req[key] = value
        self.found.append(
            {
                'key': key,
                'label': label,
                'value': value,
                'src': self.src(match) if match else '',
                'page': self.page(match),
            }
        )

    def conflict(self, key, label, hits) -> None:
        """разные значения одного параметра в ТЗ: hits — [(значение, совпадение)]; одинаковые (до 2 %) — не противоречие."""
        vals: list = []
        for v, match in hits:
            if v is None or any(abs(v - x[0]) <= 0.02 * max(abs(v), abs(x[0]), 1e-9) for x in vals):
                continue
            vals.append((v, match))
        if len(vals) > 1:
            v, match = (min if key in self.LOW_WINS else max)(vals, key=lambda x: x[0])
            if key in self.req:
                self.req[key] = v
                for found in self.found:
                    if found['key'] == key:
                        found.update(value=v, src=self.src(match), page=self.page(match))
            self.conflicts.append(
                {
                    'key': key,
                    'label': label,
                    'value': v,
                    'values': [{'value': x, 'src': self.src(y), 'page': self.page(y)} for x, y in vals[:4]],
                }
            )

    def sentence(self, match) -> str:
        """предложение (пункт) с совпадением — от начала предложения до конца совпадения"""
        start = max(
            self.text.rfind('. ', 0, match.start()),
            self.text.rfind('\n', 0, match.start()),
            self.text.rfind('; ', 0, match.start()),
        )
        return self.text[start + 1 : match.end()]

    def all(self, regex, flags=re.I) -> list:
        return list(re.finditer(regex, self.text, flags))

    def first(self, regex, flags=re.I) -> re.Match | None:
        return re.search(regex, self.text, flags)

    @staticmethod
    def signed(sign, v) -> int:
        return -int(v) if sign and sign in MINUS else int(v)

    # ---- разбор
    def run(self) -> None:
        self.kind()
        k = self.req.get('kind')
        if k == 'comp':
            self.air()
            self.air_more()
        elif k == 'pump':
            self.pump()
        elif k == 'dgu':
            self.dgu()
            self.dgu_more()
        self.reserve()
        self.climate()
        self.site()
        self.terms()
        self.fire()
        self.noise()
        if k == 'comp':
            self.receiver()
        self.container()
        self.systems()
        self.options()
        self.notes()

    def kind(self) -> None:
        score = {
            'comp': len(re.findall(r'компрессор|сжат\w* воздух|пневмо|осушител|ресивер', self.low)),
            'pump': len(re.findall(r'насос|подач\w*|напор\w*|водоснабж|повысит\w* давлен|канализац', self.low)),
            'dgu': len(
                re.findall(
                    r'дизел\w*|дгу|дэс|электростанц|генератор\w*\s+установ|\d\s*ква'
                    + END_LETTER
                    + r'|резервн\w*\s+(?:источник|электроснабж)',
                    self.low,
                )
            ),
        }
        best = max(score, key=lambda kind: score[kind])
        if score[best]:
            names = {'comp': 'компрессорная', 'pump': 'насосная', 'dgu': 'дизель-генераторная'}
            match = re.search(
                {'comp': r'компрессор|сжат\w* воздух', 'pump': r'насос', 'dgu': r'дизел\w*|ДГУ|ДЭС|электростанц'}[best],
                self.text,
                re.I,
            )
            self.put('kind', best, match, 'Вид станции — ' + names[best])

    def air(self) -> None:
        u = r'(н?м3/мин|н?м³/мин|н?м3/ч|н?м³/ч|л/мин|л/с|nm3/min|m3/min)'
        match = self.first(
            r'(?:производительн\w*|расход\w*(?:\s+сжат\w*)?\s+воздух\w*|потребност\w*\s+в\s+сжат\w*\s+воздух\w*|объ[её]м\w* сжат\w* воздух\w*)'
            r'[^\n]{0,80}?' + NUM + r'\s*' + u
        ) or self.first(NUM + r'\s*' + u)

        def m3min(hit) -> float:
            v, unit = Num.of(hit.group(1)), hit.group(2).lower()
            return round(
                v / 60 if '/ч' in unit else v / 1000 if 'л/мин' in unit else v * 0.06 if 'л/с' in unit else v, 2
            )

        if match:
            self.put('flow', m3min(match), match, 'Производительность, м³/мин')
            if re.match(r'н|nm', match.group(2), re.I):
                self.put('basis', 'normal', match, 'Производительность — в нормальных м³ (0 °C, 101,325 кПа)')
            self.conflict(
                'flow',
                'Производительность, м³/мин',
                [
                    (m3min(x), x)
                    for x in self.all(
                        r'(?:производительн\w*\s+(?:станци\w*|компрессорн\w*)|потребност\w*\s+в\s+сжат\w*\s+воздух\w*|расход\w*\s+сжат\w*\s+воздух\w*)[^\n]{0,60}?'
                        + NUM
                        + r'\s*'
                        + u
                    )
                ],
            )
        PRESSURE = (
            r'(?:рабоч\w*\s+|избыточн\w*\s+|номинальн\w*\s+|выходн\w*\s+)?давлени\w*[^\n]{0,60}?'
            + NUM
            + r'\s*(бар|bar|мпа|кгс/см2|кгс/см²|атм|ати)'
            + END_LETTER
        )

        def to_bar(bar_hit) -> float:
            v, unit = Num.of(bar_hit.group(1)), bar_hit.group(2).lower()
            # ати — техническая атмосфера избыточная = 1 кгс/см² = 0,980665 бар; атм — физическая атмосфера = 1,01325 бар
            return round(
                v * 10
                if unit == 'мпа'
                else v * 0.980665
                if unit.startswith('кгс') or unit == 'ати'
                else v * 1.01325
                if unit == 'атм'
                else v,
                1,
            )

        match = self.first(PRESSURE)
        if match:
            bar = to_bar(match)
            if self.BAR_MIN <= bar <= self.BAR_MAX:
                self.put('pressure', bar, match, 'Давление, бар')
            # противоречие — только рабочее давление сжатого воздуха (не воды, масла, испытаний)
            self.conflict(
                'pressure',
                'Давление, бар',
                [
                    (to_bar(x), x)
                    for x in self.all(PRESSURE)
                    if to_bar(x) >= 1
                    and not re.search(
                        r'вод|масл|охлажд|испыт|пробн|гидрав|топлив|газ|ресивер|сосуд|колебан|перепад|потер|отклонен|±|клапан|минимальн|расч[её]тн',
                        self.sentence(x),
                        re.I,
                    )
                ],
            )
        match = self.first(
            r'(?:ISO|ИСО)\s*8573[^\n]{0,80}?(?<![\d.])([1-6])\s*[.:]\s*([1-6])\s*[.:]\s*([1-4])(?!\d|\.\d)'
        ) or self.first(
            r'класс\w*\s+(?:чистоты\s+)?(?:сжат\w*\s+)?(?:воздух\w*\s+)?(?:по\s+[^\s\d]+\s+)?(?:[—–-]\s*)?(?<![\d.])([1-6])\s*[.:]\s*([1-6])\s*[.:]\s*([1-4])(?!\d|\.\d)'
        )
        if match:
            self.put('air', '{}.{}.{}'.format(*match.groups()), match, 'Класс воздуха ISO 8573-1')
        match = self.first(r'точк\w*\s+росы[^\n]{0,40}?([' + MINUS_RX + r'+]|минус|плюс)?\s*(\d+)\s*°?\s*[сc]?')
        if match:
            sign = (match.group(1) or '').lower()
            temp = -int(match.group(2)) if sign == 'минус' or (sign and sign in MINUS) else int(match.group(2))
            if self.PDP_MIN <= temp <= self.PDP_MAX:
                self.put('pdp', temp, match, 'Точка росы под давлением, °C')
        if 'pdp' in self.req:
            self.water_class(match)

    PDP = ((1, -70), (2, -40), (3, -20), (4, 3), (5, 7), (6, 10))  # класс воды ISO 8573-1 → точка росы не выше, °C

    def water_class(self, match) -> None:
        """класс воды — по точке росы: строже из двух, если класс указан; нет класса — 2.x.2 (до −20 °C) или 3.x.3"""
        temp = self.req['pdp']
        water = max([cls_num for cls_num, lim in self.PDP if lim <= temp] or [1])
        air = self.req.get('air')
        if not air:
            oil = 2 if water <= self.WATER_STRICT else 3
            self.put(
                'air',
                f'{oil}.{water}.{oil}',
                match,
                'Класс воздуха ISO 8573-1 — по точке росы (частицы и масло уточните)',
            )
        elif int(air.split('.')[1]) > water:
            parts = air.split('.')
            self.req['air'] = f'{parts[0]}.{water}.{parts[2]}'
            for found in self.found:
                if found['key'] == 'air':
                    found['value'], found['label'] = self.req['air'], found['label'] + ' (вода — по точке росы)'

    def air_more(self) -> None:
        """к каким условиям приведена производительность, запас производительности"""
        if 'basis' not in self.req:
            match = self.first(
                r'(?:н\.\s?м[3³]|нм[3³]|nm3|нормальн\w*\s+(?:кубическ\w*\s+)?метр|(?:при|к)\s+нормальн\w*\s+условия)'
            )
            if match:
                self.put('basis', 'normal', match, 'Производительность — в нормальных м³ (0 °C, 101,325 кПа)')
            else:
                match = self.first(
                    r'(?:'
                    + NOT_LETTER
                    + r'FAD'
                    + END_LETTER
                    + r'|ISO\s*1217|ИСО\s*1217|ГОСТ\s*(?:Р\s*)?(?:ИСО\s*)?1217|услови\w*\s+всасывани|на\s+всасывании|free\s+air\s+delivery)'
                )
                if match:
                    self.put('basis', 'fad', match, 'Производительность — на условиях всасывания (FAD, ISO 1217)')
        match = self.first(
            r'запас\w*\s+(?:по\s+)?производительност\w*[^\n]{0,30}?(?:не\s+менее\s+)?(\d{1,3}(?:[.,]\d+)?)\s*%'
        ) or self.first(r'производительн\w*[^\n]{0,60}?с\s+запасом\s+(?:не\s+менее\s+)?(\d{1,3}(?:[.,]\d+)?)\s*%')
        if match and 0 <= Num.of(match.group(1)) <= self.PERCENT_MAX:
            self.put('margin', Num.of(match.group(1)), match, 'Запас производительности, %')

    def dgu_more(self) -> None:
        """режим ДЭС, средняя нагрузка, наибольший двигатель и его пуск, категория надёжности"""
        match = self.first(
            r'(?:резервн\w*|аварийн\w*)\s+(?:источник\w*|электроснабжени\w*|питани\w*)|'
            + NOT_LETTER
            + r'(?:standby|ESP)'
            + END_LETTER
            + r'\s*(?:режим|мощност)'
        )
        match2 = self.first(
            r'(?:основн\w*|постоянн\w*|автономн\w*)\s+(?:источник\w*|электроснабжени\w*|питани\w*|режим\w*\s+работ)|круглосуточн\w*\s+(?:работ|режим|электроснабж)'
        )
        if match and (not match2 or match.start() < match2.start()):
            self.put('mode', 'standby', match, 'Режим ДЭС — резервный источник (ESP, до 200 ч в год)')
        elif match2:
            self.put('mode', 'prime', match2, 'Режим ДЭС — основной источник (PRP)')
        match = self.first(
            r'(?:средн\w*\s+(?:суточн\w*\s+)?нагрузк\w*|коэффициент\w*\s+загрузк\w*|загрузк\w*\s+(?:ДГУ|ДЭС|генератор\w*))[^\n]{0,30}?(\d{1,3})\s*%'
        )
        if match and self.LOAD_MIN <= int(match.group(1)) <= self.LOAD_MAX:
            self.put('load', int(match.group(1)), match, 'Средняя нагрузка, % от мощности')
        match = self.first(
            r'(?:наибольш\w*|крупн\w*|пуск\w*|асинхронн\w*)[^\n]{0,40}?двигател\w*[^\n]{0,40}?'
            + NUM
            + r'\s*квт'
            + END_LETTER
        )
        if match:
            self.put('motor', Num.of(match.group(1)), match, 'Наибольший двигатель нагрузки, кВт')
        for key, regex, label in (
            ('stardelta', r'звезд\w*\s*[-–—]?\s*треугольн', 'звезда — треугольник'),
            ('soft', r'плавн\w*\s+пуск|устройств\w*\s+плавного\s+пуска', 'плавный пуск'),
            ('vsd', r'частотн\w*\s+(?:пуск|преобразовател)|преобразовател\w*\s+частот', 'частотный преобразователь'),
            ('direct', r'прям\w*\s+пуск|пуск\w*\s+прям', 'прямой'),
        ):
            match = self.first(regex)
            if match:
                self.put('start', key, match, 'Пуск двигателя нагрузки — ' + label)
                break
        match = self.first(
            r'(?<![IІ\w])(III|II|I|1|2|3|перв\w+|втор\w+|трет\w+)\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)'
        )
        if match:
            group = match.group(1).lower()
            count = (
                '1'
                if group in ('i', '1') or group.startswith('перв')
                else '2'
                if group in ('ii', '2') or group.startswith('втор')
                else '3'
            )
            self.put(
                'rel',
                count,
                match,
                'Категория надёжности электроснабжения — {}'.format({'1': 'I', '2': 'II', '3': 'III'}[count]),
            )

    def site(self) -> None:
        """условия площадки: высота над уровнем моря, относительная влажность"""
        match = self.first(
            r'(?:высот\w*\s+(?:над\s+уровнем\s+моря|площадки|установки|размещени\w*)|над\s+уровнем\s+моря)[^\n]{0,40}?(?:до\s+|не\s+более\s+)?(\d{1,4})\s*м'
            + END_LETTER
        )
        if match and 0 <= int(match.group(1)) <= self.ALT_MAX:
            self.put('alt', int(match.group(1)), match, 'Высота над уровнем моря, м')
        match = self.first(
            r'(?:относительн\w*\s+)?влажност\w*\s+(?:наружн\w*\s+|окружающ\w*\s+)?(?:воздух\w*\s+)?[^\n]{0,30}?(\d{1,3})\s*%'
        )
        if match and 0 < int(match.group(1)) <= self.PERCENT_MAX:
            self.put('rh', int(match.group(1)), match, 'Относительная влажность воздуха, %')

    def terms(self) -> None:
        """гарантия, срок поставки, допустимые и недопустимые производители"""
        match = self.first(r'гаранти\w*[^\n]{0,50}?(\d{1,3})\s*(месяц\w*|мес\.?|год\w*|лет)')
        if match:
            num = int(match.group(1))
            mon = num * 12 if match.group(2).lower().startswith(('год', 'лет')) else num
            if 1 <= mon <= self.WARRANTY_MAX:
                self.put('warranty', mon, match, 'Гарантия, мес.')
        match = self.first(
            r'срок\w*\s+(?:поставки|изготовлени\w*|выполнени\w*)[^\n]{0,50}?(\d{1,3})\s*((?:рабоч\w*|календарн\w*)\s+)?(дн\w*|недел\w*|месяц\w*|мес\.?)'
        )
        if match:
            self.put(
                'deadline',
                ('{} {}{}'.format(match.group(1), match.group(2) or '', match.group(3))).strip(),
                match,
                'Срок поставки',
            )
        match = self.first(
            r'(?:производств\w*|производител\w*|марк\w*|бренд\w*)[^\n]{0,30}?(?:только|исключительно)\s+([^\n.;]{3,80})'
        )
        if match:
            self.put('brands', match.group(1).strip(' ,:—-'), match, 'Допустимые производители')
        match = self.first(
            r'(?:не\s+допуска\w*|запрещ\w*|исключ\w*)[^\n]{0,30}?(?:оборудовани\w*\s+)?(?:производств\w*|производител\w*|марк\w*)\s+([^\n.;]{3,80})'
        )
        if match:
            self.put('noBrands', match.group(1).strip(' ,:—-'), match, 'Недопустимые производители')
        match = self.first(r'аналог\w*\s+(?:не\s+допуска|не\s+принима)|без\s+(?:права\s+)?замен\w*')
        if match:
            self.put('noAnalogs', True, match, 'Аналоги не допускаются')

    def pump(self) -> None:
        match = self.first(
            r'(?:подач\w*|производительн\w*|расход\w*)[^\n]{0,60}?'
            + NUM
            + r'\s*(м3/ч|м³/ч|м3/час|м³/час|л/с|л/мин|м3/сут|м³/сут)'
        )
        if match:
            v, unit = Num.of(match.group(1)), match.group(2).lower()
            flow = v * 3.6 if unit == 'л/с' else v * 0.06 if unit == 'л/мин' else v / 24 if 'сут' in unit else v
            self.put('q', round(flow, 1), match, 'Подача, м³/ч')
        match = self.first(
            r'напор\w*[^\n]{0,50}?' + NUM + r'\s*(м\.?\s*вод\.?\s*ст\.?|мвс|м|бар|мпа|кгс/см2|кгс/см²|атм)' + END_LETTER
        )
        if match:
            v, unit = Num.of(match.group(1)), match.group(2).lower()
            head = (
                v * 10.2
                if unit == 'бар'
                else v * 102
                if unit == 'мпа'
                else v * 10
                if unit.startswith('кгс') or unit == 'атм'
                else v
            )
            self.put('head', round(head, 1), match, 'Напор, м')

    def dgu(self) -> None:
        match = self.first(
            r'(?:мощност\w*|номинал\w*|основн\w*|резервн\w*)[^\n]{0,60}?' + NUM + r'\s*(квт|ква|kw|kva)' + END_LETTER
        )
        if not match:
            match = self.first(NUM + r'\s*(квт|ква|kw|kva)' + END_LETTER)
        if match:
            v, unit = Num.of(match.group(1)), match.group(2).lower()
            self.put(
                'kw',
                round(v * 0.8 if unit in ('ква', 'kva') else v, 1),
                match,
                'Мощность, кВт' + (' (из кВА × 0,8)' if unit in ('ква', 'kva') else ''),
            )
            self.conflict(
                'kw',
                'Мощность, кВт',
                [
                    (round(Num.of(x.group(1)) * (0.8 if x.group(2).lower() in ('ква', 'kva') else 1), 1), x)
                    for x in self.all(
                        r'(?:мощност\w*\s+(?:ДГУ|ДЭС|электростанци\w*|нагрузк\w*|станци\w*)|потребляем\w*\s+мощност\w*)[^\n]{0,40}?'
                        + NUM
                        + r'\s*(квт|ква|kw|kva)'
                        + END_LETTER
                    )
                ],
            )
        match = self.first(
            r'(?:работ\w*|автономн\w*)[^\n]{0,40}?(?:без дозаправки|от (?:встроенного )?бака)[^\n]{0,30}?(\d+)\s*ч'
        )
        if match:
            self.put('hours', int(match.group(1)), match, 'Работа от бака, ч')

    COUNT = {
        'один': 1,
        'одного': 1,
        'два': 2,
        'двух': 2,
        'три': 3,
        'трёх': 3,
        'трех': 3,
        'четыре': 4,
        'четырёх': 4,
        'четырех': 4,
    }

    def count(self, text) -> int | None:
        text = str(text or '').lower()
        return int(text) if text.isdigit() else self.COUNT.get(text)

    def reserve(self) -> None:
        """резерв N+1 / N+2 и, если указано, число рабочих агрегатов: «2 рабочих + 1 резервный», «схема 2+1»"""
        num_rx = NOT_LETTER + r'(\d|один|одного|два|двух|три|тр[её]х|четыре|четыр[её]х)'
        match = self.first(
            num_rx + r'\s*рабоч\w*(?:\s+\w+)?\s*(?:\+|и|,|плюс)\s*' + num_rx + r'\s*резервн'
        ) or self.first(r'схем\w*\s+(?:резервировани\w*\s+)?(\d)\s*\+\s*(\d)' + END_LETTER)
        if match:
            work, reserve = self.count(match.group(1)), self.count(match.group(2))
            if work and 1 <= work <= self.WORK_MAX:
                self.put('work', str(work), match, 'Рабочих агрегатов')
            if reserve is not None and 0 <= reserve <= self.RESERVE_MAX:
                self.put('reserve', str(reserve), match, f'Резерв N + {reserve}' if reserve else 'Без резерва')
            return
        match = self.first(r'N\s*\+\s*([12])' + END_LETTER)
        if match:
            reserve = int(match.group(1))
            self.put('reserve', str(reserve), match, f'Резерв N + {reserve}')
            return
        match = self.first(num_rx + r'\s+рабоч\w+\s+(?:компрессор|насос|агрегат|ДГУ|дизель|электроагрегат)')
        if match and 1 <= (self.count(match.group(1)) or 0) <= self.WORK_MAX:
            self.put('work', str(self.count(match.group(1))), match, 'Рабочих агрегатов')
        match = self.first(r'без\s+(?:горячего\s+)?резерв|резерв\w*(?:\s+\w+)?\s+не\s+(?:требу|нуж|предусм)')
        if match:
            self.put('reserve', '0', match, 'Без резерва')
            return
        match = self.first(r'(?:100\s*%\s*резерв|резервн\w+\s+(?:компрессор|насос|агрегат|ДГУ)|с\s+резерв\w*)')
        if match:
            self.put('reserve', '1', match, 'Резерв N + 1')

    def climate(self) -> None:
        temp_rx = r'([' + MINUS_RX + r'+]?)\s*(\d{1,2})'
        regex_climate = (
            r'(?:температур\w*|наружн\w*\s+воздух\w*|окружающ\w*\s+сред\w*)[^\n]{0,90}?от\s*'
            + temp_rx
            + r'\s*(?:°\s*[сc])?\s*до\s*'
            + temp_rx
        )
        match = self.first(regex_climate)
        if match:
            low, high = self.signed(match.group(1), match.group(2)), self.signed(match.group(3), match.group(4))
            if self.CLIMATE_MIN <= low < high <= self.CLIMATE_MAX:
                self.put('tmin', low, match, 'Наружный воздух от, °C')
                self.put('tmax', high, match, 'Наружный воздух до, °C')
            hits = [
                x
                for x in self.all(regex_climate)
                if not re.search(r'хранени|транспортир|вод|масл|помещени|внутри|на входе|сжат', self.sentence(x), re.I)
            ]
            self.conflict('tmin', 'Наружный воздух от, °C', [(self.signed(x.group(1), x.group(2)), x) for x in hits])
            self.conflict('tmax', 'Наружный воздух до, °C', [(self.signed(x.group(3), x.group(4)), x) for x in hits])
        if 'tmin' not in self.req:
            match = self.first(
                r'(?:минимальн\w*|наиболее холодн\w*|абсолютн\w*\s+минимум\w*|расч[её]тн\w*\s+(?:зимн\w*\s+)?температур\w*)[^\n]{0,60}?(['
                + MINUS_RX
                + r'])\s*(\d{1,2})'
            )
            if match:
                self.put('tmin', -int(match.group(2)), match, 'Наружный воздух от, °C')
        match = self.first(NOT_LETTER + r'(УХЛ|ХЛ|У)\s?1(?:\.1)?' + r'(?![\d])', 0)
        if match:
            self.put('climate', match.group(1) + '1', match, 'Климатическое исполнение (ГОСТ 15150-69)')

    def fire(self) -> None:
        match = self.first(
            r'(?i:категори\w*[^\n]{0,40}?(?:пожарн\w*|взрывопожарн\w*)[^\n]{0,40}?|(?:пожарн\w*|взрывопожарн\w*)\s+опасност\w*[^\n]{0,30}?)'
            + NOT_LETTER
            + r'(В[1-4]|А|Б|Г|Д)'
            + END_LETTER,
            0,
        )
        if not match:
            match = self.first(
                r'(?i:категори\w*\s+(?:помещени\w*\s+)?)' + NOT_LETTER + r'(В[1-4]|А|Б|Г|Д)' + END_LETTER, 0
            )
        if match and match.group(1) in self.FIRE:
            self.put('fire', match.group(1), match, 'Категория помещения (СП 12.13130)')

    def noise(self) -> None:
        match = self.first(r'(?:шум\w*|уров\w*\s+звук\w*)[^\n]{0,60}?(\d{2,3})\s*д[бb]')
        if match and self.NOISE_MIN <= int(match.group(1)) <= self.NOISE_MAX:
            self.put('noise', int(match.group(1)), match, 'Шум на рабочем месте, дБА')

    def receiver(self) -> None:
        match = self.first(r'ресивер\w*[^\n]{0,50}?' + NUM + r'\s*(л|литр\w*|м3|м³)' + END_LETTER)
        if match:
            v = Num.of(match.group(1))
            self.put(
                'recvVol',
                round(v * 1000 if match.group(2).lower() in ('м3', 'м³') and v < self.RECEIVER_M3_MAX else v),
                match,
                'Ресивер, л',
            )
        match = self.first(
            r'ресивер\w*[^\n]{0,90}?(?:снаружи|на улице|вне (?:контейнер|здани|помещени)\w*|на открыт\w+ площадк\w*|наружн\w* установк\w*)'
        )
        if match:
            self.put('recvOut', True, match, 'Ресивер — снаружи')
        match = self.first(r'ресивер\w*[^\n]{0,60}?(после|до)\s+(?:блок\w*\s+)?(?:осушител|подготовк)')
        if match:
            self.put(
                'recv',
                'after' if match.group(1).lower() == 'после' else 'before',
                match,
                'Ресивер — ' + match.group(1).lower() + ' осушителя',
            )

    def container(self) -> None:
        match = self.first(r'морск\w*\s+контейнер\w*[^\n]{0,30}?(20|40)\s*(?:футов|фут|ft|\')?([^\n]{0,20})')
        if match:
            high_cube = bool(re.search(r'hc|high\s*cube|увеличенн', match.group(2) or '', re.I))
            self.put(
                'cont',
                'sea{}{}'.format(match.group(1), 'hc' if high_cube else ''),
                match,
                'Контейнер — морской {} футов{}'.format(match.group(1), ' HC' if high_cube else ''),
            )
        else:
            match = self.first(
                r'«?Север»?\s*(?:\(|$|[,.;])|арктическ\w+\s+исполнен|контейнер\w*\s+«Север»', 0
            ) or self.first(r'арктическ\w+\s+исполнен')
            if match:
                self.put('cont', 'north', match, 'Контейнер — «Север» (арктическое исполнение)')
            else:
                match = self.first(r'блок[- ]?контейнер|блочно[- ]модульн|модульн\w+\s+здани|БМЗ|БКЗ')
                if match:
                    self.put('cont', 'block', match, 'Контейнер — блок-контейнер')
        match = self.first(r'(?:утепл\w*|теплоизоляц\w*)[^\n]{0,40}?(\d{2,3})\s*мм')
        if match and self.INSULATION_MIN <= int(match.group(1)) <= self.INSULATION_MAX:
            self.put('ins', match.group(1) + ' мм', match, 'Утепление')

    def systems(self) -> None:
        rules = [
            (
                'ops',
                r'охранно[- ]пожарн|пожарн\w*\s+сигнализац|' + NOT_LETTER + r'(?:ОПС|АУПС)' + END_LETTER,
                'Охранно-пожарная сигнализация',
            ),
            (
                'fire',
                r'автоматическ\w*\s+(?:установк\w*\s+)?(?:\w+\s+)?пожаротушени|АУПТ|аэрозольн\w*\s+пожаротуш|порошков\w*\s+пожаротуш|модул\w*\s+пожаротуш',
                'Автоматическое пожаротушение',
            ),
            ('noise', r'шумоизол|шумопоглощ|звукоизол', 'Шумоизоляция'),
            (
                'snow',
                r'маркиз|снегозащит|снегов\w*\s+(?:козыр|защит)|защит\w*\s+от\s+(?:снега|осадков)',
                'Маркизы на приточных жалюзи (снегозащита)',
            ),
            (
                'snowout',
                r'маркиз[^.;\n]{0,60}(?:выброс|вытяжн|выход\w*\s+(?:горяч|тёпл|тепл))|(?:выброс|вытяжн)\w*[^.;\n]{0,60}маркиз',
                'Маркизы на жалюзи выброса горячего воздуха',
            ),
            ('gate', r'ворот', 'Ворота'),
        ]
        sys = {}
        for key, regex, label in rules:
            match = re.search(regex, self.text, re.I)
            if match:
                sys[key] = True
                self.found.append(
                    {'key': 'sys.' + key, 'label': 'Система: ' + label, 'value': True, 'src': self.src(match)}
                )
        if sys:
            self.req['sys'] = sys
        match = self.first(r'паспорт\w*|сертификат\w*|деклараци\w*|ТР\s*ТС|исполнительн\w*\s+документац')
        if match:
            self.put('docs', True, match, 'Документы при поставке')

    OPTIONS = (
        (
            'oilFree',
            ('comp',),
            r'безмасл\w*|oil[\s-]?free|класс\w*\s+0\s+по\s+масл',
            'Безмасляный компрессор (класс 0 по маслу)',
        ),
        (
            'vsd',
            ('comp', 'pump'),
            r'частотн\w*\s+(?:регулировани|преобразовател|привод|управлени)|преобразовател\w*\s+частот|'
            + NOT_LETTER
            + r'(?:ПЧ|VSD)'
            + END_LETTER
            + r'|инверторн\w*',
            'Частотное регулирование',
        ),
        (
            'ats',
            ('comp', 'pump', 'dgu'),
            NOT_LETTER + r'АВР' + END_LETTER + r'|автоматическ\w*\s+(?:включени\w*|ввод\w*)\s+резерв|'
            r'(?:два|двух|2)\s+(?:независим\w+\s+)?ввод|(?<![IІ])I\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)|'
            r'перв\w+\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)',
            'Два ввода питания с АВР',
        ),
        (
            'scada',
            ('comp', 'pump', 'dgu'),
            r'диспетчер\w*|'
            + NOT_LETTER
            + r'(?:SCADA|АСУ\s?ТП|Modbus|Profinet|Profibus|OPC)'
            + END_LETTER
            + r'|удал[её]нн\w+\s+(?:мониторинг|контрол|управлени)',
            'Диспетчеризация (шкаф АСУ ТП)',
        ),
    )

    # пищевая и медицинская — только безмасляные (правило comp.oil_free)
    INDUSTRY = (
        (
            'med',
            r'медицинск\w*|фармацевт\w*|фармпроизвод\w*|лекарствен\w*|больниц\w*|' + NOT_LETTER + r'GMP' + END_LETTER,
            'Отрасль — медицинская, фармацевтическая: компрессоры безмасляные',
        ),
        (
            'food',
            r'пищев\w*|молочн\w*|мясн\w*|мясоперераб\w*|кондитерск\w*|хлебозавод\w*|хлебопек\w*|пивоварен\w*|пивзавод\w*|'
            r'безалкогольн\w*\s+напит\w*|розлив\w*\s+(?:вод|напит)\w*|рыбоперераб\w*|сахарн\w*\s+завод\w*|масложиров\w*|консервн\w*|'
            + NOT_LETTER
            + r'(?:HACCP|ХАССП)'
            + END_LETTER,
            'Отрасль — пищевая: компрессоры безмасляные',
        ),
    )

    def options(self) -> None:
        """особые требования: безмасляный компрессор, частотное регулирование, АВР (два ввода), диспетчеризация; отрасль"""
        k = self.req.get('kind')
        for key, kinds, regex, label in self.OPTIONS:
            if k in kinds:
                match = next((x for x in re.finditer(regex, self.text, re.I) if not self.negated(x)), None)
                if match:
                    self.put(key, True, match, label)
        if k == 'comp':
            for value, regex, label in self.INDUSTRY:
                match = re.search(regex, self.text, re.I)
                if match:
                    self.put('industry', value, match, label)
                    break

    def negated(self, match) -> bool:
        """«без АВР», «АВР не требуется», «кроме диспетчеризации» — требования нет"""
        before, after = self.text[max(0, match.start() - 25) : match.start()], self.text[match.end() : match.end() + 40]
        return bool(
            re.search(r'(?:без|кроме)\s+(?:\w+\s+){0,2}$', before, re.I)
            or re.match(r'\W*(?:\w+\s+){0,3}не\s+(?:требу|нуж|предусм)', after, re.I)
        )

    def notes(self) -> None:
        """прочие требования: предложения с «должен», «необходимо», «требуется» — до 6, без повторов"""
        out = []
        for part in re.split(r'(?<=[.;!?])\s+|\n+', self.text):
            text = part.strip(' •-–—\t')
            if (
                self.NOTE_MIN <= len(text) <= self.NOTE_MAX
                and re.search(
                    r'долж[еаноы]\w*|необходим\w*|требуется|обязательн\w*|предусмотреть|обеспечить', text, re.I
                )
                and text not in out
            ):
                out.append(text)
            if len(out) >= self.NOTES_MAX:
                break
        if out:
            self.req['notes'] = '\n'.join(out)


class TzReview:
    """Анкета по ТЗ: found / default / missing / conflict по каждому параметру и вопросы заказчику."""

    NEED = {'comp': ('flow', 'pressure'), 'dgu': ('kw',), 'pump': ('q', 'head')}
    # ключ, подпись, значение по умолчанию (None — нет: отсутствует), почему так, вопрос заказчику (None — не спрашивать)
    COMMON_T = [
        (
            'tmin',
            'Наружный воздух от, °C',
            None,
            '',
            'Минимальная температура наружного воздуха на площадке (зимой), °C.',
        ),
        (
            'tmax',
            'Наружный воздух до, °C',
            None,
            '',
            'Максимальная температура наружного воздуха на площадке (летом), °C.',
        ),
        (
            'alt',
            'Высота над уровнем моря, м',
            0,
            'в ТЗ не указана — принято 0 м (на высоте больше 1000 м мощность оборудования снижается)',
            'Высота площадки над уровнем моря, м.',
        ),
    ]
    FIELDS: dict[str, list] = {
        'comp': [
            ('flow', 'Производительность, м³/мин', None, '', 'Требуемая производительность станции, м³/мин.'),
            (
                'basis',
                'Производительность приведена к условиям',
                'fad',
                'в ТЗ не сказано — принято FAD (условия всасывания, ISO 1217), как в паспортах компрессоров',
                'К каким условиям приведена производительность: условия всасывания (FAD, ISO 1217) или нормальные м³ (0 °C, 101,325 кПа)?',
            ),
            (
                'pressure',
                'Давление у потребителя, бар',
                None,
                '',
                'Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.',
            ),
            (
                'air',
                'Класс чистоты ISO 8573-1',
                None,
                '',
                'Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1 (частицы.вода.масло) или требуемая точка росы.',
            ),
            (
                'margin',
                'Запас производительности, %',
                0,
                'нормами РФ не установлен (ПБ 03-581-03 отменены) — по ТЗ; не указан — 0 %',
                'Нужен ли запас производительности сверх потребности (утечки, развитие производства), %?',
            ),
            (
                'reserve',
                'Резерв компрессоров',
                '0',
                'в ТЗ не указан — без резерва',
                'Нужен ли резервный компрессор (N+1)?',
            ),
            *COMMON_T,
            (
                'rh',
                'Относительная влажность воздуха, %',
                100,
                'для перевода нормальных м³ в FAD принято 100 % (с запасом)',
                'Относительная влажность наружного воздуха летом, %.',
            ),
            (
                'fire',
                'Категория помещения',
                None,
                '',
                'Категория помещения станции по взрывопожарной и пожарной опасности (СП 12.13130) — если определена проектом.',
            ),
        ],
        'dgu': [
            ('kw', 'Мощность нагрузки, кВт', None, '', 'Мощность нагрузки ДЭС, кВт (длительная и максимальная).'),
            (
                'mode',
                'Режим ДЭС',
                'prime',
                'в ТЗ не указан — принят основной источник (PRP): мощность с запасом',
                'ДЭС — основной источник электроснабжения или резервный (при отключении сети, до 200 ч в год)?',
            ),
            (
                'load',
                'Средняя нагрузка за сутки, %',
                100,
                'график нагрузки не задан — принята постоянная 100 % (с запасом)',
                'График нагрузки за сутки: средняя нагрузка, % от максимальной.',
            ),
            (
                'motor',
                'Наибольший двигатель нагрузки, кВт',
                None,
                '',
                'Мощность наибольшего электродвигателя нагрузки, кВт, и как он пускается (прямой пуск, звезда — треугольник, плавный пуск, частотный преобразователь).',
            ),
            (
                'start',
                'Пуск наибольшего двигателя',
                'direct',
                'не указан — принят прямой пуск (наибольший пусковой ток)',
                None,
            ),
            ('hours', 'Работа от бака, ч', None, '', 'Требуемое время работы без дозаправки, ч.'),
            (
                'rel',
                'Категория надёжности электроснабжения',
                None,
                '',
                'Категория надёжности электроснабжения потребителей (I, II, III) — нужен ли автоматический ввод резерва.',
            ),
            ('reserve', 'Резерв ДГУ', '0', 'в ТЗ не указан — без резерва', 'Нужен ли резервный ДГУ (N+1)?'),
            *COMMON_T,
            (
                'fire',
                'Категория помещения',
                None,
                '',
                'Категория помещения ДЭС по взрывопожарной и пожарной опасности (СП 12.13130) — если определена проектом.',
            ),
        ],
        'pump': [
            ('q', 'Подача, м³/ч', None, '', 'Требуемая подача, м³/ч.'),
            ('head', 'Напор, м', None, '', 'Требуемый напор, м.'),
            ('reserve', 'Резерв насосов', '0', 'в ТЗ не указан — без резерва', 'Нужен ли резервный насос (N+1)?'),
            *COMMON_T[:2],
        ],
    }
    TERMS = [
        ('noise', 'Шум на рабочем месте, дБА', 80, 'не указан — по СанПиН 1.2.3685-21 не более 80 дБА', None),
        ('warranty', 'Гарантия, мес.', None, '', 'Требуемый гарантийный срок, мес.'),
        ('deadline', 'Срок поставки', None, '', 'Требуемый срок поставки.'),
    ]

    def __init__(self, parser) -> None:
        self.parser = parser
        self.kind = parser.req.get('kind') or 'comp'
        self.byKey = {found['key']: found for found in parser.found}
        self.conf = {conflict['key']: conflict for conflict in parser.conflicts}

    def spec(self) -> list:
        spec = self.FIELDS.get(self.kind, self.FIELDS['comp']) + self.TERMS
        if self.kind == 'comp' and self.parser.req.get('basis') != 'normal':
            spec = [x for x in spec if x[0] != 'rh']  # влажность нужна только для пересчёта нормальных м³
        if self.kind == 'dgu' and not self.parser.req.get('motor'):
            spec = [x for x in spec if x[0] != 'start']
        return spec

    def fields(self) -> list:
        out = []
        for key, label, dflt, why, _ in self.spec():
            found, conflict = self.byKey.get(key), self.conf.get(key)
            if conflict:
                out.append(
                    {
                        'key': key,
                        'label': label,
                        'status': 'conflict',
                        'value': found['value'] if found else conflict.get('value'),
                        'values': conflict['values'],
                        'why': 'в ТЗ разные значения — принято {} {} (с запасом в пользу заказчика)'.format(
                            'меньшее' if key in TzParse.LOW_WINS else 'большее',
                            self.fmt(found['value'] if found else conflict.get('value')),
                        ),
                    }
                )
            elif found:
                out.append(
                    {
                        'key': key,
                        'label': label,
                        'status': 'found',
                        'value': found['value'],
                        'src': found['src'],
                        'page': found.get('page'),
                    }
                )
            elif key == 'air' and 'pdp' in self.parser.req:
                out.append({'key': key, 'label': label, 'status': 'found', 'value': self.parser.req.get('air')})
            elif dflt is not None:
                out.append({'key': key, 'label': label, 'status': 'default', 'value': dflt, 'why': why})
            else:
                out.append({'key': key, 'label': label, 'status': 'missing', 'value': None})
        return out

    @staticmethod
    def fmt(v) -> str:
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return str(v).replace('.', ',').replace('-', '−')

    def questions(self) -> list:
        """обязательные вопросы: без ответа станцию не подобрать"""
        need = self.NEED.get(self.kind, ())
        missing = {field['key'] for field in self.fields() if field['status'] == 'missing'}
        return [spec_item for key, _, _, _, spec_item in self.spec() if key in need and spec_item and key in missing]

    def later(self) -> list:
        """Можно уточнить позже: умолчания, отсутствующие необязательные и противоречия."""
        ask, need, out = {key: spec_item for key, _, _, _, spec_item in self.spec()}, self.NEED.get(self.kind, ()), []
        for field in self.fields():
            spec_item = ask.get(field['key'])
            if field['status'] == 'conflict':
                vals = '; '.join(
                    '{}{}'.format(self.fmt(v['value']), ' (стр. {})'.format(v['page']) if v.get('page') else '')
                    for v in field['values']
                )
                out.append(
                    '{}: в ТЗ разные значения — {}; принято {}. Подтвердите.'.format(
                        field['label'], vals, self.fmt(field['value'])
                    )
                )
            elif field['status'] in ('missing', 'default') and spec_item and field['key'] not in need:
                out.append(spec_item)
        return out
