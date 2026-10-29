# -*- coding: utf-8 -*-
"""Снимки экрана для «Руководства менеджера» (окно «?»): стенд с вымышленными данными,
путь менеджера по шагам, на снимке — красные рамки с номерами, как в тексте руководства (app/web/js/features/help.js).

Запуск (из корня репозитория): python tests/ui/guide.py [--out папка]
- снимки — app/web/img/guide/*.webp (ширина до 1200 px), сначала проверить их глазами;
Нужен Playwright для Python и Chromium (как у tests/ui/progon.py), Pillow — для рамок и сжатия.
"""
import argparse
import io
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

from progon import Modes, Scenario, UiStand  # noqa: E402

IMG = os.path.join(ROOT, 'app', 'web', 'img', 'guide')
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
RED = (220, 38, 38)
WIDTH = 1200
ME = 'mgr-ivanova'


class Marks:
    """Рамки с номерами поверх снимка (Pillow): номер — в круге у левого верхнего угла рамки."""

    @staticmethod
    def draw(png: bytes, boxes, origin=(0, 0), scale=1.0) -> bytes:
        from PIL import Image, ImageDraw, ImageFont
        im = Image.open(io.BytesIO(png)).convert('RGB')
        dr = ImageDraw.Draw(im)
        font = ImageFont.truetype(FONT, int(20 * scale))
        r = int(15 * scale)
        for n, box in boxes:
            x0 = (box['x'] - origin[0]) * scale - 4 * scale
            y0 = (box['y'] - origin[1]) * scale - 4 * scale
            x1 = x0 + (box['width'] + 8) * scale
            y1 = y0 + (box['height'] + 8) * scale
            dr.rounded_rectangle((x0, y0, x1, y1), radius=int(8 * scale), outline=RED, width=max(3, int(3 * scale)))
            cx = max(r + 2, min(im.width - r - 2, x0))
            cy = max(r + 2, min(im.height - r - 2, y0))
            dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=RED, outline=(255, 255, 255), width=max(2, int(2 * scale)))
            dr.text((cx, cy), str(n), fill=(255, 255, 255), font=font, anchor='mm')
        width = WIDTH if im.width / im.height > 1 else WIDTH // 2  # телефон — узкой картинкой
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=72, method=6)
        return out.getvalue()


class Guide(Scenario):
    """Путь менеджера для руководства: кабинет → сделки → новое КП по шагам → экономика → сохранение → журнал."""

    def __init__(self, mode, cfg, out):
        super().__init__(mode, cfg, out)
        self.missing = []

    def open(self, p):
        """Браузер с русским интерфейсом (даты в полях — ДД.ММ.ГГГГ), иначе как в прогоне."""
        exe = Modes.chromium()
        args = ['--lang=ru-RU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        self.br = p.chromium.launch(executable_path=exe, args=args) if exe else p.chromium.launch(args=args)
        self.ctx = self.br.new_context(accept_downloads=True, **Modes.ALL[self.mode])
        self.ctx.add_init_script(self.expose_script())
        self.ctx.add_init_script("try{ localStorage.setItem('kp.me','%s') }catch(e){}" % ME)
        self.pg = self.ctx.new_page()
        self.pg.on('dialog', self._dialog)
        return self.pg

    def shot(self, name, marks, root=None, wait=700):
        """Снимок окна (или элемента root) с рамками: marks — [(номер, селектор Playwright)]."""
        self.wait(wait)
        pg = self.pg
        scale = self.cfg_scale
        view = pg.viewport_size
        clip = None
        if root:
            box = pg.locator(root).first.bounding_box()
            if box:
                clip = {'x': max(0, box['x']), 'y': max(0, box['y']), 'width': box['width'], 'height': box['height']}
        png = pg.screenshot(clip=clip) if clip else pg.screenshot()
        boxes = []
        for n, sel in marks:
            loc = pg.locator(sel).first
            try:
                box = loc.bounding_box() if loc.count() and loc.is_visible() else None
            except Exception:
                box = None
            inside = box and box['y'] >= 0 and box['y'] + box['height'] <= view['height'] and box['x'] + box['width'] <= view['width']
            if inside:
                boxes.append((n, box))
            else:
                self.missing.append('%s: %d %s' % (name, n, sel))
        origin = (clip['x'], clip['y']) if clip else (0, 0)
        with open(os.path.join(IMG, name + '.webp'), 'wb') as f:
            f.write(Marks.draw(png, boxes, origin, scale))
        print('снимок', name, 'рамок', len(boxes), 'из', len(marks), flush=True)

    # --- сцены ---

    def run_guide(self):
        pg = self.pg
        pg.goto(self.base + '/')
        pg.wait_for_function("window.__kpExposed && Catalog.cache.length>0", timeout=60000)
        self.wait(1500)
        self.closeall()
        self.cabinet()
        self.new_kp()
        self.journal()
        self.find()

    def cab_tab(self, key):
        self.pg.locator('#cabWin [data-ctab="%s"]' % key).click()
        self.wait(1500)

    def cabinet(self):
        self.ev("Cabinet.open()")
        self.pg.wait_for_selector('#cabWin .cab-tabs', timeout=30000)
        self.wait(1500)
        self.cab_tab('today')
        self.shot('g01_main', [(1, '#appTabs'), (2, 'header [data-a=find]'), (3, '#btnNew'), (4, 'header .help-btn'),
                               (5, 'details.topmenu > summary')])
        self.shot('g02_today', [(1, '#cabWin nav.cab-tabs'), (2, '#cabWin .cab-kpi'), (3, '#cabWin section.md-s.td'),
                                (4, '#cabWin [data-cnew]'), (5, '#cabWin aside.td-r')])
        self.cab_tab('deals')
        if self.ev("CabDeals.view") != 'board':
            self.pg.click('#cabWin [data-cview="board"]')
            self.wait(800)
        self.shot('g03_deals', [(1, '#cabWin .cab-view'), (2, '#cabWin article.dc'), (3, '#cabWin article.dc .dc-add'),
                                (4, '#cabWin .cab-cnts')])
        self.pg.locator('#cabWin article.dc').first.click()
        self.pg.wait_for_selector('dialog.deal-dlg[open]', timeout=20000)
        self.shot('g04_deal_card', [(1, 'dialog.deal-dlg .dk-st'), (2, 'dialog.deal-dlg .dk-won'),
                                    (3, 'dialog.deal-dlg button:has-text("Звонок или дело")'),
                                    (4, 'dialog.deal-dlg button:has-text("Комментарий")'),
                                    (5, 'dialog.deal-dlg :text("КП по сделке")')], wait=1500)
        self.closeall()

    def new_kp(self):
        pg = self.pg
        pg.click('#btnNew')
        self.wait(2000)
        self.closeall()
        self.go('client')
        self.shot('g05_client_empty', [(1, 'nav.stepper'), (2, '#clFind'), (3, '#side .total'), (4, '#side [data-a=download]')])
        pg.click('#clFind')
        pg.keyboard.type('ООО', delay=40)
        self.wait(1200)
        pg.locator('#clList [data-clid], #clList [data-inn]').first.click()
        self.wait(1500)
        self.fill_empty((('contact.name', 'Петров Пётр Сергеевич'), ('contact.phone', '+7 900 111-22-33')))
        self.wait(4000)
        self.shot('g06_client', [(1, '#form .cl-card'), (2, '#form [data-a=checkRun]'), (3, '#form [data-cc]'),
                                 (4, '#form [data-p="contact.name"]')])
        self.go('equip')
        self.shot('g07_equip_empty', [(1, '#form section#st-items')])
        if pg.locator('#form [data-a=openCatalog]').count():
            pg.locator('#form [data-a=openCatalog]').first.click()
        else:
            self.ev("CatalogWindow.open({})")
        pg.wait_for_selector('#cwList .cw-row', timeout=20000)
        pg.fill('#cwQ', 'компрессор')
        self.wait(1300)
        pg.locator('#cwList .cw-row').first.click()
        self.wait(1200)
        self.shot('g07_catalog', [(1, '#cwQ'), (2, '#cwBar'), (3, '#cwList .cw-row [data-add]'), (4, '#catdlg [data-cw=done]')])
        self._add_found('компрессор', 1)
        self._add_found('осушитель', 1)
        pg.click('#catdlg [data-cw=done]')
        self.wait(1500)
        self.go('equip')
        self.shot('g08_equip', [(1, '#form [data-a=openCatalog]'), (2, '#form [data-a=addItem]'), (3, '#form [data-a=addStation]'),
                                (4, '#form .item .ifoot [data-a=edit]'), (5, '#form .item [data-qty], #form .item .qty')])
        self.go('price')
        for i in range(self.ev("S.items.length")):
            loc = self.visible('[data-price="%d"]' % i)
            if loc and not (loc.input_value() or '').strip():
                loc.fill(str(1500000 + i * 300000))
                pg.keyboard.press('Tab')
        self.shot('g09_price', [(1, '#form .curbar'), (2, '#form .prow .pprice'), (3, '#form .prow .pdisc'), (4, '#form button.dl-cta')])
        self.econ()
        self.go('cover')
        self.shot('g11_cover', [(1, '#form section.step')])
        self.go('conds')
        for inp in pg.locator('#form input[data-p^="cond"], #form textarea[data-p^="cond"]').all()[:3]:
            try:
                if inp.is_visible() and not inp.input_value():
                    inp.fill('По согласованию')
            except Exception:
                pass
        self.shot('g12_conds', [(1, '#form section#st-conds .grid'), (2, '#form section#st-conds .pickm > summary')])
        self.go('mgr')
        self.shot('g13_mgr', [(1, '#form .mgrbar')])
        self.save()

    def econ(self):
        pg = self.pg
        self.ev("S.items.forEach(it=>{ it.cost=Math.round(Number(it.price)*0.6); it.costCur='RUB'; }); FormView.render()")
        pg.locator('#form button.dl-cta').first.click()
        pg.wait_for_selector('#dealdlg[open]', timeout=20000)
        self.wait(2500)
        self.shot('g10_econ', [(1, '#dealdlg nav.dl-tabs'), (2, '#dealdlg .dl-hd'), (3, '#dealdlg .dl-price'),
                               (4, '#dealdlg .dl-big'), (5, '#dealdlg [data-dlx=xlsx]')], wait=1000)
        self.closeall()

    def save(self):
        pg = self.pg
        self.go('client')
        self.ev("document.querySelectorAll('#form details').forEach(d=>d.open=true)")
        self.fill_empty((('contact.name', 'Петров Пётр Сергеевич'), ('contact.phone', '+7 900 111-22-33'),
                         ('contact.email', 'petrov@example.com')))
        self.go('mgr')
        self.ev("document.querySelectorAll('#form details').forEach(d=>d.open=true)")
        self.fill_empty((('manager.phone', '+7 900 000-00-00'), ('manager.email', 'ivanova@example.com')))
        self.ev("FormView.render()")
        self.go('mgr')
        b = pg.locator('#side [data-a=download]').first
        if b.is_disabled():
            print('не сохранить:', self.ev("Problems.list().map(p=>p[0])"))
            return
        b.click()
        self.wait(9000)
        d = self.topdlg()
        if d:
            self.shot('g14_saved', [(1, d + ' [data-a=openDoc]'), (2, d + ' [data-a=mailKp]')], root=d)
            self.closeall()

    def journal(self):
        self.ev("AppTabs.open('jrn')")
        self.wait(2500)
        self.shot('g15_journal', [(1, '#jrnWin .jbar input'), (2, '#jrnWin #jQk'), (3, '#jList [data-jo]'),
                                  (4, '#jList details.jr-more > summary')])

    def find(self):
        pg = self.pg
        pg.click('header [data-a=find]')
        self.wait(800)
        pg.keyboard.type('Пример', delay=40)
        self.wait(1500)
        d = self.topdlg()
        self.shot('g16_find', [(1, (d or 'dialog[open]') + ' input')], root=d)
        self.closeall()


class PhoneGuide(Guide):
    def run_guide(self):
        pg = self.pg
        pg.goto(self.base + '/')
        pg.wait_for_function("window.__kpExposed && Catalog.cache.length>0", timeout=60000)
        self.wait(2000)
        self.closeall()
        self.ev("Cabinet.open()")
        self.wait(2500)
        self.shot('g17_phone', [(1, '#appTabs'), (2, '#appTabs [data-tab=more], #appTabs button:last-child')])


def main():
    from playwright.sync_api import sync_playwright
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='')
    args = ap.parse_args()
    out = args.out or tempfile.mkdtemp(prefix='kp-guide-')
    os.makedirs(IMG, exist_ok=True)
    stand = UiStand()
    cfg = stand.start()
    try:
        with sync_playwright() as p:
            missing = []
            for cls, mode in ((Guide, 'pc'), (PhoneGuide, 'ph')):
                run = cls(mode, cfg, out)
                run.cfg_scale = Modes.ALL[mode].get('device_scale_factor', 1)
                run.open(p)
                run.run_guide()
                missing += run.missing
                run.br.close()
    finally:
        stand.close()
        stand.st.stop()
    print('не найдено рамок:', len(missing))
    for row in missing:
        print('  ', row)


if __name__ == '__main__':
    main()
