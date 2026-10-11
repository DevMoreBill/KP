# -*- coding: utf-8 -*-
"""Требования к станции из текста ТЗ заказчика — правилами (без ИИ): вид станции, производительность и давление
(компрессорная), класс чистоты по ISO 8573-1 или точка росы, подача и напор (насосная), мощность (ДГУ), резерв,
температуры наружного воздуха, климатическое исполнение, категория помещения, шум, ресивер (объём, снаружи, до или
после осушителя), контейнер (тип, утепление), системы (ОПС, пожаротушение, шумоизоляция, ворота), документы.

Каждое найденное значение — с цитатой из ТЗ (src), чтобы менеджер проверил его в окне разбора. Единицы приводятся:
производительность — м³/мин, давление — бар, подача — м³/ч, напор — м, мощность — кВт.
"""
import re

NUM = r'(\d+(?:[.,]\d+)?)'
MINUS = '−–-'
MINUS_RX = r'−–\-'                 # те же знаки — внутри [ ] регулярного выражения
NOT_LETTER = r'(?<![А-Яа-яЁёA-Za-z])'
END_LETTER = r'(?![А-Яа-яЁёA-Za-z0-9])'


class TzParse:
    FIRE = ('А', 'Б', 'В1', 'В2', 'В3', 'В4', 'Г', 'Д')

    def __init__(self, text):
        self.text = re.sub(r'[ \t\xa0]+', ' ', str(text or ''))
        self.low = self.text.lower()
        self.req, self.found = {}, []

    @classmethod
    def parse(cls, text):
        """{'kind', 'req': {…}, 'found': [{key, label, value, src}]}"""
        p = cls(text)
        p.run()
        return {'kind': p.req.get('kind', ''), 'req': p.req, 'found': p.found}

    # ---- помощники
    @staticmethod
    def num(s):
        return float(str(s).replace(',', '.').replace(' ', ''))

    def src(self, m):
        a, b = max(0, m.start() - 60), min(len(self.text), m.end() + 60)
        s = self.text[a:b].replace('\n', ' ').strip()
        return ('…' if a else '') + s + ('…' if b < len(self.text) else '')

    def put(self, key, value, m, label):
        if key in self.req or value in (None, ''):
            return
        self.req[key] = value
        self.found.append({'key': key, 'label': label, 'value': value, 'src': self.src(m) if m else ''})

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
        elif k == 'pump':
            self.pump()
        elif k == 'dgu':
            self.dgu()
        self.reserve()
        self.climate()
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
        if m:
            v, unit = self.num(m.group(1)), m.group(2).lower()
            q = v / 60 if '/ч' in unit else v / 1000 if 'л/мин' in unit else v * 0.06 if 'л/с' in unit else v
            self.put('flow', round(q, 2), m, 'Производительность, м³/мин')
        m = self.first(r'(?:рабоч\w*\s+|избыточн\w*\s+|номинальн\w*\s+|выходн\w*\s+)?давлени\w*[^\n]{0,60}?' + NUM + r'\s*(бар|bar|мпа|кгс/см2|кгс/см²|атм|ати)' + END_LETTER)
        if m:
            v, unit = self.num(m.group(1)), m.group(2).lower()
            bar = v * 10 if unit == 'мпа' else v * 0.981 if unit.startswith('кгс') else v * 1.013 if unit in ('атм', 'ати') else v
            if 0.5 <= bar <= 400:
                self.put('pressure', round(bar, 1), m, 'Давление, бар')
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
