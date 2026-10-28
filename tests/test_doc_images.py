# -*- coding: utf-8 -*-
"""Картинки из файла для заполнения карточки с ИИ (3.222.0, doc_images.DocImages, /api/fileimages): PDF (JPEG и сжатые
RGB), Word и Excel (media), мелкие и повторы отсекаются, выключатель aiFileImages; опции и комплектация из ответа ИИ —
tests/js/ai_options.js. Вымышленные данные."""
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import unittest
import zipfile
import zlib

from kit import REPO, Stand

sys.path.insert(0, os.path.join(REPO, 'app'))
from doc_images import DocImages  # noqa: E402

OPTS = {'minKB': 15, 'minPx': 200, 'skipBlank': True, 'maxCount': 12}


def noise(size):
    """Псевдослучайные байты — несжимаемая «фотография»."""
    out, x = bytearray(), 12345
    for _ in range(size):
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        out.append(x >> 16 & 255)
    return bytes(out)


def png(width, height, seed=0):
    return DocImages._png(noise(width * height * 3 + seed)[seed:], width, height, 3)


def jpeg(width, height):
    """Заголовок JPEG с размерами (SOF0) и «данными» — для разбора размеров хватает."""
    sof = b'\xff\xc0' + struct.pack('>HBHHB', 17, 8, height, width, 3) + b'\x01\x22\x00\x02\x11\x01\x03\x11\x01'
    return b'\xff\xd8' + sof + noise(40000) + b'\xff\xd9'


def pdf(images):
    """PDF из одной страницы с картинками-XObject: [(dict, stream)]."""
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>']
    names = ' '.join(f'/Im{k} {4 + k} 0 R' for k in range(len(images)))
    objs.append(b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    objs.append(f'<< /Type /Page /Parent 2 0 R /Resources << /XObject << {names} >> >> >>'.encode())
    for head, body in images:
        objs.append(head.encode() + f' /Length {len(body)} >>\nstream\n'.encode() + body + b'\nendstream')
    out = b'%PDF-1.4\n'
    for num, obj in enumerate(objs, 1):
        out += f'{num} 0 obj\n'.encode() + obj + b'\nendobj\n'
    return out + b'trailer\n<< /Root 1 0 R >>\n%%EOF'


class DocImagesTest(unittest.TestCase):
    def test_pdf_jpeg_and_rgb(self):
        raw = noise(300 * 300 * 3)
        data = pdf([
            ('<< /Type /XObject /Subtype /Image /Width 300 /Height 300 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode', jpeg(300, 300)),
            ('<< /Type /XObject /Subtype /Image /Width 300 /Height 300 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode', zlib.compress(raw)),
            ('<< /Type /XObject /Subtype /Image /Width 40 /Height 40 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode', zlib.compress(noise(4800))),
        ])
        out = DocImages.extract('kp.pdf', data, OPTS)
        kinds = [pic['src'].split(';')[0] for pic in out['imgs']]
        self.assertEqual(kinds, ['data:image/jpeg', 'data:image/png'], 'мелкая 40×40 — отсечена')
        self.assertEqual((out['imgs'][1]['w'], out['imgs'][1]['h']), (300, 300))
        self.assertEqual(out['skipped'], 1)

    def test_word_and_excel_media(self):
        for name, folder in (('pasport.docx', 'word'), ('kp.xlsx', 'xl')):
            box = io.BytesIO()
            with zipfile.ZipFile(box, 'w') as z:
                z.writestr(f'{folder}/media/image1.png', png(320, 240))
                z.writestr(f'{folder}/media/image2.png', png(320, 240))  # та же картинка — повтор
                z.writestr(f'{folder}/media/logo.png', png(60, 30, 7))
                z.writestr(f'{folder}/media/image3.emf', b'x' * 50000)
            with self.subTest(name):
                out = DocImages.extract(name, box.getvalue(), OPTS)
                self.assertEqual(len(out['imgs']), 1, 'повтор и мелкий логотип — нет, emf — не картинка браузера')

    def test_limit_and_other_files(self):
        box = io.BytesIO()
        with zipfile.ZipFile(box, 'w') as z:
            for k in range(5):
                z.writestr(f'word/media/image{k}.png', png(300, 210 + k))
        self.assertEqual(len(DocImages.extract('a.docx', box.getvalue(), dict(OPTS, maxCount=3))['imgs']), 3)
        self.assertEqual(DocImages.extract('a.txt', b'text', OPTS)['imgs'], [])
        self.assertEqual(DocImages.extract('bad.pdf', b'%PDF-1.4 broken', OPTS)['imgs'], [])


class FileImagesRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stand = Stand().start()

    @classmethod
    def tearDownClass(cls):
        cls.stand.close()

    def post(self, path, body):
        return self.stand.http.req('POST', path, body, headers={'Content-Type': 'application/octet-stream'})

    def test_route_and_switch(self):
        box = io.BytesIO()
        with zipfile.ZipFile(box, 'w') as z:
            z.writestr('xl/media/image1.png', png(320, 240))
            z.writestr('xl/workbook.xml', '<workbook/>')
            z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                       '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>')
            z.writestr('xl/sharedStrings.xml', '<sst><si><t>Шеф-монтаж и пусконаладка компрессорной станции, комплект ЗИП на два года</t></si></sst>')
        st, body, _ = self.post('/api/fileimages?name=kp.xlsx&text=1', box.getvalue())
        self.assertEqual(st, 200, body)
        got = json.loads(body)
        self.assertEqual(len(got['imgs']), 1)
        self.assertIn('Шеф-монтаж', got.get('text', ''), got.get('error'))
        adm, csrf = self.stand.admin()
        st, b, _ = self.stand.http.req('POST', '/api/admin/features', {'values': {'aiFileImages': {'on': False}}},
                                       cookie=adm, headers=csrf)
        self.assertEqual(st, 200, b)
        self.assertEqual(self.post('/api/fileimages?name=kp.xlsx', box.getvalue())[0], 403, 'выключено — закрыто')


class AiOptionsJsTest(unittest.TestCase):
    def test_node(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'ai_options.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=120)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


if __name__ == '__main__':
    unittest.main()
