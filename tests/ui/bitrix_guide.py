# -*- coding: utf-8 -*-
"""«Руководство по Битрикс24.pdf» (docs/): главы из app/web/js/features/admin/bitrix-guide-text.js и снимки пунктов
раздела «Настройки → Битрикс24» — стенд с вымышленными данными и подставным Битрикс24 (как у tests/ui/progon.py).

Запуск (из корня репозитория): python tests/ui/bitrix_guide.py
Нужен Playwright для Python и Chromium, Pillow — для сжатия снимков в JPEG.
"""
import base64
import io
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

from progon import Modes, Scenario, UiStand  # noqa: E402

PDF = os.path.join(ROOT, 'docs', 'Руководство по Битрикс24.pdf')
WIDTH = 1100
JPEG_QUALITY = 80
CSS = '''
  body { font: 11pt/1.5 'Segoe UI', Arial, sans-serif; color: #1b2433; margin: 0; }
  h1 { font-size: 22pt; color: #0b3a8a; margin: 0 0 2mm; }
  h1 small { display: block; font-size: 11pt; color: #556; font-weight: 400; margin-top: 2mm; }
  .lead { color: #334; margin: 0 0 4mm; }
  ul.toc { columns: 2; margin: 0 0 6mm; padding: 0; list-style: none; font-size: 10.5pt; }
  .bx-gch { break-before: page; }
  .bx-gch:first-of-type { break-before: auto; }
  .bx-gch h4 { font-size: 15pt; color: #0b3a8a; margin: 0 0 3mm; border-bottom: 2px solid #0b3a8a; padding-bottom: 1.5mm; }
  .bx-gch p, .bx-gch li { margin: 1.6mm 0; }
  .bx-gch ul { padding-left: 5mm; }
  figure { margin: 4mm 0 0; break-inside: avoid; }
  figure img { width: 100%; max-height: 225mm; object-fit: contain; object-position: top left; border: 1px solid #cfd6e3; border-radius: 2mm; }
  figcaption { font-size: 9pt; color: #667; margin-top: 1mm; }
  .appx { break-before: page; }
  .appx h4 { font-size: 15pt; color: #0b3a8a; margin: 0 0 3mm; }
'''


class Shots(Scenario):
    """Снимки содержимого каждого пункта раздела «Битрикс24» (без меню «Настроек»)."""

    def take(self):
        pg = self.pg
        pg.goto(self.base + '/')
        pg.wait_for_function("window.__kpExposed && Catalog.cache.length>0", timeout=60000)
        self.wait(1500)
        self.closeall()
        self._bx_connect()
        tabs = self.ev("BitrixPanel.TABS.map(t => [t[0], t[1]])")
        out = {}
        for key, label in tabs:
            if key == 'guide':
                continue
            self._bx_tab(key)
            self.wait(1200)
            png = pg.locator('#setdlg .bx-body').screenshot()
            out[key] = (label, self.jpeg(png))
        return out

    @staticmethod
    def jpeg(png):
        from PIL import Image
        im = Image.open(io.BytesIO(png)).convert('RGB')
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=JPEG_QUALITY, optimize=True)
        return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


class GuidePdf:
    """Главы руководства, после главы — снимок её пункта; в конце — снимки остальных пунктов."""

    @staticmethod
    def figure(label, src):
        return f'<figure><img src="{src}" alt=""><figcaption>«Настройки → Битрикс24 → {label}»</figcaption></figure>'

    @classmethod
    def build(cls, p, cfg, shots):
        br = p.chromium.launch(executable_path=Modes.chromium()) if Modes.chromium() else p.chromium.launch()
        pg = br.new_page()
        pg.goto('http://127.0.0.1:%d/' % cfg['port'])
        pg.wait_for_timeout(3000)
        version, chapters = pg.evaluate("""async () => {
          const help = await import('/web/js/features/help.js');
          const text = await import('/web/js/features/admin/bitrix-guide-text.js');
          const { BitrixGuide } = await import('/web/js/features/admin/bitrix-guide.js');
          return [help.APP_VERSION, text.BITRIX_GUIDE.map(ch => [ch.id, ch.title, ch.tab || '', BitrixGuide.chapter(ch, { links: false })])];
        }""")
        used, parts = set(), []
        for _id, _title, tab, html in chapters:
            figure = ''
            if tab in shots and tab not in used:
                used.add(tab)
                figure = cls.figure(*shots[tab])
            parts.append(html.replace('</section>', figure + '</section>'))
        rest = ''.join(cls.figure(*shots[key]) for key in shots if key not in used)
        toc = ''.join(f'<li>{title}</li>' for _id, title, _tab, _html in chapters)
        pg.set_content('<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>%s</style></head><body>'
                       '<h1>Как программа работает с Битрикс24<small>Конструктор КП ПНЕВМОТЕХ · руководство администратора · версия %s</small></h1>'
                       '<p class="lead">Все настройки — «Настройки → Связи → Битрикс24». Снимки — на вымышленных данных.</p>'
                       '<ul class="toc">%s</ul>%s<div class="appx"><h4>Остальные пункты раздела</h4>%s</div></body></html>'
                       % (CSS, version, toc, ''.join(parts), rest))
        pg.wait_for_timeout(1500)
        os.makedirs(os.path.dirname(PDF), exist_ok=True)
        pg.pdf(path=PDF, format='A4', print_background=True, margin={'top': '14mm', 'bottom': '14mm', 'left': '13mm', 'right': '13mm'},
               display_header_footer=True, header_template='<span></span>',
               footer_template='<div style="font-size:8px;width:100%;text-align:center;color:#888">'
                               'Руководство по Битрикс24 · стр. <span class="pageNumber"></span> из <span class="totalPages"></span></div>')
        br.close()
        print('PDF:', PDF, os.path.getsize(PDF) // 1024, 'КБ')


def main():
    from playwright.sync_api import sync_playwright
    out = tempfile.mkdtemp(prefix='kp-bxguide-')
    stand = UiStand()
    cfg = stand.start()
    try:
        with sync_playwright() as p:
            run = Shots('pc', cfg, out)
            run.open(p)
            shots = run.take()
            run.br.close()
            GuidePdf.build(p, cfg, shots)
    finally:
        stand.close()


if __name__ == '__main__':
    main()
