# -*- coding: utf-8 -*-
"""ТЗ на сборку станции: документ Word без шаблона (app/web/js/features/docx-writer.js). Node собирает образец
(tests/js/docx_writer.js), проверка разбирает пакет: все части — правильный XML, связи ведут на существующие части,
типы содержимого объявлены, текст экранирован, управляющих знаков нет, рисунки — только PNG и JPEG."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from xml.etree import ElementTree as ET

from kit import REPO

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT = '{http://schemas.openxmlformats.org/package/2006/content-types}'


class DocxWriterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which('node')
        if not node:
            raise unittest.SkipTest('нет Node.js')
        cls.tmp = tempfile.mkdtemp(prefix='kp-docx-')
        cls.path = os.path.join(cls.tmp, 'tz.docx')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'docx_writer.js'), cls.path], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
        if r.returncode:
            raise AssertionError((r.stdout + r.stderr)[-4000:])
        cls.z = zipfile.ZipFile(cls.path)

    @classmethod
    def tearDownClass(cls):
        cls.z.close()
        shutil.rmtree(cls.tmp, True)

    def xml(self, name):
        return ET.fromstring(self.z.read(name))

    def test_parts_are_xml(self):
        names = self.z.namelist()
        for need in ('[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels',
                     'word/footer1.xml', 'docProps/core.xml', 'docProps/app.xml'):
            self.assertIn(need, names)
        for n in names:
            if n.endswith('.xml') or n.endswith('.rels'):
                self.xml(n)                     # разбирается — значит, правильный XML
                self.assertFalse(re.search(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', self.z.read(n)), n + ': управляющие знаки')

    def test_relations_and_types(self):
        names = set(self.z.namelist())
        rels = {r.get('Id'): r.get('Target') for r in self.xml('word/_rels/document.xml.rels').iter(PR + 'Relationship')}
        for t in rels.values():
            self.assertIn('word/' + t, names, 'связь на существующую часть')
        doc = self.xml('word/document.xml')
        emb = [b.get(R + 'embed') for b in doc.iter(A + 'blip')]
        self.assertEqual(len(emb), 2, 'два рисунка (SVG не попадает)')
        for e in emb:
            self.assertIn(e, rels)
        self.assertEqual(sorted(t.rsplit('.', 1)[1] for t in rels.values() if t.startswith('media/')), ['jpeg', 'png'])
        ct = self.xml('[Content_Types].xml')
        ext = {d.get('Extension') for d in ct.iter(CT + 'Default')}
        self.assertTrue({'png', 'jpeg', 'rels', 'xml'} <= ext)
        parts = {o.get('PartName') for o in ct.iter(CT + 'Override')}
        self.assertTrue({'/word/document.xml', '/word/styles.xml', '/word/footer1.xml'} <= parts)
        sect = doc.find('.//' + W + 'sectPr')
        self.assertEqual(sect.find(W + 'footerReference').get(R + 'id'), 'rIdFoot')
        self.assertEqual(sect.find(W + 'pgSz').get(W + 'w'), str(round(210 * 56.7)), 'А4')

    def test_text_tables_escaping(self):
        doc = self.xml('word/document.xml')
        text = ''.join(t.text or '' for t in doc.iter(W + 't'))
        for s in ('Техническое задание на сборку станции в контейнере', 'DVK 37 & <поз. 1>', '1.1. Пункт первый', 'Компрессор «А» & Б', 'x < y',
                  'Управляющие  знаки убираются'):
            self.assertIn(s, text)
        self.assertNotIn('1.3. ', text.replace('1.3. Управляющие', ''), 'пустой пункт пропущен — нумерация без дыр')
        self.assertEqual(len(doc.findall('.//' + W + 'tbl')), 1)
        self.assertEqual(len(doc.findall('.//' + W + 'tblHeader')), 1, 'строка заголовка повторяется на страницах')
        self.assertTrue(doc.findall('.//' + W + 'br'), 'перевод строки и разрыв страницы')
        core = self.z.read('docProps/core.xml').decode('utf-8')
        self.assertIn('ТЗ &lt;проверка&gt; &amp; «кавычки»', core)
        self.assertIn('стр.', self.z.read('word/footer1.xml').decode('utf-8'))


if __name__ == '__main__':
    unittest.main()
