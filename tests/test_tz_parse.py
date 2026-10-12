# -*- coding: utf-8 -*-
"""ТЗ заказчика: текст из документа (app/doc_text.py — DOCX, XLSX, ODT, RTF, TXT; старые .doc и опасная разметка —
понятный отказ), требования к станции правилами (app/tz_parse.py — единицы приводятся, у каждого значения цитата из ТЗ),
маршрут сервера /api/tz/parse на стенде с вымышленными данными и подбор оборудования по требованиям в интерфейсе
(node tests/js/tz_pick.js — каталог в памяти)."""
import io
import os
import shutil
import subprocess
import sys
import unittest
import zipfile

from kit import APP, REPO, SampleData, Stand

sys.path.insert(0, APP)
from doc_text import DocText, TextQuality   # noqa: E402
from tz_parse import TzParse   # noqa: E402


class NoOcr:
    """распознавание недоступно (не Windows)"""
    @staticmethod
    def available():
        return False


class FakeOcr:
    """распознавание Windows — заглушка: страницы скана заданным текстом"""
    pages = []
    calls = []

    @staticmethod
    def available():
        return True

    @classmethod
    def recognize(cls, data, kind):
        cls.calls.append(kind)
        return {'pages': list(cls.pages), 'total': len(cls.pages), 'lang': 'ru'}


def pdf(pages):
    """маленький PDF: страницы с текстом (латиница, шрифт Helvetica) или пустые — как скан без текстового слоя"""
    objs = ['<< /Type /Catalog /Pages 2 0 R >>', None, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    kids = []
    for t in pages:
        body = ('BT /F1 12 Tf 72 720 Td (%s) Tj ET' % t) if t else ''
        objs.append('<< /Length %d >>\nstream\n%s\nendstream' % (len(body), body))
        objs.append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>' % len(objs))
        kids.append('%d 0 R' % len(objs))
    objs[1] = '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join(kids), len(kids))
    out, offs = b'%PDF-1.4\n', []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += ('%d 0 obj\n%s\nendobj\n' % (i, o)).encode('latin-1')
    x = len(out)
    out += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)).encode() + b''.join(b'%010d 00000 n \n' % o for o in offs)
    out += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, x)).encode()
    return out

TZ = """Техническое задание на поставку компрессорной станции в блок-контейнере.
1. Производительность станции — не менее 12,5 м³/мин при рабочем давлении 0,8 МПа.
2. Класс чистоты сжатого воздуха по ГОСТ Р ИСО 8573-1-2016 — 2.4.2.
3. Состав: 2 рабочих + 1 резервный компрессор. Ресивер объёмом 2 м3 установить снаружи на открытой площадке после осушителя.
4. Климатическое исполнение УХЛ1, температура наружного воздуха от −45 °С до +40 °С.
5. Категория помещения по взрывопожарной и пожарной опасности — В4. Уровень шума на рабочем месте не более 80 дБА.
6. Блок-контейнер утеплённый, утепление 100 мм, охранно-пожарная сигнализация, автоматическое пожаротушение.
7. Поставщик должен предоставить паспорта и сертификаты соответствия ТР ТС."""


class Office:
    """Маленькие документы для проверок — как их сохраняют Word, Excel и LibreOffice."""
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

    @staticmethod
    def zipped(parts):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
            for n, t in parts.items():
                z.writestr(n, t)
        return b.getvalue()

    @classmethod
    def docx(cls, paras, table=None):
        p = ''.join('<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % t for t in paras)
        tb = '<w:tbl>%s</w:tbl>' % ''.join('<w:tr>%s</w:tr>' % ''.join('<w:tc><w:p><w:r><w:t>%s</w:t></w:r></w:p></w:tc>' % c for c in r)
                                           for r in table) if table else ''
        return cls.zipped({'[Content_Types].xml': '<Types/>', 'word/document.xml': '<?xml version="1.0"?><w:document %s><w:body>%s%s</w:body></w:document>' % (cls.W, p, tb)})

    @classmethod
    def xlsx(cls, rows):
        ss, cells = [], []
        for r, row in enumerate(rows, 1):
            cs = []
            for c, v in enumerate(row):
                if isinstance(v, str):
                    ss.append(v)
                    cs.append('<c r="%s%d" t="s"><v>%d</v></c>' % ('ABCDEF'[c], r, len(ss) - 1))
                else:
                    cs.append('<c r="%s%d"><v>%s</v></c>' % ('ABCDEF'[c], r, v))
            cells.append('<row r="%d">%s</row>' % (r, ''.join(cs)))
        ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        return cls.zipped({'xl/workbook.xml': '<workbook %s/>' % ns,
                           'xl/sharedStrings.xml': '<sst %s>%s</sst>' % (ns, ''.join('<si><t>%s</t></si>' % s for s in ss)),
                           'xl/worksheets/sheet1.xml': '<worksheet %s><sheetData>%s</sheetData></worksheet>' % (ns, ''.join(cells))})

    @classmethod
    def odt(cls, paras):
        ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
        body = ''.join('<text:p>%s</text:p>' % t for t in paras)
        return cls.zipped({'mimetype': 'application/vnd.oasis.opendocument.text',
                           'content.xml': '<office:document-content %s><office:body><office:text>%s</office:text></office:body></office:document-content>' % (ns, body)})


class DocTextTest(unittest.TestCase):
    def test_formats(self):
        d = DocText.extract('tz.docx', Office.docx(TZ.split('\n'), [['Параметр', 'Значение'], ['Давление', '8 бар']]))
        self.assertEqual(d['kind'], 'docx')
        self.assertIn('12,5 м³/мин', d['text'])
        self.assertIn('Давление | 8 бар', d['text'], 'таблица — строкой «ячейка | ячейка»')
        x = DocText.extract('опросный лист.xlsx', Office.xlsx([['Параметр', 'Значение'], ['Производительность, м3/мин', 10], ['Давление, бар', 8]]))
        self.assertEqual(x['kind'], 'xlsx')
        self.assertIn('Производительность, м3/мин | 10', x['text'])
        o = DocText.extract('tz.odt', Office.odt(['Насосная станция: подача 120 м3/ч, напор 45 м.', 'Категория помещения Д.']))
        self.assertIn('подача 120 м3/ч', o['text'])
        r = DocText.extract('tz.rtf', rb"{\rtf1\ansi\ansicpg1251{\fonttbl{\f0 Arial;}}\f0 \'cd\'e0\'f1\'ee\'f1\'ed\'e0\'ff \u1089?\'f2\'e0\'ed\'f6\'e8\'ff: "
                                      rb"\'ef\'ee\'e4\'e0\'f7\'e0 100 \'ec3/\'f7\par \'cd\'e0\'ef\'ee\'f0 40 \'ec\par}")
        self.assertIn('Насосная', r['text'])
        self.assertIn('подача 100 м3/ч', r['text'])
        self.assertNotIn('Arial', r['text'], 'таблица шрифтов пропускается')
        t = DocText.extract('tz.txt', TZ.replace('³', '3').replace('−', '-').encode('cp1251'))
        self.assertIn('Производительность станции', t['text'], 'Windows-1251')
        self.assertIn('Компрессорной'.lower(), DocText.extract('tz.txt', TZ.encode('utf-8'))['text'].lower())

    def test_refusals(self):
        cases = [(b'', 'пустой'), (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\0' * 100, 'DOCX'), (b'PK\x03\x04garbage', 'повреждён'),
                 (Office.zipped({'a.txt': 'x'}), 'не похож'), (b'\x89PNG\r\n\x1a\n' + b'\0' * 50, 'Windows 10/11'), (pdf(['', '']), 'скан'),
                 (Office.zipped({'word/document.xml': '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>'}), 'недопустимой')]
        for data, word in cases:
            with self.subTest(word), self.assertRaises(ValueError) as e:
                DocText.extract('tz.bin', data, ocr=NoOcr)
            self.assertIn(word, str(e.exception))
        old = DocText.MAX_PART
        DocText.MAX_PART = 1000
        try:
            with self.assertRaises(ValueError):
                DocText.extract('tz.docx', Office.docx(['x' * 5000]))
        finally:
            DocText.MAX_PART = old


class ScanTest(unittest.TestCase):
    """сканы: текстовый слой PDF против распознавания Windows (заглушка) — берётся лучший, страницы — в цитатах"""
    SCAN = ['Техническое задание. Компрессорная станция в блок-контейнере.',
            'Производительность станции не менее 20 нм3/мин. Рабочее давление 7 бар. Высота площадки над уровнем моря 900 м.']

    def test_quality(self):
        self.assertGreater(TextQuality.score(TZ), 0.85, 'обычный русский текст')
        self.assertLess(TextQuality.score('ÐŸÑ€Ð¾Ð¸Ð·Ð²Ð¾Ð´Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ð¾ÑÑ‚ÑŒ ÑÑ‚Ð°Ð½Ñ†Ð¸Ð¸ Ð½Ðµ Ð¼ÐµÐ½ÐµÐµ ' * 3), TextQuality.LOW, 'кракозябры')
        self.assertEqual(TextQuality.score('ab'), 0.0)

    def test_scanned_pdf(self):
        FakeOcr.pages, FakeOcr.calls = self.SCAN, []
        d = DocText.extract('tz.pdf', pdf(['', '']), ocr=FakeOcr)
        self.assertEqual((d['kind'], d['pages'], FakeOcr.calls), ('pdf-ocr', 2, ['pdf']))
        self.assertEqual([m['id'] for m in d['methods']], ['pdf', 'ocr'], 'оба способа — в ответе')
        self.assertTrue(next(m for m in d['methods'] if m['id'] == 'ocr')['used'])
        self.assertIn('\f', d['text'], 'граница страниц')
        r = TzParse.parse(d['text'])
        f = {x['key']: x for x in r['found']}
        self.assertEqual((f['flow']['value'], f['flow']['page'], f['basis']['value'], f['alt']['value']), (20.0, 2, 'normal', 900))
        self.assertNotIn('\f', f['flow']['src'])

    def test_text_pdf_no_ocr(self):
        FakeOcr.pages, FakeOcr.calls = self.SCAN, []
        d = DocText.extract('tz.pdf', pdf(['Compressor station technical requirements page one', 'Flow rate 20 m3/min, pressure 7 bar, page two']), ocr=FakeOcr)
        self.assertEqual((d['kind'], FakeOcr.calls), ('pdf', []), 'текст хороший — распознавание не нужно')

    def test_image(self):
        FakeOcr.pages, FakeOcr.calls = self.SCAN[1:], []
        d = DocText.extract('tz.png', b'\x89PNG\r\n\x1a\n' + b'\0' * 50, ocr=FakeOcr)
        self.assertEqual((d['kind'], FakeOcr.calls), ('image', ['image']))
        self.assertIn('нм3/мин', d['text'])


class TzParseTest(unittest.TestCase):
    def test_compressor(self):
        r = TzParse.parse(TZ)
        q = r['req']
        self.assertEqual(r['kind'], 'comp')
        self.assertEqual((q['flow'], q['pressure'], q['air']), (12.5, 8.0, '2.4.2'), '0,8 МПа → 8 бар')
        self.assertEqual((q['work'], q['reserve'], q['tmin'], q['tmax'], q['climate'], q['fire'], q['noise']), ('2', '1', -45, 40, 'УХЛ1', 'В4', 80))
        self.assertEqual((q['recvVol'], q['recvOut'], q['recv'], q['cont'], q['ins']), (2000, True, 'after', 'block', '100 мм'))
        self.assertEqual(q['sys'], {'ops': True, 'fire': True})
        self.assertTrue(q['docs'])
        snow = TzParse.parse('Компрессорная станция 10 м3/мин, 8 бар. Жалюзи воздухозабора — с маркизами (снегозащита).')['req']
        self.assertTrue(snow.get('sys', {}).get('snow'), 'маркизы на притоке — система «snow»')
        self.assertFalse(snow.get('sys', {}).get('snowout'), 'на выбросе — только если сказано')
        out = TzParse.parse('Компрессорная станция 10 м3/мин. Маркизы на жалюзи притока и выброса горячего воздуха.')['req']
        self.assertTrue(out.get('sys', {}).get('snow') and out.get('sys', {}).get('snowout'), 'маркизы и на выбросе — «snowout»')
        self.assertIn('предоставить паспорта', q['notes'])
        for f in r['found']:
            self.assertTrue(f['src'] and f['label'], f)
        self.assertIn('12,5 м³/мин', next(f for f in r['found'] if f['key'] == 'flow')['src'], 'цитата из ТЗ')

    def test_units_and_kinds(self):
        P = lambda t: TzParse.parse(t)['req']   # noqa: E731
        self.assertEqual(P('Компрессор, расход воздуха 600 м3/ч')['flow'], 10)
        self.assertEqual(P('Компрессор: производительность 6200 л/мин, давление 10 бар')['flow'], 6.2)
        self.assertEqual(P('Компрессорная станция, давление 7 кгс/см2')['pressure'], 6.9)
        p = P('Насосная станция: подача 25 л/с, напор 3 бар; 2 рабочих и 1 резервный насос. Морской контейнер 40 футов HC.')
        self.assertEqual((p['kind'], p['q'], p['head'], p['work'], p['reserve'], p['cont']), ('pump', 90.0, 30.6, '2', '1', 'sea40hc'))
        d = P('Дизельная электростанция 250 кВА, работа без дозаправки не менее 24 ч, температура от -55 до +35 °C, контейнер «Север».')
        self.assertEqual((d['kind'], d['kw'], d['hours'], d['tmin'], d['cont']), ('dgu', 200.0, 24, -55, 'north'))
        self.assertEqual(P('Компрессор. Схема резервирования N+2.')['reserve'], '2')
        self.assertEqual(P('Компрессорная; точка росы под давлением −40 °C')['pdp'], -40)
        d = P('Компрессорная. Точка росы под давлением минус 40 °C')
        self.assertEqual((d['pdp'], d['air']), (-40, '2.2.2'), 'класс воды — по точке росы')
        self.assertEqual(P('Компрессор, класс 2.4.2 по ISO 8573-1, точка росы −20 °C')['air'], '2.3.2', 'строже из двух')
        self.assertEqual(P('Компрессорная, схема резервирования 2+1')['work'], '2')
        self.assertEqual(P('Компрессорная, три рабочих компрессора, без резерва')['reserve'], '0')
        self.assertEqual(P('Компрессорная. Резервный компрессор не требуется.')['reserve'], '0', 'отрицание — без резерва')
        self.assertNotIn('air', P('Компрессор, производительность 1.2.3 м3/мин'), 'класс — только с «ISO 8573» или «класс»')
        self.assertEqual(TzParse.parse('Просто текст без требований к станции, ничего подходящего здесь нет.')['req'], {})

    def test_options(self):
        P = lambda t: TzParse.parse(t)['req']   # noqa: E731
        q = P('Насосная станция, насосы с преобразователем частоты, два ввода с АВР, передача данных в диспетчерскую по Modbus TCP.')
        self.assertEqual((q.get('vsd'), q.get('ats'), q.get('scada')), (True, True, True))
        self.assertTrue(P('Компрессорная станция с безмасляными компрессорами, класс 0 по маслу.')['oilFree'])
        self.assertNotIn('oilFree', P('Насосная станция, безмасляный насос'), 'безмасляный — только у компрессорной')
        self.assertTrue(P('ДГУ, I категория надёжности электроснабжения.')['ats'])
        q = P('Компрессорная, II категории надежности, без АВР в составе поставки; диспетчеризация не предусматривается.')
        self.assertNotIn('ats', q, 'II категория и «без АВР» — не АВР')
        self.assertNotIn('scada', q, '«не предусматривается» — нет')


class TzReviewTest(unittest.TestCase):
    """анкета по ТЗ: статусы параметров, противоречия, новые поля для расчёта станции, вопросы заказчику"""

    def test_statuses(self):
        r = TzParse.parse(TZ)
        st = {f['key']: f['status'] for f in r['fields']}
        self.assertEqual((st['flow'], st['pressure'], st['air'], st['reserve']), ('found', 'found', 'found', 'found'))
        self.assertEqual((st['basis'], st['margin'], st['alt']), ('default', 'default', 'default'))
        self.assertEqual(st['deadline'], 'missing')
        self.assertNotIn('rh', st, 'влажность — только для нормальных м³')
        # производительность и давление найдены — обязательных вопросов нет; остальное — «можно уточнить позже»
        self.assertEqual(r['questions'], [])
        q = ' '.join(r['later'])
        self.assertIn('К каким условиям приведена производительность', q)
        self.assertIn('запас производительности', q)
        r2 = TzParse.parse('Компрессорная станция производительностью 10 м3/мин.')
        self.assertEqual(r2['questions'], ['Требуемое рабочее давление сжатого воздуха у потребителя (на выходе станции), бар.'])
        self.assertNotIn(r2['questions'][0], r2['later'])
        self.assertEqual(TzParse.parse('Дизельная электростанция.')['questions'], ['Мощность нагрузки ДЭС, кВт (длительная и максимальная).'])
        self.assertEqual(r['conflicts'], [])
        b = next(f for f in r['fields'] if f['key'] == 'basis')
        self.assertEqual(b['value'], 'fad')
        self.assertIn('ISO 1217', b['why'])

    def test_conflicts(self):
        t = ('Компрессорная станция. Производительность станции не менее 10 м3/мин при давлении 8 бар.\n'
             'Таблица 1. Производительность станции — 12 м3/мин. Колебание давления не более ±0,3 бар. Ресивер на давление 11 бар.')
        r = TzParse.parse(t)
        self.assertEqual([c['key'] for c in r['conflicts']], ['flow'], 'давление ±0,3 и давление ресивера — не противоречие')
        self.assertEqual([v['value'] for v in r['conflicts'][0]['values']], [10.0, 12.0])
        f = next(x for x in r['fields'] if x['key'] == 'flow')
        self.assertEqual(f['status'], 'conflict')
        # в пользу заказчика: принято большее (с цитатой), заказчика не спрашиваем — подтвердить можно позже
        self.assertEqual((r['req']['flow'], f['value'], r['conflicts'][0]['value']), (12.0, 12.0, 12.0))
        self.assertIn('12 м3/мин', next(x for x in r['found'] if x['key'] == 'flow')['src'])
        self.assertIn('принято большее 12', f['why'])
        self.assertEqual(r['questions'], [])
        self.assertTrue(any('разные значения — 10; 12; принято 12' in x for x in r['later']), r['later'])
        # зима — меньшее (холоднее), лето — большее
        r = TzParse.parse('Температура наружного воздуха от −40 до +35 °C. Станция работает при температуре наружного воздуха от −45 до +40 °C.')
        self.assertEqual((r['req']['tmin'], r['req']['tmax']), (-45, 40))

    def test_new_fields(self):
        P = lambda t: TzParse.parse(t)['req']   # noqa: E731
        q = P('Компрессорная станция производительностью 15 нм3/мин с запасом 10 %. Высота над уровнем моря 1200 м, '
              'относительная влажность 80 %. Гарантия 2 года. Срок поставки 60 календарных дней. Аналоги не допускаются.')
        self.assertEqual((q['flow'], q['basis'], q['margin'], q['alt'], q['rh'], q['warranty'], q['deadline'], q['noAnalogs']),
                         (15.0, 'normal', 10.0, 1200, 80, 24, '60 календарных дней', True))
        self.assertEqual(P('Компрессор, производительность по ISO 1217 — 8 м3/мин')['basis'], 'fad')
        d = P('ДЭС — резервный источник электроснабжения 300 кВт. Средняя нагрузка 60 %. Пуск асинхронного двигателя насоса 55 кВт '
              'через устройство плавного пуска. Потребители I категории надёжности.')
        self.assertEqual((d['kind'], d['mode'], d['load'], d['motor'], d['start'], d['rel']), ('dgu', 'standby', 60, 55.0, 'soft', '1'))
        d = P('Дизельная электростанция — основной источник питания, 500 кВт, круглосуточная работа.')
        self.assertEqual(d['mode'], 'prime')
        r = TzParse.parse('Дизельная электростанция 400 кВт.')
        st = {f['key']: f['status'] for f in r['fields']}
        self.assertEqual((st['kw'], st['mode'], st['load'], st['motor'], st['hours']), ('found', 'default', 'default', 'missing', 'missing'))
        self.assertNotIn('start', st, 'пуск — когда известен двигатель')


class TzPickJs(unittest.TestCase):
    def test_pick(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'tz_pick.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


class TzRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand(sample=SampleData(items=10, clients=2, kps=1)).start()
        cls.H = Stand.as_manager(SampleData.MANAGERS[0])

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def test_route(self):
        st, b, _ = self.stand.http.req('POST', '/api/tz/parse?name=%D0%A2%D0%97.docx', Office.docx(TZ.split('\n')), headers=self.H)
        self.assertEqual(st, 200, b[:300])
        r = self.stand.http.js(b)
        self.assertEqual((r['kind'], r['req']['flow'], r['doc']['kind']), ('comp', 12.5, 'docx'))
        self.assertTrue(r['fields'] and r['later'], 'анкета и вопросы «уточнить позже»')
        self.assertEqual(r['questions'], [], 'производительность и давление в ТЗ есть — обязательных вопросов нет')
        self.assertGreater(r['doc']['quality'], 0.8)
        self.assertEqual([m['id'] for m in r['doc']['methods']], ['text'])
        self.assertIn('Производительность', r['text'])
        st, b, _ = self.stand.http.req('POST', '/api/tz/parse?name=old.doc', b'\xd0\xcf\x11\xe0' + b'\0' * 64, headers=self.H)
        self.assertEqual(st, 422)
        self.assertIn('DOCX', b)
        self.assertEqual(self.stand.request_errors(), [], 'без ошибок сервера')


if __name__ == '__main__':
    unittest.main()
