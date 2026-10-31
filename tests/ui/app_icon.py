"""Значки программы для экрана «Домой» (iPhone, iPad, Android): app/web/img/app-180.png, app-192.png, app-512.png —
синий квадрат во весь значок (углы скругляет сам телефон), «КП» шрифтом программы и голубая полоса снизу, как у значка
EXE (app/icon.ico). Только для разработки; запуск — после смены значка: python3 tests/ui/app_icon.py"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)


class AppIcon:
    """Рисует значок в браузере (шрифт Onest — из папки программы) и снимает PNG нужных размеров."""

    SIZES = (180, 192, 512)
    NAVY = '#0B45A0'
    SKY = '#3DA0EE'
    BAND = 0.26  # доля высоты голубой полосы — как у значка EXE
    TEXT = 0.4  # кегль «КП» от стороны значка
    OUT = os.path.join(ROOT, 'app', 'web', 'img')

    def html(self, side: int) -> str:
        with open(os.path.join(ROOT, 'app', 'web', 'vendor', 'onest-font.css'), encoding='utf-8') as css:
            font = css.read()
        top = side - round(side * self.BAND)
        return (
            f'<!doctype html><style>{font}html,body{{margin:0}}'
            f'#icon{{width:{side}px;height:{side}px;display:grid;grid-template-rows:{top}px 1fr;background:{self.SKY}}}'
            f'b{{display:grid;place-items:center;background:{self.NAVY};color:#fff;'
            f'font:700 {round(side * self.TEXT)}px/1 Onest;letter-spacing:.02em}}</style>'
            '<div id="icon"><b>КП</b><i></i></div>'
        )

    def run(self) -> None:
        from playwright.sync_api import sync_playwright
        from progon import Modes

        with sync_playwright() as play:
            browser = play.chromium.launch(executable_path=Modes.chromium() or None)
            for side in self.SIZES:
                page = browser.new_page(viewport={'width': side, 'height': side})
                page.set_content(self.html(side))
                page.evaluate('document.fonts.ready')
                path = os.path.join(self.OUT, f'app-{side}.png')
                page.locator('#icon').screenshot(path=path)
                print(path, os.path.getsize(path), 'байт')
                page.close()
            browser.close()


if __name__ == '__main__':
    AppIcon().run()
