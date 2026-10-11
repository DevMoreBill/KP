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
from doc_text import DocText   # noqa: E402
from tz_parse import TzParse   # noqa: E402

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
                 (Office.zipped({'a.txt': 'x'}), 'не похож'), (b'\x89PNG\r\n\x1a\n' + b'\0' * 50, 'не распознан'),
                 (Office.zipped({'word/document.xml': '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>'}), 'недопустимой')]
        for data, word in cases:
            with self.subTest(word), self.assertRaises(ValueError) as e:
                DocText.extract('tz.bin', data)
            self.assertIn(word, str(e.exception))
        old = DocText.MAX_PART
        DocText.MAX_PART = 1000
        try:
            with self.assertRaises(ValueError):
                DocText.extract('tz.docx', Office.docx(['x' * 5000]))
        finally:
            DocText.MAX_PART = old


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
        self.assertIn('Производительность', r['text'])
        st, b, _ = self.stand.http.req('POST', '/api/tz/parse?name=old.doc', b'\xd0\xcf\x11\xe0' + b'\0' * 64, headers=self.H)
        self.assertEqual(st, 422)
        self.assertIn('DOCX', b)
        self.assertEqual(self.stand.request_errors(), [], 'без ошибок сервера')


if __name__ == '__main__':
    unittest.main()
