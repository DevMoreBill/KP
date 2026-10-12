# -*- coding: utf-8 -*-
"""Требования к станции из текста ТЗ заказчика — правилами (без ИИ): вид станции, производительность и давление
(компрессорная), класс чистоты по ISO 8573-1 или точка росы, подача и напор (насосная), мощность (ДГУ), резерв,
температуры наружного воздуха, климатическое исполнение, категория помещения, шум, ресивер (объём, снаружи, до или
после осушителя), контейнер (тип, утепление), системы (ОПС, пожаротушение, шумоизоляция, ворота), документы.

Каждое найденное значение — с цитатой из ТЗ (src) и номером страницы (page; страницы PDF разделены символом «\\f»),
чтобы менеджер проверил его в окне разбора. Единицы приводятся: производительность — м³/мин, давление — бар, подача —
м³/ч, напор — м, мощность — кВт.

Для расчёта станции — ещё: к каким условиям приведена производительность (FAD или нормальные м³), высота над уровнем
моря, влажность, запас производительности; ДЭС — режим (основной или резервный источник), средняя нагрузка,
наибольший двигатель и способ его пуска, категория надёжности; общие — гарантия, срок поставки, допустимые и
недопустимые производители. Разные значения одного параметра в ТЗ — противоречие (conflicts): принимается более
требовательное значение (станция с запасом в пользу заказчика), заказчика не спрашиваем. TzReview — анкета по ТЗ: у
каждого параметра статус «найдено в ТЗ» / «принято по умолчанию (почему)» / «отсутствует» / «противоречие»; вопросы
заказчику — только без ответа на которые станцию не подобрать, остальное — «можно уточнить позже».
"""
import re

NUM = r'(\d+(?:[.,]\d+)?)'
MINUS = '−–-'
MINUS_RX = r'−–\-'                 # те же знаки — внутри [ ] регулярного выражения
NOT_LETTER = r'(?<![А-Яа-яЁёA-Za-z])'
END_LETTER = r'(?![А-Яа-яЁёA-Za-z0-9])'


class TzParse:
    FIRE = ('А', 'Б', 'В1', 'В2', 'В3', 'В4', 'Г', 'Д')
    LOW_WINS = ('tmin',)               # противоречие: здесь требовательнее меньшее значение (холоднее), в остальных — большее

    def __init__(self, text):
        self.text = re.sub(r'[ \t\xa0]+', ' ', str(text or ''))
        self.low = self.text.lower()
        self.req, self.found, self.conflicts = {}, [], []
        self.paged = '\f' in self.text

    @classmethod
    def parse(cls, text):
        """{'kind', 'req': {…}, 'found': [{key, label, value, src, page}], 'conflicts', 'fields', 'questions', 'later'}"""
        p = cls(text)
        p.run()
        rv = TzReview(p)
        return {'kind': p.req.get('kind', ''), 'req': p.req, 'found': p.found, 'conflicts': p.conflicts,
                'fields': rv.fields(), 'questions': rv.questions(), 'later': rv.later()}

    # ---- помощники
    @staticmethod
    def num(s):
        return float(str(s).replace(',', '.').replace(' ', ''))

    def src(self, m):
        a, b = max(0, m.start() - 60), min(len(self.text), m.end() + 60)
        s = re.sub(r'\s+', ' ', self.text[a:b].replace('\f', ' ')).strip()
        return ('…' if a else '') + s + ('…' if b < len(self.text) else '')

    def page(self, m):
        """номер страницы цитаты (PDF) или None"""
        return self.text.count('\f', 0, m.start()) + 1 if m and self.paged else None

    def put(self, key, value, m, label):
        if key in self.req or value in (None, ''):
            return
        self.req[key] = value
        self.found.append({'key': key, 'label': label, 'value': value, 'src': self.src(m) if m else '', 'page': self.page(m)})

    def conflict(self, key, label, hits):
        """разные значения одного параметра в ТЗ: hits — [(значение, совпадение)]; одинаковые (до 2 %) — не противоречие.
        Принимается более требовательное значение (в пользу заказчика: больше производительность, давление, мощность, жарче
        лето, холоднее зима) — в требованиях и в найденном (с цитатой); заказчика не спрашиваем"""
        vals = []
        for v, m in hits:
            if v is None or any(abs(v - x[0]) <= 0.02 * max(abs(v), abs(x[0]), 1e-9) for x in vals):
                continue
            vals.append((v, m))
        if len(vals) > 1:
            v, m = (min if key in self.LOW_WINS else max)(vals, key=lambda x: x[0])
            if key in self.req:
                self.req[key] = v
                for f in self.found:
                    if f['key'] == key:
                        f.update(value=v, src=self.src(m), page=self.page(m))
            self.conflicts.append({'key': key, 'label': label, 'value': v,
                                   'values': [{'value': x, 'src': self.src(y), 'page': self.page(y)} for x, y in vals[:4]]})

    def sentence(self, m):
        """предложение (пункт) с совпадением — от начала предложения до конца совпадения"""
        a = max(self.text.rfind('. ', 0, m.start()), self.text.rfind('\n', 0, m.start()), self.text.rfind('; ', 0, m.start()))
        return self.text[a + 1:m.end()]

    def all(self, rx, flags=re.I):
        return list(re.finditer(rx, self.text, flags))

    def first(self, rx, flags=re.I):
        return re.search(rx, self.text, flags)

    @staticmethod
    def signed(sign, v):
        return -int(v) if sign and sign in MINUS else int(v)

    # ---- разбор
    def run(self):
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

    def kind(self):
        score = {
            'comp': len(re.findall(r'компрессор|сжат\w* воздух|пневмо|осушител|ресивер', self.low)),
            'pump': len(re.findall(r'насос|подач\w*|напор\w*|водоснабж|повысит\w* давлен|канализац', self.low)),
            'dgu': len(re.findall(r'дизел\w*|дгу|дэс|электростанц|генератор\w*\s+установ|\d\s*ква' + END_LETTER + r'|резервн\w*\s+(?:источник|электроснабж)', self.low)),
        }
        best = max(score, key=score.get)
        if score[best]:
            names = {'comp': 'компрессорная', 'pump': 'насосная', 'dgu': 'дизель-генераторная'}
            m = re.search({'comp': r'компрессор|сжат\w* воздух', 'pump': r'насос', 'dgu': r'дизел\w*|ДГУ|ДЭС|электростанц'}[best], self.text, re.I)
            self.put('kind', best, m, 'Вид станции — ' + names[best])

    def air(self):
        u = r'(н?м3/мин|н?м³/мин|н?м3/ч|н?м³/ч|л/мин|л/с|nm3/min|m3/min)'
        m = (self.first(r'(?:производительн\w*|расход\w*(?:\s+сжат\w*)?\s+воздух\w*|потребност\w*\s+в\s+сжат\w*\s+воздух\w*|объ[её]м\w* сжат\w* воздух\w*)'
                        r'[^\n]{0,80}?' + NUM + r'\s*' + u) or self.first(NUM + r'\s*' + u))
        def m3min(m):
            v, unit = self.num(m.group(1)), m.group(2).lower()
            return round(v / 60 if '/ч' in unit else v / 1000 if 'л/мин' in unit else v * 0.06 if 'л/с' in unit else v, 2)
        if m:
            self.put('flow', m3min(m), m, 'Производительность, м³/мин')
            if re.match(r'н|nm', m.group(2), re.I):
                self.put('basis', 'normal', m, 'Производительность — в нормальных м³ (0 °C, 101,325 кПа)')
            self.conflict('flow', 'Производительность, м³/мин', [(m3min(x), x) for x in self.all(
                r'(?:производительн\w*\s+(?:станци\w*|компрессорн\w*)|потребност\w*\s+в\s+сжат\w*\s+воздух\w*|расход\w*\s+сжат\w*\s+воздух\w*)[^\n]{0,60}?' + NUM + r'\s*' + u)])
        P = r'(?:рабоч\w*\s+|избыточн\w*\s+|номинальн\w*\s+|выходн\w*\s+)?давлени\w*[^\n]{0,60}?' + NUM + r'\s*(бар|bar|мпа|кгс/см2|кгс/см²|атм|ати)' + END_LETTER

        def to_bar(m):
            v, unit = self.num(m.group(1)), m.group(2).lower()
            return round(v * 10 if unit == 'мпа' else v * 0.981 if unit.startswith('кгс') else v * 1.013 if unit in ('атм', 'ати') else v, 1)
        m = self.first(P)
        if m:
            bar = to_bar(m)
            if 0.5 <= bar <= 400:
                self.put('pressure', bar, m, 'Давление, бар')
            # противоречие — только рабочее давление сжатого воздуха (не воды, масла, испытаний)
            self.conflict('pressure', 'Давление, бар', [(to_bar(x), x) for x in self.all(P) if to_bar(x) >= 1 and not re.search(
                r'вод|масл|охлажд|испыт|пробн|гидрав|топлив|газ|ресивер|сосуд|колебан|перепад|потер|отклонен|±|клапан|минимальн|расч[её]тн',
                self.sentence(x), re.I)])
        m = (self.first(r'(?:ISO|ИСО)\s*8573[^\n]{0,80}?(?<![\d.])([1-6])\s*[.:]\s*([1-6])\s*[.:]\s*([1-4])(?!\d|\.\d)')
             or self.first(r'класс\w*\s+(?:чистоты\s+)?(?:сжат\w*\s+)?(?:воздух\w*\s+)?(?:по\s+[^\s\d]+\s+)?(?:[—–-]\s*)?(?<![\d.])([1-6])\s*[.:]\s*([1-6])\s*[.:]\s*([1-4])(?!\d|\.\d)'))
        if m:
            self.put('air', '%s.%s.%s' % m.groups(), m, 'Класс воздуха ISO 8573-1')
        m = self.first(r'точк\w*\s+росы[^\n]{0,40}?([' + MINUS_RX + r'+]|минус|плюс)?\s*(\d+)\s*°?\s*[сc]?')
        if m:
            sg = (m.group(1) or '').lower()
            t = -int(m.group(2)) if sg == 'минус' or (sg and sg in MINUS) else int(m.group(2))
            if -100 <= t <= 20:
                self.put('pdp', t, m, 'Точка росы под давлением, °C')
        if 'pdp' in self.req:
            self.water_class(m)

    PDP = ((1, -70), (2, -40), (3, -20), (4, 3), (5, 7), (6, 10))   # класс воды ISO 8573-1 → точка росы не выше, °C

    def water_class(self, m):
        """класс воды — по точке росы: строже из двух, если класс указан; нет класса — 2.x.2 (до −20 °C) или 3.x.3"""
        t = self.req['pdp']
        wc = max([c for c, lim in self.PDP if lim <= t] or [1])
        a = self.req.get('air')
        if not a:
            o = 2 if wc <= 3 else 3
            self.put('air', '%d.%d.%d' % (o, wc, o), m, 'Класс воздуха ISO 8573-1 — по точке росы (частицы и масло уточните)')
        elif int(a.split('.')[1]) > wc:
            p = a.split('.')
            self.req['air'] = '%s.%d.%s' % (p[0], wc, p[2])
            for f in self.found:
                if f['key'] == 'air':
                    f['value'], f['label'] = self.req['air'], f['label'] + ' (вода — по точке росы)'

    def air_more(self):
        """к каким условиям приведена производительность, запас производительности"""
        if 'basis' not in self.req:
            m = self.first(r'(?:н\.\s?м[3³]|нм[3³]|nm3|нормальн\w*\s+(?:кубическ\w*\s+)?метр|(?:при|к)\s+нормальн\w*\s+условия)')
            if m:
                self.put('basis', 'normal', m, 'Производительность — в нормальных м³ (0 °C, 101,325 кПа)')
            else:
                m = self.first(r'(?:' + NOT_LETTER + r'FAD' + END_LETTER + r'|ISO\s*1217|ИСО\s*1217|ГОСТ\s*(?:Р\s*)?(?:ИСО\s*)?1217|услови\w*\s+всасывани|на\s+всасывании|free\s+air\s+delivery)')
                if m:
                    self.put('basis', 'fad', m, 'Производительность — на условиях всасывания (FAD, ISO 1217)')
        m = (self.first(r'запас\w*\s+(?:по\s+)?производительност\w*[^\n]{0,30}?(?:не\s+менее\s+)?(\d{1,3}(?:[.,]\d+)?)\s*%')
             or self.first(r'производительн\w*[^\n]{0,60}?с\s+запасом\s+(?:не\s+менее\s+)?(\d{1,3}(?:[.,]\d+)?)\s*%'))
        if m and 0 <= self.num(m.group(1)) <= 100:
            self.put('margin', self.num(m.group(1)), m, 'Запас производительности, %')

    def dgu_more(self):
        """режим ДЭС, средняя нагрузка, наибольший двигатель и его пуск, категория надёжности"""
        m = self.first(r'(?:резервн\w*|аварийн\w*)\s+(?:источник\w*|электроснабжени\w*|питани\w*)|' + NOT_LETTER + r'(?:standby|ESP)' + END_LETTER + r'\s*(?:режим|мощност)')
        m2 = self.first(r'(?:основн\w*|постоянн\w*|автономн\w*)\s+(?:источник\w*|электроснабжени\w*|питани\w*|режим\w*\s+работ)|круглосуточн\w*\s+(?:работ|режим|электроснабж)')
        if m and (not m2 or m.start() < m2.start()):
            self.put('mode', 'standby', m, 'Режим ДЭС — резервный источник (ESP, до 200 ч в год)')
        elif m2:
            self.put('mode', 'prime', m2, 'Режим ДЭС — основной источник (PRP)')
        m = self.first(r'(?:средн\w*\s+(?:суточн\w*\s+)?нагрузк\w*|коэффициент\w*\s+загрузк\w*|загрузк\w*\s+(?:ДГУ|ДЭС|генератор\w*))[^\n]{0,30}?(\d{1,3})\s*%')
        if m and 5 <= int(m.group(1)) <= 110:
            self.put('load', int(m.group(1)), m, 'Средняя нагрузка, % от мощности')
        m = self.first(r'(?:наибольш\w*|крупн\w*|пуск\w*|асинхронн\w*)[^\n]{0,40}?двигател\w*[^\n]{0,40}?' + NUM + r'\s*квт' + END_LETTER)
        if m:
            self.put('motor', self.num(m.group(1)), m, 'Наибольший двигатель нагрузки, кВт')
        for key, rx, label in (('stardelta', r'звезд\w*\s*[-–—]?\s*треугольн', 'звезда — треугольник'), ('soft', r'плавн\w*\s+пуск|устройств\w*\s+плавного\s+пуска', 'плавный пуск'),
                               ('vsd', r'частотн\w*\s+(?:пуск|преобразовател)|преобразовател\w*\s+частот', 'частотный преобразователь'), ('direct', r'прям\w*\s+пуск|пуск\w*\s+прям', 'прямой')):
            m = self.first(rx)
            if m:
                self.put('start', key, m, 'Пуск двигателя нагрузки — ' + label)
                break
        m = self.first(r'(?<![IІ\w])(III|II|I|1|2|3|перв\w+|втор\w+|трет\w+)\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)')
        if m:
            g = m.group(1).lower()
            c = '1' if g in ('i', '1') or g.startswith('перв') else '2' if g in ('ii', '2') or g.startswith('втор') else '3'
            self.put('rel', c, m, 'Категория надёжности электроснабжения — %s' % {'1': 'I', '2': 'II', '3': 'III'}[c])

    def site(self):
        """условия площадки: высота над уровнем моря, относительная влажность"""
        m = self.first(r'(?:высот\w*\s+(?:над\s+уровнем\s+моря|площадки|установки|размещени\w*)|над\s+уровнем\s+моря)[^\n]{0,40}?(?:до\s+|не\s+более\s+)?(\d{1,4})\s*м' + END_LETTER)
        if m and 0 <= int(m.group(1)) <= 5000:
            self.put('alt', int(m.group(1)), m, 'Высота над уровнем моря, м')
        m = self.first(r'(?:относительн\w*\s+)?влажност\w*\s+(?:наружн\w*\s+|окружающ\w*\s+)?(?:воздух\w*\s+)?[^\n]{0,30}?(\d{1,3})\s*%')
        if m and 0 < int(m.group(1)) <= 100:
            self.put('rh', int(m.group(1)), m, 'Относительная влажность воздуха, %')

    def terms(self):
        """гарантия, срок поставки, допустимые и недопустимые производители"""
        m = self.first(r'гаранти\w*[^\n]{0,50}?(\d{1,3})\s*(месяц\w*|мес\.?|год\w*|лет)')
        if m:
            n = int(m.group(1))
            mon = n * 12 if m.group(2).lower().startswith(('год', 'лет')) else n
            if 1 <= mon <= 120:
                self.put('warranty', mon, m, 'Гарантия, мес.')
        m = self.first(r'срок\w*\s+(?:поставки|изготовлени\w*|выполнени\w*)[^\n]{0,50}?(\d{1,3})\s*((?:рабоч\w*|календарн\w*)\s+)?(дн\w*|недел\w*|месяц\w*|мес\.?)')
        if m:
            self.put('deadline', ('%s %s%s' % (m.group(1), m.group(2) or '', m.group(3))).strip(), m, 'Срок поставки')
        m = self.first(r'(?:производств\w*|производител\w*|марк\w*|бренд\w*)[^\n]{0,30}?(?:только|исключительно)\s+([^\n.;]{3,80})')
        if m:
            self.put('brands', m.group(1).strip(' ,:—-'), m, 'Допустимые производители')
        m = self.first(r'(?:не\s+допуска\w*|запрещ\w*|исключ\w*)[^\n]{0,30}?(?:оборудовани\w*\s+)?(?:производств\w*|производител\w*|марк\w*)\s+([^\n.;]{3,80})')
        if m:
            self.put('noBrands', m.group(1).strip(' ,:—-'), m, 'Недопустимые производители')
        m = self.first(r'аналог\w*\s+(?:не\s+допуска|не\s+принима)|без\s+(?:права\s+)?замен\w*')
        if m:
            self.put('noAnalogs', True, m, 'Аналоги не допускаются')

    def pump(self):
        m = self.first(r'(?:подач\w*|производительн\w*|расход\w*)[^\n]{0,60}?' + NUM + r'\s*(м3/ч|м³/ч|м3/час|м³/час|л/с|л/мин|м3/сут|м³/сут)')
        if m:
            v, unit = self.num(m.group(1)), m.group(2).lower()
            q = v * 3.6 if unit == 'л/с' else v * 0.06 if unit == 'л/мин' else v / 24 if 'сут' in unit else v
            self.put('q', round(q, 1), m, 'Подача, м³/ч')
        m = self.first(r'напор\w*[^\n]{0,50}?' + NUM + r'\s*(м\.?\s*вод\.?\s*ст\.?|мвс|м|бар|мпа|кгс/см2|кгс/см²|атм)' + END_LETTER)
        if m:
            v, unit = self.num(m.group(1)), m.group(2).lower()
            h = v * 10.2 if unit == 'бар' else v * 102 if unit == 'мпа' else v * 10 if unit.startswith('кгс') or unit == 'атм' else v
            self.put('head', round(h, 1), m, 'Напор, м')

    def dgu(self):
        m = self.first(r'(?:мощност\w*|номинал\w*|основн\w*|резервн\w*)[^\n]{0,60}?' + NUM + r'\s*(квт|ква|kw|kva)' + END_LETTER)
        if not m:
            m = self.first(NUM + r'\s*(квт|ква|kw|kva)' + END_LETTER)
        if m:
            v, unit = self.num(m.group(1)), m.group(2).lower()
            self.put('kw', round(v * 0.8 if unit in ('ква', 'kva') else v, 1), m, 'Мощность, кВт' + (' (из кВА × 0,8)' if unit in ('ква', 'kva') else ''))
            self.conflict('kw', 'Мощность, кВт', [(round(self.num(x.group(1)) * (0.8 if x.group(2).lower() in ('ква', 'kva') else 1), 1), x) for x in self.all(
                r'(?:мощност\w*\s+(?:ДГУ|ДЭС|электростанци\w*|нагрузк\w*|станци\w*)|потребляем\w*\s+мощност\w*)[^\n]{0,40}?' + NUM + r'\s*(квт|ква|kw|kva)' + END_LETTER)])
        m = self.first(r'(?:работ\w*|автономн\w*)[^\n]{0,40}?(?:без дозаправки|от (?:встроенного )?бака)[^\n]{0,30}?(\d+)\s*ч')
        if m:
            self.put('hours', int(m.group(1)), m, 'Работа от бака, ч')

    COUNT = {'один': 1, 'одного': 1, 'два': 2, 'двух': 2, 'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'четырёх': 4, 'четырех': 4}

    def count(self, s):
        s = str(s or '').lower()
        return int(s) if s.isdigit() else self.COUNT.get(s)

    def reserve(self):
        """резерв N+1 / N+2 и, если указано, число рабочих агрегатов: «2 рабочих + 1 резервный», «схема 2+1»"""
        n = NOT_LETTER + r'(\d|один|одного|два|двух|три|тр[её]х|четыре|четыр[её]х)'
        m = (self.first(n + r'\s*рабоч\w*(?:\s+\w+)?\s*(?:\+|и|,|плюс)\s*' + n + r'\s*резервн')
             or self.first(r'схем\w*\s+(?:резервировани\w*\s+)?(\d)\s*\+\s*(\d)' + END_LETTER))
        if m:
            w, r = self.count(m.group(1)), self.count(m.group(2))
            if w and 1 <= w <= 4:
                self.put('work', str(w), m, 'Рабочих агрегатов')
            if r is not None and 0 <= r <= 2:
                self.put('reserve', str(r), m, 'Резерв N + %d' % r if r else 'Без резерва')
            return
        m = self.first(r'N\s*\+\s*([12])' + END_LETTER)
        if m:
            r = int(m.group(1))
            self.put('reserve', str(r), m, 'Резерв N + %d' % r)
            return
        m = self.first(n + r'\s+рабоч\w+\s+(?:компрессор|насос|агрегат|ДГУ|дизель|электроагрегат)')
        if m and 1 <= (self.count(m.group(1)) or 0) <= 4:
            self.put('work', str(self.count(m.group(1))), m, 'Рабочих агрегатов')
        m = self.first(r'без\s+(?:горячего\s+)?резерв|резерв\w*(?:\s+\w+)?\s+не\s+(?:требу|нуж|предусм)')
        if m:
            self.put('reserve', '0', m, 'Без резерва')
            return
        m = self.first(r'(?:100\s*%\s*резерв|резервн\w+\s+(?:компрессор|насос|агрегат|ДГУ)|с\s+резерв\w*)')
        if m:
            self.put('reserve', '1', m, 'Резерв N + 1')

    def climate(self):
        t = r'([' + MINUS_RX + r'+]?)\s*(\d{1,2})'
        m = self.first(r'(?:температур\w*|наружн\w*\s+воздух\w*|окружающ\w*\s+сред\w*)[^\n]{0,90}?от\s*' + t + r'\s*(?:°\s*[сc])?\s*до\s*' + t)
        if m:
            a, b = self.signed(m.group(1), m.group(2)), self.signed(m.group(3), m.group(4))
            if -70 <= a < b <= 60:
                self.put('tmin', a, m, 'Наружный воздух от, °C')
                self.put('tmax', b, m, 'Наружный воздух до, °C')
            R = r'(?:температур\w*|наружн\w*\s+воздух\w*|окружающ\w*\s+сред\w*)[^\n]{0,90}?от\s*' + t + r'\s*(?:°\s*[сc])?\s*до\s*' + t
            hits = [x for x in self.all(R) if not re.search(r'хранени|транспортир|вод|масл|помещени|внутри|на входе|сжат', self.sentence(x), re.I)]
            self.conflict('tmin', 'Наружный воздух от, °C', [(self.signed(x.group(1), x.group(2)), x) for x in hits])
            self.conflict('tmax', 'Наружный воздух до, °C', [(self.signed(x.group(3), x.group(4)), x) for x in hits])
        if 'tmin' not in self.req:
            m = self.first(r'(?:минимальн\w*|наиболее холодн\w*|абсолютн\w*\s+минимум\w*|расч[её]тн\w*\s+(?:зимн\w*\s+)?температур\w*)[^\n]{0,60}?([' + MINUS_RX + r'])\s*(\d{1,2})')
            if m:
                self.put('tmin', -int(m.group(2)), m, 'Наружный воздух от, °C')
        m = self.first(NOT_LETTER + r'(УХЛ|ХЛ|У)\s?1(?:\.1)?' + r'(?![\d])', 0)
        if m:
            self.put('climate', m.group(1) + '1', m, 'Климатическое исполнение (ГОСТ 15150-69)')

    def fire(self):
        m = self.first(r'(?i:категори\w*[^\n]{0,40}?(?:пожарн\w*|взрывопожарн\w*)[^\n]{0,40}?|(?:пожарн\w*|взрывопожарн\w*)\s+опасност\w*[^\n]{0,30}?)'
                       + NOT_LETTER + r'(В[1-4]|А|Б|Г|Д)' + END_LETTER, 0)
        if not m:
            m = self.first(r'(?i:категори\w*\s+(?:помещени\w*\s+)?)' + NOT_LETTER + r'(В[1-4]|А|Б|Г|Д)' + END_LETTER, 0)
        if m and m.group(1) in self.FIRE:
            self.put('fire', m.group(1), m, 'Категория помещения (СП 12.13130)')

    def noise(self):
        m = self.first(r'(?:шум\w*|уров\w*\s+звук\w*)[^\n]{0,60}?(\d{2,3})\s*д[бb]')
        if m and 40 <= int(m.group(1)) <= 120:
            self.put('noise', int(m.group(1)), m, 'Шум на рабочем месте, дБА')

    def receiver(self):
        m = self.first(r'ресивер\w*[^\n]{0,50}?' + NUM + r'\s*(л|литр\w*|м3|м³)' + END_LETTER)
        if m:
            v = self.num(m.group(1))
            self.put('recvVol', round(v * 1000 if m.group(2).lower() in ('м3', 'м³') and v < 100 else v), m, 'Ресивер, л')
        m = self.first(r'ресивер\w*[^\n]{0,90}?(?:снаружи|на улице|вне (?:контейнер|здани|помещени)\w*|на открыт\w+ площадк\w*|наружн\w* установк\w*)')
        if m:
            self.put('recvOut', True, m, 'Ресивер — снаружи')
        m = self.first(r'ресивер\w*[^\n]{0,60}?(после|до)\s+(?:блок\w*\s+)?(?:осушител|подготовк)')
        if m:
            self.put('recv', 'after' if m.group(1).lower() == 'после' else 'before', m, 'Ресивер — ' + m.group(1).lower() + ' осушителя')

    def container(self):
        m = self.first(r'морск\w*\s+контейнер\w*[^\n]{0,30}?(20|40)\s*(?:футов|фут|ft|\')?([^\n]{0,20})')
        if m:
            hc = bool(re.search(r'hc|high\s*cube|увеличенн', m.group(2) or '', re.I))
            self.put('cont', 'sea%s%s' % (m.group(1), 'hc' if hc else ''), m, 'Контейнер — морской %s футов%s' % (m.group(1), ' HC' if hc else ''))
        else:
            m = self.first(r'«?Север»?\s*(?:\(|$|[,.;])|арктическ\w+\s+исполнен|контейнер\w*\s+«Север»', 0) or self.first(r'арктическ\w+\s+исполнен')
            if m:
                self.put('cont', 'north', m, 'Контейнер — «Север» (арктическое исполнение)')
            else:
                m = self.first(r'блок[- ]?контейнер|блочно[- ]модульн|модульн\w+\s+здани|БМЗ|БКЗ')
                if m:
                    self.put('cont', 'block', m, 'Контейнер — блок-контейнер')
        m = self.first(r'(?:утепл\w*|теплоизоляц\w*)[^\n]{0,40}?(\d{2,3})\s*мм')
        if m and 30 <= int(m.group(1)) <= 300:
            self.put('ins', m.group(1) + ' мм', m, 'Утепление')

    def systems(self):
        rules = [('ops', r'охранно[- ]пожарн|пожарн\w*\s+сигнализац|' + NOT_LETTER + r'(?:ОПС|АУПС)' + END_LETTER, 'Охранно-пожарная сигнализация'),
                 ('fire', r'автоматическ\w*\s+(?:установк\w*\s+)?(?:\w+\s+)?пожаротушени|АУПТ|аэрозольн\w*\s+пожаротуш|порошков\w*\s+пожаротуш|модул\w*\s+пожаротуш', 'Автоматическое пожаротушение'),
                 ('noise', r'шумоизол|шумопоглощ|звукоизол', 'Шумоизоляция'),
                 ('snow', r'маркиз|снегозащит|снегов\w*\s+(?:козыр|защит)|защит\w*\s+от\s+(?:снега|осадков)', 'Маркизы на приточных жалюзи (снегозащита)'),
                 ('snowout', r'маркиз[^.;\n]{0,60}(?:выброс|вытяжн|выход\w*\s+(?:горяч|тёпл|тепл))|(?:выброс|вытяжн)\w*[^.;\n]{0,60}маркиз', 'Маркизы на жалюзи выброса горячего воздуха'),
                 ('gate', r'ворот', 'Ворота')]
        sys = {}
        for key, rx, label in rules:
            m = re.search(rx, self.text, re.I)
            if m:
                sys[key] = True
                self.found.append({'key': 'sys.' + key, 'label': 'Система: ' + label, 'value': True, 'src': self.src(m)})
        if sys:
            self.req['sys'] = sys
        m = self.first(r'паспорт\w*|сертификат\w*|деклараци\w*|ТР\s*ТС|исполнительн\w*\s+документац')
        if m:
            self.put('docs', True, m, 'Документы при поставке')

    OPTIONS = (
        ('oilFree', ('comp',), r'безмасл\w*|oil[\s-]?free|класс\w*\s+0\s+по\s+масл', 'Безмасляный компрессор (класс 0 по маслу)'),
        ('vsd', ('comp', 'pump'), r'частотн\w*\s+(?:регулировани|преобразовател|привод|управлени)|преобразовател\w*\s+частот|'
                                  + NOT_LETTER + r'(?:ПЧ|VSD)' + END_LETTER + r'|инверторн\w*', 'Частотное регулирование'),
        ('ats', ('comp', 'pump', 'dgu'), NOT_LETTER + r'АВР' + END_LETTER + r'|автоматическ\w*\s+(?:включени\w*|ввод\w*)\s+резерв|'
                                         r'(?:два|двух|2)\s+(?:независим\w+\s+)?ввод|(?<![IІ])I\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)|'
                                         r'перв\w+\s+категори\w*\s+(?:по\s+)?(?:надёжн|надежн|электроснабж)', 'Два ввода питания с АВР'),
        ('scada', ('comp', 'pump', 'dgu'), r'диспетчер\w*|' + NOT_LETTER + r'(?:SCADA|АСУ\s?ТП|Modbus|Profinet|Profibus|OPC)' + END_LETTER
                                           + r'|удал[её]нн\w+\s+(?:мониторинг|контрол|управлени)', 'Диспетчеризация (шкаф АСУ ТП)'),
    )

    def options(self):
        """особые требования: безмасляный компрессор, частотное регулирование, АВР (два ввода), диспетчеризация"""
        k = self.req.get('kind')
        for key, kinds, rx, label in self.OPTIONS:
            if k in kinds:
                m = next((x for x in re.finditer(rx, self.text, re.I) if not self.negated(x)), None)
                if m:
                    self.put(key, True, m, label)

    def negated(self, m):
        """«без АВР», «АВР не требуется», «кроме диспетчеризации» — требования нет"""
        before, after = self.text[max(0, m.start() - 25):m.start()], self.text[m.end():m.end() + 40]
        return bool(re.search(r'(?:без|кроме)\s+(?:\w+\s+){0,2}$', before, re.I)
                    or re.match(r'\W*(?:\w+\s+){0,3}не\s+(?:требу|нуж|предусм)', after, re.I))

    def notes(self):
        """прочие требования: предложения с «должен», «необходимо», «требуется» — до 6, без повторов"""
        out = []
        for s in re.split(r'(?<=[.;!?])\s+|\n+', self.text):
            s = s.strip(' •-–—\t')
            if 25 <= len(s) <= 300 and re.search(r'долж[еаноы]\w*|необходим\w*|требуется|обязательн\w*|предусмотреть|обеспечить', s, re.I) and s not in out:
                out.append(s)
            if len(out) >= 6:
                break
        if out:
            self.req['notes'] = '\n'.join(out)


class TzReview:
    """Анкета по ТЗ для расчёта станции: каждый нужный параметр — статус found (найдено в ТЗ, с цитатой и страницей),
    default (принято по умолчанию — значение и почему), missing (отсутствует), conflict (в ТЗ разные значения — принято
    более требовательное). Вопросы заказчику (questions) — только по параметрам, без которых станцию не подобрать (NEED);
    остальное (later) — «можно уточнить позже»: расчёт уже взял значение по умолчанию с запасом в пользу заказчика."""
    STATUS = {'found': 'найдено в ТЗ', 'default': 'принято по умолчанию', 'missing': 'отсутствует', 'conflict': 'противоречие'}
    NEED = {'comp': ('flow', 'pressure'), 'dgu': ('kw',), 'pump': ('q', 'head')}
    # ключ, подпись, значение по умолчанию (None — нет: отсутствует), почему так, вопрос заказчику (None — не спрашивать)
    COMMON_T = [
        ('tmin', 'Наружный воздух от, °C', None, '', 'Минимальная температура наружного воздуха на площадке (зимой), °C.'),
        ('tmax', 'Наружный воздух до, °C', None, '', 'Максимальная температура наружного воздуха на площадке (летом), °C.'),
        ('alt', 'Высота над уровнем моря, м', 0, 'в ТЗ не указана — принято 0 м (на высоте больше 1000 м мощность оборудования снижается)', 'Высота площадки над уровнем моря, м.'),
    ]
    FIELDS = {
        'comp': [
            ('flow', 'Производительность, м³/мин', None, '', 'Требуемая производительность станции, м³/мин.'),
            ('basis', 'Производительность приведена к условиям', 'fad', 'в ТЗ не сказано — принято FAD (условия всасывания, ISO 1217), как в паспортах компрессоров',
             'К каким условиям приведена производительность: условия всасывания (FAD, ISO 1217) или нормальные м³ (0 °C, 101,325 кПа)?'),
            ('pressure', 'Давление у потребителя, бар', None, '', 'Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.'),
            ('air', 'Класс чистоты ISO 8573-1', None, '', 'Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1 (частицы.вода.масло) или требуемая точка росы.'),
            ('margin', 'Запас производительности, %', 0, 'нормами РФ не установлен (ПБ 03-581-03 отменены) — по ТЗ; не указан — 0 %',
             'Нужен ли запас производительности сверх потребности (утечки, развитие производства), %?'),
            ('reserve', 'Резерв компрессоров', '0', 'в ТЗ не указан — без резерва', 'Нужен ли резервный компрессор (N+1)?'),
        ] + COMMON_T + [
            ('rh', 'Относительная влажность воздуха, %', 100, 'для перевода нормальных м³ в FAD принято 100 % (с запасом)', 'Относительная влажность наружного воздуха летом, %.'),
            ('fire', 'Категория помещения', None, '', 'Категория помещения станции по взрывопожарной и пожарной опасности (СП 12.13130) — если определена проектом.'),
        ],
        'dgu': [
            ('kw', 'Мощность нагрузки, кВт', None, '', 'Мощность нагрузки ДЭС, кВт (длительная и максимальная).'),
            ('mode', 'Режим ДЭС', 'prime', 'в ТЗ не указан — принят основной источник (PRP): мощность с запасом', 'ДЭС — основной источник электроснабжения или резервный (при отключении сети, до 200 ч в год)?'),
            ('load', 'Средняя нагрузка за сутки, %', 100, 'график нагрузки не задан — принята постоянная 100 % (с запасом)', 'График нагрузки за сутки: средняя нагрузка, % от максимальной.'),
            ('motor', 'Наибольший двигатель нагрузки, кВт', None, '', 'Мощность наибольшего электродвигателя нагрузки, кВт, и как он пускается (прямой пуск, звезда — треугольник, плавный пуск, частотный преобразователь).'),
            ('start', 'Пуск наибольшего двигателя', 'direct', 'не указан — принят прямой пуск (наибольший пусковой ток)', None),
            ('hours', 'Работа от бака, ч', None, '', 'Требуемое время работы без дозаправки, ч.'),
            ('rel', 'Категория надёжности электроснабжения', None, '', 'Категория надёжности электроснабжения потребителей (I, II, III) — нужен ли автоматический ввод резерва.'),
            ('reserve', 'Резерв ДГУ', '0', 'в ТЗ не указан — без резерва', 'Нужен ли резервный ДГУ (N+1)?'),
        ] + COMMON_T + [
            ('fire', 'Категория помещения', None, '', 'Категория помещения ДЭС по взрывопожарной и пожарной опасности (СП 12.13130) — если определена проектом.'),
        ],
        'pump': [
            ('q', 'Подача, м³/ч', None, '', 'Требуемая подача, м³/ч.'),
            ('head', 'Напор, м', None, '', 'Требуемый напор, м.'),
            ('reserve', 'Резерв насосов', '0', 'в ТЗ не указан — без резерва', 'Нужен ли резервный насос (N+1)?'),
        ] + COMMON_T[:2],
    }
    TERMS = [
        ('noise', 'Шум на рабочем месте, дБА', 80, 'не указан — по СанПиН 1.2.3685-21 не более 80 дБА', None),
        ('warranty', 'Гарантия, мес.', None, '', 'Требуемый гарантийный срок, мес.'),
        ('deadline', 'Срок поставки', None, '', 'Требуемый срок поставки.'),
    ]

    def __init__(self, p):
        self.p = p
        self.kind = p.req.get('kind') or 'comp'
        self.byKey = {f['key']: f for f in p.found}
        self.conf = {c['key']: c for c in p.conflicts}

    def spec(self):
        L = self.FIELDS.get(self.kind, self.FIELDS['comp']) + self.TERMS
        if self.kind == 'comp' and self.p.req.get('basis') != 'normal':
            L = [x for x in L if x[0] != 'rh']        # влажность нужна только для пересчёта нормальных м³
        if self.kind == 'dgu' and not self.p.req.get('motor'):
            L = [x for x in L if x[0] != 'start']
        return L

    def fields(self):
        out = []
        for key, label, dflt, why, _ in self.spec():
            f, c = self.byKey.get(key), self.conf.get(key)
            if c:
                out.append({'key': key, 'label': label, 'status': 'conflict', 'value': f['value'] if f else c.get('value'), 'values': c['values'],
                            'why': 'в ТЗ разные значения — принято %s %s (с запасом в пользу заказчика)' % (
                                'меньшее' if key in TzParse.LOW_WINS else 'большее', self.fmt(f['value'] if f else c.get('value')))})
            elif f:
                out.append({'key': key, 'label': label, 'status': 'found', 'value': f['value'], 'src': f['src'], 'page': f.get('page')})
            elif key == 'air' and 'pdp' in self.p.req:
                out.append({'key': key, 'label': label, 'status': 'found', 'value': self.p.req.get('air')})
            elif dflt is not None:
                out.append({'key': key, 'label': label, 'status': 'default', 'value': dflt, 'why': why})
            else:
                out.append({'key': key, 'label': label, 'status': 'missing', 'value': None})
        return out

    @staticmethod
    def fmt(v):
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return str(v).replace('.', ',').replace('-', '−')

    def questions(self):
        """обязательные вопросы: без ответа станцию не подобрать"""
        need = self.NEED.get(self.kind, ())
        return [q for key, _, _, _, q in self.spec() if key in need and q
                for f in self.fields() if f['key'] == key and f['status'] == 'missing']

    def later(self):
        """можно уточнить позже: параметры по умолчанию и отсутствующие (кроме обязательных), противоречия — подтвердить
        принятое значение"""
        ask, need, out = {key: q for key, _, _, _, q in self.spec()}, self.NEED.get(self.kind, ()), []
        for f in self.fields():
            q = ask.get(f['key'])
            if f['status'] == 'conflict':
                vals = '; '.join('%s%s' % (self.fmt(v['value']), ' (стр. %s)' % v['page'] if v.get('page') else '') for v in f['values'])
                out.append('%s: в ТЗ разные значения — %s; принято %s. Подтвердите.' % (f['label'], vals, self.fmt(f['value'])))
            elif f['status'] in ('missing', 'default') and q and f['key'] not in need:
                out.append(q)
        return out
