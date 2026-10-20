# -*- coding: utf-8 -*-
"""Прогон интерфейса в браузере: весь путь менеджера и администратора на ПК и телефоне, в светлой и тёмной теме.

Запуск (из корня репозитория): python tests/ui/progon.py [--modes pc,pcd,ph,phd] [--stages client,cat,...] [--out папка]
    [--db копия.sqlite3]

- Стенд — программа во временной папке (tests/kit.py, Stand) с вымышленными данными (SampleData): рабочая база не
  используется. --db — КОПИЯ базы (например, выгрузка владельца) для прогона на настоящем каталоге; файл копируется в
  стенд, учётные записи администратора в копии сбрасываются на стендовые. Копию не класть в репозиторий.
- Режимы: pc — ПК 1440×900, pcd — ПК 1366×768 тёмная, ph — телефон 430×932 (iPhone 16 Pro Max), phd — телефон тёмная.
  Режимы идут параллельно (отдельный процесс на режим), этапы внутри режима — по порядку (как работает менеджер).
- На каждом снимке — проверки check.js: выход за край окна, текст не влезает в кнопку, наложение кнопок, контраст,
  обрезанные картинки, на телефоне — области нажатия меньше 44 px и шрифт полей меньше 16 px (iOS увеличивает страницу).
- Итог: <out>/report.txt (сводка по режимам), <out>/res_<режим>.json (всё найденное), <out>/shots/<режим>/*.png.
  Код выхода 1 — сбой сценария или ошибка JavaScript на странице.

Нужен Playwright для Python (pip install playwright) и Chromium: KP_CHROMIUM=путь, иначе — из /opt/pw-browsers, иначе
браузер Playwright по умолчанию.
"""
import argparse
import collections
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))


class Modes:
    IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
              'Version/18.0 Mobile/15E148 Safari/604.1')
    BASE = {'locale': 'ru-RU', 'timezone_id': 'Europe/Moscow'}
    ALL = {'pc': dict(BASE, viewport={'width': 1440, 'height': 900}, color_scheme='light'),
           'pcd': dict(BASE, viewport={'width': 1366, 'height': 768}, color_scheme='dark'),
           'ph': dict(BASE, viewport={'width': 430, 'height': 932}, color_scheme='light', is_mobile=True, has_touch=True,
                      device_scale_factor=3, user_agent=IPHONE),
           'phd': dict(BASE, viewport={'width': 430, 'height': 932}, color_scheme='dark', is_mobile=True, has_touch=True,
                       device_scale_factor=3, user_agent=IPHONE)}
    STAGES = ('client', 'cat', 'editor', 'station', 'price', 'deal', 'steps', 'preview', 'save', 'files', 'mail',
              'journal', 'misc', 'cabinet', 'settings', 'bitrix', 'mirror', 'dbl')

    @staticmethod
    def chromium():
        p = os.environ.get('KP_CHROMIUM')
        if p and os.path.isfile(p):
            return p
        found = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome'))
        return found[-1] if found else None


class UiStand:
    """Сервер программы для прогона: вымышленные данные или копия базы (--db)."""

    @staticmethod
    def png(path, w=160, h=80):
        """Картинка PNG для загрузки (рисунок заказчика): синий прямоугольник с жёлтой полосой на прозрачном поле."""
        import struct
        import zlib
        rows = b''.join(b'\x00' + b''.join((b'\xf0\xc0\x20\xff' if h // 3 <= y < 2 * h // 3 else b'\x1e\x4d\x8c\xff') if 8 <= x < w - 8 else b'\x00\x00\x00\x00'
                                         for x in range(w)) for y in range(h))
        ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        with open(path, 'wb') as f:
            f.write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(rows)) + ch(b'IEND', b''))
        return path

    def __init__(self, db=None):
        from kit import SampleData, Stand
        self.st = Stand(mode='server', sample=None if db else SampleData())
        if db:
            os.makedirs(self.st.data, exist_ok=True)
            with open(db, 'rb') as src, open(self.st.db, 'wb') as dst:
                dst.write(src.read())
            c = sqlite3.connect(self.st.db)
            c.execute("DELETE FROM kv WHERE key IN ('admin', 'admins')")
            c.commit()
            c.close()

    def start(self):
        from bitrix_fake import FakeBitrix
        self.st.start(timeout=240)
        self.st.admin()
        self.bx = FakeBitrix()                  # подставной Битрикс24 — для этапа «bitrix» (вкладки связи в «Настройках»)
        self.seed(self.bx)
        return {'port': self.st.http.port, 'admin': list(self.st.ADMIN), 'bitrix': self.bx.url}

    @staticmethod
    def seed(fake):
        """Подставной портал для этапа «mirror»: стадия провала, поля сделки, сделки двух воронок, дело (вымышленные)."""
        fake.stages['DEAL_STAGE_3'].insert(5, ('C3:PRICE', 'Высокая цена', 'F'))
        fake.portal_fields = [
            {'FIELD_NAME': 'UF_CRM_REGION', 'USER_TYPE_ID': 'enumeration', 'L': 'Регион1',
             'ITEMS': [{'ID': '10', 'VALUE': 'Москва'}, {'ID': '11', 'VALUE': 'Казань'}, {'ID': '12', 'VALUE': 'Пермь'}]},
            {'FIELD_NAME': 'UF_CRM_TOPIC', 'USER_TYPE_ID': 'string', 'L': 'Тема запроса'},
            {'FIELD_NAME': 'UF_CRM_INVOICE', 'USER_TYPE_ID': 'double', 'L': 'Сумма счета / ТКП'},
            {'FIELD_NAME': 'UF_CRM_PAID', 'USER_TYPE_ID': 'date', 'L': 'Дата оплаты'},
            {'FIELD_NAME': 'UF_CRM_NOTE', 'USER_TYPE_ID': 'string', 'L': 'Рабочий комментарий к сделке писать СЮДА!'},
        ]
        for i, stage in enumerate(('C3:NEW', 'C3:NEW', 'C3:PREPARATION', 'C3:EXECUTING', 'C3:FINAL_INVOICE', 'C3:PRICE', 'C3:WON')):
            fake.new_deal(TITLE=f'Компрессорная станция, объект {i + 1}', STAGE_ID=stage, CLOSED='Y' if stage in ('C3:PRICE', 'C3:WON') else 'N',
                          OPPORTUNITY=str(1500000 + i * 250000), UF_CRM_REGION=str(10 + i % 3), UF_CRM_TOPIC='Подбор компрессора',
                          UF_CRM_INVOICE=str(1200000 + i * 100000), UF_CRM_NOTE='Перезвонить главному инженеру' if i % 2 else '')
        for i in range(3):
            fake.new_deal(TITLE=f'Обращение с сайта {i + 1}', CATEGORY_ID='0', STAGE_ID='NEW', CLOSED='N', UF_CRM_TOPIC='Запчасти')

    def close(self):
        if getattr(self, 'bx', None):
            self.bx.stop()
        self.st.close()


class UiRun:
    """Браузер одного режима: снимки с проверками, сбор ошибок страницы, этапы."""
    IGN_CONSOLE = ('favicon',)

    def __init__(self, mode, cfg, out):
        self.mode, self.cfg, self.out = mode, cfg, out
        self.base = 'http://127.0.0.1:%d' % cfg['port']
        self.phone = mode.startswith('ph')
        self.res, self.errs, self.log, self.dialogs = {}, [], [], []
        self.cur = 'start'
        self.shots = os.path.join(out, 'shots', mode)
        os.makedirs(self.shots, exist_ok=True)
        with open(os.path.join(HERE, 'check.js'), encoding='utf-8') as f:
            self.check = f.read()

    def open(self, p):
        exe = Modes.chromium()
        gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']   # WebGL2 программно — 3D-вид станции, как у менеджера
        self.br = p.chromium.launch(executable_path=exe, args=gl) if exe else p.chromium.launch(args=gl)
        self.ctx = self.br.new_context(accept_downloads=True, **Modes.ALL[self.mode])
        if self.mode == 'phd':
            self.ctx.add_init_script("try{ if(!localStorage.getItem('kp.theme')) localStorage.setItem('kp.theme','dark') }catch(e){}")
        pg = self.pg = self.ctx.new_page()
        pg.on('pageerror', lambda e: self.errs.append((self.cur, 'pageerror', str(e)[:400])))
        pg.on('console', self._console)
        pg.on('response', lambda r: self.errs.append((self.cur, 'http %d' % r.status, r.request.method + ' ' + r.url.replace(self.base, '')[:200]))
              if r.status >= 400 else None)
        pg.on('dialog', self._dialog)
        return pg

    def _console(self, m):
        if m.type in ('error', 'warning') and not any(x in m.text for x in self.IGN_CONSOLE):
            self.errs.append((self.cur, 'console.' + m.type, m.text[:400]))

    def _dialog(self, d):
        self.dialogs.append((self.cur, d.type, d.message[:200]))
        try:
            d.accept('' if d.type == 'prompt' else None) if d.type == 'prompt' else d.accept()
        except Exception:
            pass

    def ev(self, js, arg=None):
        return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def snap(self, name, root=None, full=False, wait=500):
        self.wait(wait)
        try:
            r = self.pg.evaluate(self.check, {'phone': self.phone, 'root': root})
        except Exception as e:
            r = {'err': str(e)[:200]}
        fn = os.path.join(self.shots, name + '.png')
        try:
            if full and self.phone:
                self._phone_full(fn)
            else:
                self.pg.screenshot(path=fn, full_page=full)
        except Exception as e:
            r['shotErr'] = str(e)[:100]
        r['shot'] = fn
        self.res[name] = r
        self.log.append('snap ' + name)
        return r

    def _phone_full(self, fn):
        # на телефоне full_page сбрасывает эмуляцию касаний (pointer:coarse) — снимаем экранами с прокруткой
        h, vh, y0 = self.ev("document.scrollingElement.scrollHeight"), self.ev("innerHeight"), self.ev("scrollY")
        for k, y in enumerate(range(0, min(h, vh * 4), vh)):
            self.ev("window.scrollTo(0,%d)" % y)
            self.wait(250)
            self.pg.screenshot(path=fn if k == 0 else fn.replace('.png', '_%d.png' % k))
        self.ev("window.scrollTo(0,%d)" % y0)

    def stage(self, name, fn):
        self.cur, t = name, time.time()
        try:
            if self.ev("document.querySelectorAll('dialog[open]').length"):
                self.errs.append((name, 'NOTE', 'перед этапом было открыто окно: %s' % self.ev(
                    "[...document.querySelectorAll('dialog[open]')].map(d=>d.id||d.className)")))
            self.closeall()
        except Exception:
            pass
        try:
            fn()
        except Exception as e:
            self.errs.append((name, 'SCRIPT', repr(e)[:1500]))
            try:
                self.pg.screenshot(path=os.path.join(self.shots, 'ERR_%s.png' % name))
            except Exception:
                pass
        self.log.append('%s %.1fs' % (name, time.time() - t))

    def closeall(self):
        self.pg.keyboard.press('Escape')
        self.wait(150)
        self.ev("document.querySelectorAll('dialog[open]').forEach(d=>d.close())")

    def topdlg(self):
        return self.ev("(()=>{const d=[...document.querySelectorAll('dialog[open]')].pop(); if(!d) return null; "
                       "if(!d.id) d.id='__d'+Math.random().toString(36).slice(2,7); return '#'+d.id})()")

    def meta(self):
        return self.res.setdefault('meta', {})

    def save(self):
        with open(os.path.join(self.out, 'res_%s.json' % self.mode), 'w', encoding='utf-8') as f:
            json.dump({'res': self.res, 'errs': self.errs, 'dialogs': self.dialogs, 'log': self.log}, f, ensure_ascii=False, indent=1)


class Scenario(UiRun):
    """Путь менеджера: клиент → каталог → карточка → станция → цены → экономика сделки → оформление → сохранение КП →
    файлы и письмо → журнал → прочие окна → «Настройки» администратора → двойные щелчки."""

    def go(self, step):
        if self.phone:
            self.pg.locator('#mbar').wait_for()
        self.ev("goStep('%s')" % step)
        self.wait(500)
        self.ev("window.scrollTo(0,0)")

    def visible(self, sel):
        loc = self.pg.locator(sel).first
        return loc if loc.count() and loc.is_visible() else None

    def fill_empty(self, pairs):
        for k, v in pairs:
            loc = self.visible('#form [data-p="%s"]' % k)
            if loc and not loc.input_value():
                loc.fill(v)

    def dlg_list(self):
        return self.ev("[...document.querySelectorAll('dialog[open]')].map(d=>(d.id||d.className)+':'+d.innerText.trim().length)")

    def run(self, stages):
        pg = self.pg
        pg.goto(self.base + '/')
        pg.wait_for_function("typeof catCache!=='undefined' && catCache.length>0", timeout=60000)
        self.wait(1500)
        self.stage('first', self.s_first)
        for name in Modes.STAGES:
            if not stages or name in stages:
                self.stage(name, getattr(self, 's_' + name))
        self.save()
        self.br.close()

    def s_first(self):
        self.snap('00_first', self.topdlg())
        self.closeall()
        self.snap('01_main', None, full=True)

    def s_client(self):
        pg = self.pg
        self.go('client')
        pg.click('#clFind')
        pg.keyboard.type('ООО', delay=40)
        self.wait(1200)
        self.snap('10_client_find')
        pg.locator('#clList [data-clid], #clList [data-inn]').first.click()
        self.wait(1500)
        self.snap('11_client_set', None, full=True)
        b = pg.locator('[data-cc]').first
        if b.count():
            b.click()
        else:
            self.ev("ClientCard.open({inn:S.clientInn,name:S.client,id:S.clientId})")
        self.wait(1500)
        self.snap('12_client_card', self.topdlg())
        self.closeall()

    def s_cat(self):
        pg = self.pg
        self.go('equip')
        self.snap('20_equip_empty', None, full=True)
        if pg.locator('#form [data-a=openCatalog]').count():
            pg.locator('#form [data-a=openCatalog]').first.click()
        else:
            self.ev("openCatalog({})")
        pg.wait_for_selector('#cwList .cw-row', timeout=20000)
        self.snap('21_cat_open', '#catdlg')
        pg.fill('#cwQ', 'компрессор винтовой')
        self.wait(1200)
        self.snap('22_cat_search', '#catdlg')
        opts = self.ev("[...document.querySelectorAll('#cwSort option')].map(o=>o.value)")
        for v in opts[:12]:
            pg.select_option('#cwSort', v)
            self.wait(300)
        pg.select_option('#cwSort', opts[1] if len(opts) > 1 else opts[0])
        pg.click('#cwDir')
        self.snap('23_cat_sort', '#catdlg', wait=400)
        pg.fill('#cwQ', '')
        self.wait(800)
        if self.phone:
            pg.click('#catdlg [data-cw=nav]')
            self.snap('24_cat_filters', '#catdlg', wait=600)
        c = pg.locator('#cwNav [data-cwcat], #cwNav .cw-cat:not(.add)').first
        if c.count():
            c.click()
            self.wait(900)
        self.snap('24b_cat_category', '#catdlg')
        for cb in ('#cwPriced', '#cwStock'):
            if self.visible(cb):
                pg.click(cb)
                self.wait(600)
        if self.phone and self.visible('#cwNavOk'):
            pg.click('#cwNavOk')
            self.wait(500)
        self.snap('25_cat_filtered', '#catdlg')
        rb = self.visible('#catdlg .cw-reset, #catdlg [data-cw=resetall], #catdlg [data-cw=reset]')
        if rb:
            rb.click()
            self.wait(600)
        pg.fill('#cwQ', 'компрессор')
        self.wait(1200)
        pg.locator('#cwList .cw-row').first.click()
        self.snap('26_cat_preview', '#catdlg', wait=1200)
        if self.phone and self.visible('#cwPv .pv-back'):
            pg.click('#cwPv .pv-back')
            self.wait(800)
        row = self.visible('#cwList .cw-row')
        if row:
            row.dblclick(timeout=8000)
            self.wait(1200)
        self.meta()['dbl_editor_open'] = self.ev("!!document.querySelector('#edlg[open]')")
        self.snap('27_cat_dblclick', self.topdlg())
        pg.keyboard.press('Escape')
        self.wait(500)
        if not self.ev("!!document.querySelector('#catdlg[open]')"):
            self.ev("openCatalog({})")
            self.wait(1500)
        pr = self.visible('#cwPriced')
        if pr and not pr.is_checked():
            pr.click()
            self.wait(600)
        self._add_found('компрессор', 2)
        self._add_found('осушитель', 1)
        self.snap('28_cat_added', '#catdlg')
        pg.click('#catdlg [data-cw=done]')
        self.wait(1500)
        self.snap('29_equip_filled', None, full=True)

    def _add_found(self, q, n):
        self.pg.fill('#cwQ', q)
        self.wait(1200)
        added, rows = 0, self.pg.locator('#cwList .cw-row [data-add]')
        for k in range(rows.count()):
            if added >= n:
                break
            if rows.nth(k).is_visible():
                rows.nth(k).click()
                self.wait(900)
                added += 1

    def _tabs(self, key, prefix, wait):
        tabs = self.ev("[...document.querySelectorAll('#edlg [data-edtab]')].map(b=>b.dataset.edtab)")
        self.meta()[key] = tabs
        for t in tabs:
            self.pg.click('#edlg [data-edtab=%s]' % t)
            self.wait(wait)
            self.snap(prefix + t, '#edlg', wait=300)
        return tabs

    def s_editor(self):
        self.go('equip')
        self.pg.locator('#form button.btn[data-a=edit]').first.click()
        self.pg.wait_for_selector('#edlg[open]')
        self.wait(800)
        self._tabs('ed_tabs', '30_editor_', 400)
        self.closeall()

    def s_station(self):
        pg = self.pg
        self.go('equip')
        pg.locator('#form [data-a=addItem]').first.click()
        pg.wait_for_selector('#dlg[open]')
        self.snap('40_add_equip', '#dlg')
        st = pg.locator('#dlg [data-nwcat=station], #dlg [data-nwmain]').first
        if pg.locator('#dlg [data-nwcat=st_comp]').count() == 0 and st.count():
            st.click()
            self.wait(500)
        self.snap('41_add_station_kind', '#dlg')
        pg.click('#dlg [data-nwcat=st_comp]')
        self.snap('42_station_form', '#dlg', wait=600)
        pg.fill('#dlg [data-nsr=flow]', '10')
        pg.fill('#dlg [data-nsr=pressure]', '8')
        pg.wait_for_function("!document.querySelector('#nsPv .ns-pv-w') && document.querySelector('#nsPv').innerText.length>5", timeout=60000)
        self.snap('43_station_preview', '#dlg', wait=1500)
        pg.click('#dlg [data-nw=nsPick]')
        pg.wait_for_function("!document.querySelector('#dlg[open].nw')", timeout=60000)
        self.snap('44_equip_with_station', None, full=True, wait=2000)
        self.closeall()      # после подбора программа сама открывает карточку станции — открываем заново, как менеджер
        n = self.ev("S.items.length") - 1
        pg.locator('#form button.btn[data-a=edit][data-i="%d"]' % n).first.click()
        pg.wait_for_selector('#edlg[open]')
        self.wait(1500)
        tabs = self._tabs('st_tabs', '45_st_', 2500)
        self._paint(tabs)
        if 'layout' in tabs:
            self._layout_views()
            self._mods()
        self.closeall()

    def _paint(self, tabs):
        """Окраска контейнера (19.10): окна частей, «по буклету заказчика», рисунок заказчика на стене."""
        pg = self.pg
        for t in tabs:
            pg.click('#edlg [data-edtab=%s]' % t)
            self.wait(400)
            if pg.locator('#edlg details.kc-more').count():
                break
        else:
            self.errs.append(('station', 'SCRIPT-paint', 'нет блока «Крыша, пол, окраска»'))
            return
        self.ev("document.querySelector('#edlg details.kc-more').open=true")
        for k, v in (('roof', 'RAL 9006'), ('door', 'RAL 3020')):
            pg.fill('#edlg [data-kitpaint][data-k=%s]' % k, v)
            pg.press('#edlg [data-kitpaint][data-k=%s]' % k, 'Tab')
            self.wait(400)
        self.ev("document.querySelector('#edlg details.kc-more').open=true")
        pg.click('#edlg [data-kitbook]')
        self.wait(400)
        self.ev("document.querySelector('#edlg details.kc-more').open=true")
        with pg.expect_file_chooser() as fc:
            pg.click('#edlg [data-a=paintArt]')
        fc.value.set_files(UiStand.png(os.path.join(self.out, 'art.png')))
        pg.wait_for_selector('#edlg .kc-art img', timeout=20000)
        self.ev("document.querySelector('#edlg details.kc-more').open=true")
        pg.select_option('#edlg .kc-art select[data-k=wall]', 'left')
        self.wait(600)
        self.ev("document.querySelector('#edlg details.kc-more').open=true")
        row = self.ev("(Kit.container(S.items[S.items.length-1])||{}).rows.find(r=>r.k==='Окраска')?.v||''")
        if 'RAL 9006' not in row and 'буклет' not in row:
            self.errs.append(('station', 'paint', 'строка «Окраска»: ' + row))
        self.snap('45p_st_paint', '#edlg .kc-more', wait=500)
        if 'layout' in tabs:      # 3D и виды снаружи — с новыми цветами и рисунком (картинки пересобираются)
            pg.click('#edlg [data-edtab=layout]')
            self.snap('45q_st_paint_layout', '#edlg', wait=8000)
            # вид слева снаружи (WebGL, программно — долго): рисунок заказчика на левом торце, крыша и двери своим цветом
            src = pg.evaluate("async()=>{ const x=S.items[S.items.length-1], plan=StationUi.plan(x), meta=StationUi.meta(x, plan);"
                              " if (!StationRender.ok()) return 'skip'; const im=await StationRender.image(plan, meta, 'out', 72); return im ? im.src : 'ERR '+(StationRender.lastErr||''); }")
            if src.startswith('data:image/jpeg;base64,'):
                import base64
                with open(os.path.join(self.shots, '45r_st_paint_left.jpg'), 'wb') as f:
                    f.write(base64.b64decode(src.split(',', 1)[1]))
            elif src != 'skip':
                self.errs.append(('station', 'paint-3d', src[:150]))

    def _mods(self):
        """Станция из модулей (19.10): окно «Модули…» — варианты с расчётом, перенос модуля на сетке (мышью, на телефоне —
        нажать модуль, затем клетку), подтверждение; в составе — контейнер × N и «Стыковка модулей»; затем — обратно в один."""
        pg = self.pg
        pg.click('#edlg [data-edtab=layout]')
        self.wait(800)
        if not pg.locator('#edlg [data-a=stlMods]').count():
            self.errs.append(('station', 'SCRIPT-mods', 'нет кнопки «Модули…»'))
            return
        pg.click('#edlg [data-a=stlMods]')
        pg.wait_for_selector('dialog.md-dlg[open] .md-grid', timeout=20000)
        pg.wait_for_function("!document.querySelector('dialog.md-dlg[open]').innerText.includes('считаю')", timeout=120000)
        self.snap('47_st_mods', 'dialog.md-dlg[open]', wait=300)
        # перенос модуля М2 в свободную клетку
        if self.phone:
            pg.click('dialog.md-dlg .md-cell.on >> nth=1')
            pg.click('dialog.md-dlg .md-cell:not(.on) >> nth=0')
        else:
            src = pg.locator('dialog.md-dlg .md-mod').nth(1).bounding_box()
            dst = pg.locator('dialog.md-dlg .md-cell:not(.on)').first.bounding_box()
            pg.mouse.move(src['x'] + src['width'] / 2, src['y'] + src['height'] / 2)
            pg.mouse.down()
            pg.mouse.move(dst['x'] + 5, dst['y'] + 5, steps=8)
            pg.mouse.move(dst['x'] + dst['width'] / 2, dst['y'] + dst['height'] / 2, steps=4)
            pg.mouse.up()
        self.wait(300)
        self.snap('47b_st_mods_moved', 'dialog.md-dlg[open]', wait=300)
        pg.click('dialog.md-dlg [data-va="1"][data-vb="2"]')   # бок о бок
        pg.wait_for_function("!document.querySelector('dialog.md-dlg[open]').innerText.includes('считаю')", timeout=120000)
        if pg.locator('dialog.md-dlg [data-md=apply][disabled]').count():
            self.errs.append(('station', 'mods', 'бок о бок — не помещается: ' + pg.locator('dialog.md-dlg .md-st').inner_text()[:150]))
            pg.click('dialog.md-dlg [data-x]')
            return
        pg.click('dialog.md-dlg [data-md=apply]')
        yes = 'dialog[open] button[data-v="1"]:has-text("Да, из модулей")'   # кнопка вопроса, не кнопка вида в окне станции
        pg.wait_for_selector(yes)
        self.snap('47c_st_mods_ask', 'dialog.st-confirm[open]:not(.md-dlg):has(button[data-v="1"])', wait=200)
        pg.click(yes)
        self.wait(2500)
        st = self.ev("(()=>{ const x=S.items[S.items.length-1], c=Kit.container(x), j=Kit.parts(x).find(p=>p.modJoin); return { q:c.qty, n:c.mods&&c.mods.cells.length, j:j?j.qty:0, size:c.size }; })()")
        if st.get('q') != 2 or st.get('n') != 2 or st.get('j') != 1:
            self.errs.append(('station', 'mods', 'состав после «Сделать из модулей»: %s' % st))
        self.snap('47d_st_mods_layout', '#edlg', wait=6000)
        # обратно — один модуль
        pg.click('#edlg [data-a=stlMods]')
        pg.wait_for_selector('dialog.md-dlg[open] [data-md=one]', timeout=20000)
        pg.click('dialog.md-dlg [data-md=one]')
        yes = 'dialog[open] button[data-v="1"]:has-text("Да, один модуль")'
        pg.wait_for_selector(yes)
        pg.click(yes)
        try:   # пересчёт на медленной машине идёт дольше — ждать результата, а не фиксированную паузу
            pg.wait_for_function("(()=>{ const x=S.items[S.items.length-1], c=Kit.container(x); return c.qty===1 && !c.mods; })()", timeout=20000)
        except Exception:
            pass
        st = self.ev("(()=>{ const x=S.items[S.items.length-1], c=Kit.container(x); return { q:c.qty, m:!!c.mods, j:Kit.parts(x).some(p=>p.modJoin) }; })()")
        if st.get('q') != 1 or st.get('m') or st.get('j'):
            self.errs.append(('station', 'mods', 'после «Один модуль»: %s' % st))

    def _layout_views(self):
        """Переключатели вида компоновки станции (3D, чертёж, схема)."""
        self.pg.click('#edlg [data-edtab=layout]')
        self.wait(2000)
        sel = '#edlg [data-stv], #edlg [data-view], #edlg button[data-v]'
        for k in range(min(self.pg.locator(sel).count(), 8)):
            el = self.pg.locator(sel).nth(k)
            try:
                if el.is_visible():
                    el.click()
                    self.snap('46_st_layout_v%d' % k, '#edlg', wait=2500)
            except Exception as e:
                self.errs.append(('station', 'SCRIPT-view', str(e)[:150]))

    def s_price(self):
        pg = self.pg
        self.go('price')
        self.snap('50_price', None, full=True)
        self.ev("document.querySelectorAll('#form details').forEach(d=>{ if(d.querySelector('[data-rate]')) d.open=true })")
        self.snap('50b_price_rates', None, full=True, wait=300)
        for c in self.ev("[...document.querySelectorAll('[data-rate]')].filter(e=>e.offsetParent).map(e=>e.dataset.rate)"):
            v = {'USD': '95,5', 'EUR': '104,2', 'CNY': '13,1'}.get(c, '10')
            try:
                pg.fill('[data-rate="%s"]' % c, v, timeout=8000)
            except Exception as e:   # поле не приняло ввод — причину в отчёт, значение — как вставка
                self.errs.append(('price', 'NOTE-fill', str(e)[:1500]))
                self.ev("([c,v])=>{const i=document.querySelector('[data-rate=\"'+c+'\"]'); i.value=v; "
                        "i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}))}", [c, v])
        for i in range(self.ev("S.items.length")):
            loc = self.visible('[data-price="%d"]' % i)
            if loc and not (loc.input_value() or '').strip():
                loc.fill(str(1500000 + i * 100000))
                pg.keyboard.press('Tab')
        d = self.visible('[data-disc]')
        if d:
            d.fill('5')
            pg.keyboard.press('Tab')
        self.snap('51_price_filled', None, full=True, wait=800)

    def _open_deal(self):
        b = self.pg.locator('#form [data-a=deal]').first
        b.click() if b.count() else self.ev("DealState.open()")

    def s_deal(self):
        pg = self.pg
        self.go('price')
        self._open_deal()
        pg.wait_for_selector('#dealdlg[open], dialog.deal[open]', timeout=20000)
        self.wait(1500)
        root = self.topdlg()
        tabs = self.ev("[...document.querySelectorAll('dialog[open] .dl-tab')].map(b=>b.dataset.id||b.textContent.trim())")
        self.meta()['deal_tabs'] = tabs
        for t in tabs:
            pg.locator('dialog[open] .dl-tab[data-id="%s"]' % t).first.click()
            self.wait(1500)
            self.snap('60_deal_' + t, root, wait=300)
            if self.ev("(()=>{const d=document.querySelector('dialog[open]'); return d.scrollHeight>d.clientHeight})()"):
                self.ev("[...document.querySelectorAll('dialog[open] *')].filter(e=>e.scrollHeight>e.clientHeight+20&&"
                        "/(auto|scroll)/.test(getComputedStyle(e).overflowY)).forEach(e=>e.scrollTop=e.scrollHeight)")
                self.snap('60_deal_%s_bottom' % t, root, wait=300)
        self.closeall()
        self._open_deal()   # повторное открытие — окно не пустое
        self.snap('61_deal_reopen', self.topdlg(), wait=2000)
        self.closeall()

    def s_steps(self):
        pg = self.pg
        self.go('cover')
        self.snap('70_cover', None, full=True)
        self.go('conds')
        self.snap('71_conds', None, full=True)
        for inp in pg.locator('#form input[data-p^="cond"], #form textarea[data-p^="cond"]').all()[:3]:
            try:
                if inp.is_visible() and not inp.input_value():
                    inp.fill('По согласованию')
            except Exception:
                pass
        self.go('mgr')
        self.snap('72_mgr', None, full=True)
        if self.visible('#form select'):
            o = self.ev("[...document.querySelector('#form select').options].map(o=>o.value).filter(Boolean)")
            if o:
                pg.select_option('#form select >> nth=0', o[0])
                self.wait(800)
        self.fill_empty((('manager.name', 'Иванов Иван Иванович'), ('manager.phone', '+7 900 000-00-00'), ('manager.email', 'test@example.com')))
        self.snap('73_mgr_filled', None, full=True, wait=600)
        self.go('client')
        self.fill_empty((('contact.name', 'Петров Пётр'), ('contact.phone', '+7 900 111-22-33')))
        self.meta()['problems'] = self.ev("problems().map(p=>p[0])")

    def s_preview(self):
        self.ev("renderForm()")
        if self.phone:
            self.ev("openKpPreview()")
        else:
            self.pg.locator('#side [data-a=kpPreview]').first.click()
        self.pg.wait_for_selector('#pvdlg[open]', timeout=20000)
        self.snap('80_preview', '#pvdlg', wait=6000)
        self.closeall()
        self.ev("openKpPreview()")
        self.snap('81_preview_reopen', '#pvdlg', wait=5000)
        self.closeall()

    def s_save(self):
        """Сохранение КП (Word) двойным щелчком: запрос один, окно итога."""
        meta = self.meta()
        meta['problems_before_save'] = self.ev("problems().map(p=>p[0])")
        posts = []
        self.pg.on('request', lambda r: posts.append(r.method + ' ' + r.url.replace(self.base, ''))
                   if r.method in ('POST', 'PUT') and '/api/kp' in r.url else None)
        b = self.pg.locator('#side [data-a=download]').first
        if self.phone:
            self.go(self.ev("StepList.visible().slice(-1)[0].id"))
            b = self.pg.locator('#mbar [data-a=download]').first
        # не всё заполнено (частичный прогон) — что мешает, без 30 с ожидания; на телефоне тогда вместо «Сохранить» — «Проверить»
        if not b.count() or b.is_disabled():
            self.errs.append(('save', 'NOTE', '«Сохранить КП» неактивна: ' + '; '.join(meta['problems_before_save'] or [])))
            return
        b.dblclick()
        self.wait(9000)
        meta['save_requests'], meta['kp_after'] = posts[:], self.ev("({id:S.kpId,number:S.number})")
        self.snap('90_saved')
        self.snap('90b_saved_full', None, full=True)
        d = self.topdlg()
        if d:
            self.snap('91_saved_dialog', d)
            self.closeall()

    def s_files(self):
        self.go('conds')
        self.snap('92_conds_after_save', None, full=True, wait=800)
        b = self.pg.locator('#form [data-kfadd]').first
        if b.count():
            ref = os.path.join(self.out, 'ref_test.txt')
            with open(ref, 'w', encoding='utf-8') as f:
                f.write('Справочный документ для прогона.\n')
            with self.pg.expect_file_chooser() as fc:
                b.click()
            fc.value.set_files(ref)
            self.wait(2500)
        self.snap('93_files_added', None, full=True)

    def s_mail(self):
        self.ev("MailDlg.open(S.kpId, S.number)")
        self.snap('94_mail', self.topdlg(), wait=2000)
        self.closeall()

    def s_journal(self):
        pg = self.pg
        if self.phone:
            self.ev("openJournal()")
        else:
            pg.click('header [data-a=journal]')
        self.wait(2500)
        root = self.topdlg()
        self.snap('a0_journal', root)
        q = pg.locator('#jQ')
        if q.count():
            q.fill('2026')
            self.snap('a1_journal_search', root, wait=1200)
            q.fill('')
            self.wait(800)
        tabs = pg.locator('%s .j-tabs button, %s [data-jtab], %s [data-jf]' % (root, root, root))
        self.res['a0_journal']['tabs'] = [t.inner_text()[:30] for t in tabs.all()[:12]]
        for k in range(min(tabs.count(), 6)):
            try:
                tabs.nth(k).click()
                self.snap('a2_journal_tab%d' % k, root, wait=1000)
            except Exception as e:
                self.errs.append(('journal', 'SCRIPT-tab', str(e)[:120]))
        cc = self.visible('%s [data-cc]' % root)
        if cc:
            cc.click()
            self.snap('a3_client_card_from_journal', self.topdlg(), wait=2000)
        self.closeall()
        self.ev("openJournal()")
        self.snap('a4_journal_reopen', self.topdlg(), wait=2500)
        self.closeall()

    def s_misc(self):
        for nm, js in (('b0_myday', 'MyDay.open()'), ('b1_myprefs', 'MyPrefs.open()'), ('b2_help', 'openHelp()'),
                       ('b3_versions', "openHelp('versions')"), ('b4_newkp', 'NewKp.open()'), ('b5_reminders', 'Reminders.open()'),
                       ('b7_find', 'QuickSearch.open()')):
            try:
                self.closeall()
                self.ev(js)
                self.wait(2000)
                r = self.topdlg()
                self.snap(nm, r)
                if r and self.ev("document.querySelector('%s').innerText.trim().length" % r) < 30:
                    self.errs.append((nm, 'EMPTY', 'окно почти пустое'))
            except Exception as e:
                self.errs.append((nm, 'SCRIPT', str(e)[:200]))
        self.closeall()
        if self.phone:
            self.pg.click('#btnMenu')
            self.snap('b6_mobile_menu', self.topdlg(), wait=800)
            self.closeall()
        else:
            self.pg.click('details.topmenu > summary')
            self.snap('b6_topmenu', None)
            self.pg.click('details.topmenu > summary')

    def s_settings(self):
        """«Настройки»: вход администратора через форму, все вкладки всех групп и их подразделы."""
        pg = self.pg
        self.closeall()
        self.ev("openSettings()")
        self.snap('c0_settings_login', self.topdlg(), wait=1500)
        if pg.locator('#stPw').count():
            if pg.locator('#stLg').count():
                pg.fill('#stLg', self.cfg['admin'][0])
            pg.fill('#stPw', self.cfg['admin'][1])
            pg.keyboard.press('Enter')
            self.wait(2000)
        tabs = self.ev("AdminNav.tabs().map(t=>t.key)")
        self.meta()['set_tabs'] = tabs
        for t in tabs:
            try:
                self._settings_tab(t)
            except Exception as e:
                self.errs.append(('settings_' + t, 'SCRIPT', str(e)[:1500]))
        self.closeall()
        self.ev("openSettings()")
        self.snap('c3_settings_reopen', self.topdlg(), wait=1500)
        self.closeall()

    def _settings_tab(self, t):
        pg = self.pg
        if self.phone and not pg.locator('#setdlg [data-sttab="%s"]' % t).first.is_visible():
            self.ev("t=>document.querySelector('#setdlg [data-sttab=\"'+t+'\"]').click()", t)
        else:
            pg.locator('#setdlg nav [data-sttab="%s"]' % t).first.click()
        self.wait(1800)
        if self.ev("[...document.querySelectorAll('dialog[open]')].some(d=>d.id!=='setdlg')"):
            # вкладка открыла своё окно поверх «Настроек» (например, «Товары» — окно каталога): снимок окна и закрыть
            self.snap('c1_set_' + t, self.topdlg(), wait=200)
            self.ev("[...document.querySelectorAll('dialog[open]')].filter(d=>d.id!=='setdlg').forEach(d=>d.close())")
            self.wait(300)
            return
        self.snap('c1_set_' + t, '#setdlg', wait=200)
        sub = pg.locator('#setdlg .st-body [data-sub], #setdlg .st-body .tabs button, #setdlg .st-body [role=tab]')
        for k in range(min(sub.count(), 6)):
            try:
                if sub.nth(k).is_visible():
                    sub.nth(k).click()
                    self.snap('c2_set_%s_sub%d' % (t, k), '#setdlg', wait=1000)
            except Exception as e:
                self.errs.append(('settings', 'SCRIPT-sub', str(e)[:100]))

    def _bx_connect(self):
        """«Настройки → Битрикс24»: вход администратора, адрес подставного Битрикса, связь включена."""
        pg = self.pg
        self.closeall()
        self.ev("openSettings('bx-link')")
        self.wait(1500)
        if pg.locator('#stPw').count():
            if pg.locator('#stLg').count():
                pg.fill('#stLg', self.cfg['admin'][0])
            pg.fill('#stPw', self.cfg['admin'][1])
            pg.keyboard.press('Enter')
            self.wait(2000)
        pg.wait_for_selector('#setdlg #bxUrl', timeout=20000)        # «Битрикс24» — свой раздел «Настроек»
        pg.fill('#setdlg #bxUrl', self.cfg['bitrix'])
        pg.click('#setdlg #bxTest')
        # прежний текст «Связь есть» уже на странице — ждать, пока проверка закончится (кнопка снова доступна)
        pg.wait_for_function("(b => b && !b.disabled)(document.querySelector('#setdlg #bxTest'))", timeout=30000)
        pg.wait_for_function("document.querySelector('#setdlg').innerText.includes('Связь есть')", timeout=30000)
        if not self.ev("document.querySelector('#setdlg #bxOn').checked"):   # режимы идут параллельно на одном стенде — включить один раз
            pg.click('#setdlg #bxOn')
        pg.wait_for_function("document.querySelector('#setdlg').innerText.includes('Последний обмен')", timeout=30000)

    def _bx_tab(self, tab):
        """Пункт раздела «Битрикс24» в меню «Настроек» (на телефоне меню может быть свёрнуто — щелчок из страницы)."""
        self.ev("t=>document.querySelector('#setdlg nav [data-sttab=\"bx-'+t+'\"]').click()", tab)
        self.wait(1500)

    def s_bitrix(self):
        """«Настройки → Битрикс24» на подставном Битриксе: связь, все пункты раздела, пробный прогон, старые сделки."""
        pg = self.pg
        self._bx_connect()
        tabs = self.ev("BitrixPanel.TABS.map(t=>t[0])")
        for t in tabs:
            self._bx_tab(t)
            if t == 'log':
                pg.click('#setdlg #bxDry')
                pg.wait_for_function("document.querySelector('#setdlg').innerText.includes('Пробный прогон готов') || document.querySelector('#setdlg .msg.err')", timeout=60000)
            if t == 'old':
                pg.fill('#setdlg #bxFromD', '2026-01-01')
                pg.click('#setdlg #bxImpPv')
                pg.wait_for_function("document.querySelector('#setdlg').innerText.includes('Найдено') || document.querySelector('#setdlg .msg.err')", timeout=60000)
            if pg.locator('#setdlg .msg.err').count():
                self.errs.append(('bitrix', 'ERR', '%s: %s' % (t, pg.locator('#setdlg .msg.err').first.inner_text()[:200])))
            self.snap('d_bx_' + t, '#setdlg', wait=300)
        self.closeall()

    def s_cabinet(self):
        """Кабинет менеджера: все разделы (весь отдел), доска и список, карточка сделки панелью (дело, «‹ ›»), новая сделка с первым делом."""
        pg = self.pg
        self.closeall()
        self.ev("Cabinet.open()")
        pg.wait_for_selector('#cabWin .cab-tabs', timeout=30000)
        self.wait(1200)
        if self.ev("Cabinet.tab") != 'today':
            self.errs.append(('cabinet', 'ERR', 'кабинет открылся не на «Сегодня»'))
        self.snap('f_cab_start', '#cabWin', wait=200)
        if pg.locator('#cabWho').count():
            pg.select_option('#cabWho', 'all')
            self.wait(2000)
        for tab in self.ev("Cabinet.TABS.map(t=>t[0])"):
            loc = pg.locator('#cabWin [data-ctab="%s"]' % tab)
            if not loc.count():
                continue
            loc.click()
            self.wait(900)
            self.snap('f_cab_' + tab, '#cabWin', wait=200)
        pg.locator('#cabWin [data-ctab="deals"]').click()
        self.wait(800)
        other = 'board' if self.ev("CabDeals.view") == 'list' else 'list'
        pg.click('#cabWin [data-cview="%s"]' % other)
        self.wait(600)
        self.snap('f_cab_deals_' + other, '#cabWin', wait=200)
        flt = pg.locator('#cabWin [data-cflt="free"]')
        if flt.count():
            flt.click()
            self.wait(500)
            self.snap('f_cab_deals_free', '#cabWin', wait=200)
            pg.click('#cabWin [data-cflt=""]')
            self.wait(500)
        self._cab_card()
        self._cab_exec()
        self._cab_new()
        self.closeall()
        self.ev("Cabinet.open()")
        self.wait(800)
        if self.ev("Cabinet.tab") != 'deals':
            self.errs.append(('cabinet', 'ERR', 'кабинет не запомнил раздел'))
        pg.click('#cabWin [data-cguide]')
        pg.wait_for_selector('dialog.cg-dlg[open]', timeout=10000)
        self.snap('f_cab_guide', 'dialog.cg-dlg[open]', wait=200)
        self.closeall()

    def _cab_card(self):
        pg = self.pg
        card = pg.locator('#cabWin .dc, #cabWin .cab-lr').first
        if not card.count():
            self.errs.append(('cabinet', 'ERR', 'в «Сделках» нет сделок'))
            return
        card.click()
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-in', timeout=15000)
        self.snap('f_deal_card', 'dialog.deal-dlg[open]', wait=800)
        title = 'Позвонить главному инженеру (прогон)'
        pg.fill('dialog.deal-dlg[open] form.tq input[name=title]', title)
        pg.click('dialog.deal-dlg[open] form.tq [data-dchip][data-day]:nth-child(2)')
        pg.click('dialog.deal-dlg[open] form.tq button[type=submit]')
        self.wait(1500)
        if title not in pg.locator('dialog.deal-dlg[open]').inner_text():
            self.errs.append(('cabinet', 'ERR', 'дело не добавилось в карточке'))
        self.snap('f_deal_task', 'dialog.deal-dlg[open]', wait=200)
        nxt = pg.locator('dialog.deal-dlg[open] [data-dknav="1"]')
        if nxt.count() and nxt.is_enabled():
            before = self.ev("DealCard.deal.id")
            nxt.click()
            self.wait(1500)
            if self.ev("DealCard.deal.id") == before:
                self.errs.append(('cabinet', 'ERR', '«›» не перешла к следующей сделке'))
            self.snap('f_deal_next', 'dialog.deal-dlg[open]', wait=200)
        pg.keyboard.press('Escape')
        self.wait(600)
        if pg.locator('dialog.deal-dlg[open]').count():
            self.errs.append(('cabinet', 'ERR', 'Esc не закрыл карточку сделки'))

    PLAN = {'start': '', 'ready': 30, 'delivery': 40, 'end': 45, 'pnr': None, 'pays': [{'d': 0, 'p': 50, 't': 'Аванс 50 %'}],
            'steps': [{'k': 'c1', 'd': 0, 't': 'Аванс 50 % — при подписании договора', 'p': 'cust', 'a': 450000, 'pc': 50},
                      {'k': 'sp:s1:0', 'd': 3, 't': 'Поставщику: предоплата 100 %', 'p': 'sup', 'a': 610000},
                      {'k': 'log:s1', 'd': 30, 't': 'Перевозка и сборы', 'p': 'log', 'a': 48000},
                      {'k': 'c2', 'd': 45, 't': 'Окончательный расчёт 50 % — после поставки', 'p': 'cust', 'a': 450000, 'pc': 50}]}

    def _cab_exec(self):
        """Исполнение сделки: план из экономики КП (вписан в описание КП стенда), «Договор подписан», дела сами, отметка «✓»."""
        pg = self.pg
        did = self.ev("""async plan => { const b = await api('/api/crm/board?manager=all');
          const d = b.deals.find(x => (x.kps || []).length && !x.execSum && !['won', 'lost'].includes(x.stage)); if (!d) return '';
          const kid = d.kps[0].id, m = await api(`/api/kp/${kid}/meta`); m.plan = plan;
          await api(`/api/kp/${kid}/meta`, {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8'}, body: JSON.stringify(m)});
          return d.id; }""", self.PLAN)
        if not did:
            self.errs.append(('cabinet', 'ERR', 'нет сделки с КП для исполнения'))
            return
        self.ev("id => DealCard.open(id)", did)
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-exec', timeout=15000)
        self.snap('f_deal_exec0', 'dialog.deal-dlg[open]', wait=800)
        pg.click('dialog.deal-dlg[open] [data-exsign]')
        pg.wait_for_selector('dialog.deal-dlg[open] .ex-r.ex-done', timeout=15000)
        self.wait(500)
        text = pg.locator('dialog.deal-dlg[open]').inner_text()
        if 'Оплатить поставщику' not in text:
            self.errs.append(('cabinet', 'ERR', 'после «Договор подписан» не появилось дело «Оплатить поставщику»'))
        pg.locator('dialog.deal-dlg[open] [data-exmark]').first.click()
        self.wait(1200)
        if self.ev("DealCard.deal.exec.paid") != 450000:
            self.errs.append(('cabinet', 'ERR', 'оплата заказчика не отмечена: %s' % self.ev("DealCard.deal.exec.paid")))
        self.snap('f_deal_exec1', 'dialog.deal-dlg[open]', wait=300)
        pg.keyboard.press('Escape')
        self.wait(500)

    def _cab_new(self):
        pg = self.pg
        if pg.locator('#cabWin .cab-q [data-cq="deal"]').is_visible():
            pg.click('#cabWin .cab-q [data-cq="deal"]')
        else:
            pg.click('#cabWin [data-cfab]')
            self.snap('f_cab_fab', '#cabWin', wait=200)
            pg.click('#cabWin .cab-fabm [data-cq="deal"]')
        pg.wait_for_selector('dialog.dk-new-dlg[open]', timeout=10000)
        self.ev("""() => api('/api/clients/innprogon1', {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8'},
          body: JSON.stringify({id: 'innprogon1', name: 'ООО «Контакт-Прогон»', inn: '', contacts: [{name: 'Смирнова Ольга', phone: '+7 (912) 345-67-89'}]})})""")
        pg.locator('dialog.dk-new-dlg[open] [name=client]').press_sequentially('89123456789', delay=30)
        try:
            pg.wait_for_selector('dialog.dk-new-dlg[open] .csg button', timeout=8000)
            self.snap('f_deal_new_phone', 'dialog.dk-new-dlg[open]', wait=200)
        except Exception:
            self.errs.append(('cabinet', 'ERR', 'клиент по телефону не подсказан'))
        pg.fill('dialog.dk-new-dlg[open] [name=client]', 'ООО «Прогон»')
        pg.fill('dialog.dk-new-dlg[open] [name=title]', 'Компрессорная для цеха (прогон)')
        pg.fill('dialog.dk-new-dlg[open] [name=task]', 'Уточнить потребность (прогон)')
        self.snap('f_deal_new', 'dialog.dk-new-dlg[open]', wait=200)
        pg.click('dialog.dk-new-dlg[open] button[type=submit]')
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-in', timeout=15000)
        self.wait(800)
        text = pg.locator('dialog.deal-dlg[open]').inner_text()
        if 'Уточнить потребность (прогон)' not in text:
            self.errs.append(('cabinet', 'ERR', 'первое дело новой сделки не добавилось'))
        self.snap('f_deal_created', 'dialog.deal-dlg[open]', wait=200)
        pg.keyboard.press('Escape')
        self.wait(500)

    def _mirror_tab(self):
        self._bx_tab('mirror')
        self.pg.wait_for_selector('#setdlg #bxMirror .st-card', timeout=20000)

    def _mirror_act(self, action, done):
        """Кнопка вкладки «Как в Битрикс24» с подтверждением; режимы идут параллельно — сделанное другим не повторять."""
        pg = self.pg
        text = lambda: pg.locator('#setdlg #bxMirror').inner_text()
        for _ in range(40):
            if done in text():
                return
            btn = pg.locator('#setdlg [data-mr="%s"]' % action)
            if btn.count() and btn.is_enabled():
                btn.click()
                pg.click('dialog[open] [data-v="1"]')
            self.wait(3000)
            self._mirror_tab()
        self.errs.append(('mirror', 'ERR', 'не дождался: ' + done))

    def s_mirror(self):
        """«Как в Битрикс24»: структура и сделки подставного Битрикса, доска по воронкам, карточка сделки с полями Битрикса."""
        pg = self.pg
        self._bx_connect()
        self._mirror_tab()
        self._mirror_act('structure', 'Структура загружена')
        self._mirror_act('import', 'Загрузка сделок закончена')
        self.snap('e0_mirror', '#setdlg', wait=300)
        self.closeall()
        self.ev("CabDeals.view = 'board'")
        self.ev("Cabinet.open('deals')")
        pg.wait_for_selector('#cabWin .cab-tabs', timeout=30000)
        if pg.locator('#cabWho').count():
            pg.select_option('#cabWho', 'all')
            self.wait(2500)
        pg.select_option('#cabFunnel', 'b3')
        self.wait(1200)
        cols = self.ev("[...document.querySelectorAll('#cabWin .kb-c header b')].map(x=>x.textContent)")
        if 'Высокая цена' in cols or 'КП отправлено' not in cols:
            self.errs.append(('mirror', 'ERR', 'колонки доски: %s' % cols))
        self.snap('e1_board', '#cabWin', wait=300)
        pg.locator('#cabWin .kb-c .dc').first.click()
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-ufs', timeout=20000)
        self.snap('e2_card', 'dialog.deal-dlg[open]', wait=300)
        sel = pg.locator('dialog.deal-dlg[open] select[data-uf="UF_CRM_REGION"]')
        sel.select_option('12')
        self.wait(2000)
        saved = self.ev("DealCard.deal && (DealCard.deal.uf||{}).UF_CRM_REGION")
        if saved != '12':
            self.errs.append(('mirror', 'ERR', 'поле Битрикса не сохранилось: %s' % saved))
        self.snap('e3_card_saved', 'dialog.deal-dlg[open]', wait=300)
        self.closeall()

    def s_dbl(self):
        """Двойной щелчок по кнопкам, открывающим окна: окно одно и не пустое."""
        self.closeall()
        out = {}
        for nm, sel in (('catalog', 'header [data-a=openCatalog]'), ('journal', 'header [data-a=journal]'),
                        ('new', '#btnNew'), ('help', 'header .help-btn'), ('find', 'header [data-a=find]')):
            loc = self.visible(sel)
            if not loc:
                continue
            loc.dblclick()
            self.wait(2000)
            out[nm] = self.dlg_list()
            self.snap('d0_dbl_' + nm, self.topdlg())
            self.closeall()
            self.wait(400)
        for step, key, sel in (('price', 'deal', '#form [data-a=deal]'), ('equip', 'editor', '#form button.btn[data-a=edit]'),
                               ('equip', 'addItem', '#form [data-a=addItem]')):
            self.go(step)
            b = self.pg.locator(sel).first
            if b.count():
                b.dblclick()
                self.wait(2500)
                out[key] = self.dlg_list()
                self.snap('d1_dbl_' + key, self.topdlg())
                self.closeall()
        self.meta()['dbl'] = out
        for k, v in out.items():
            if len([d for d in v if not d.startswith('setdlg')]) > 1:
                self.errs.append(('dbl', 'DOUBLE', '%s: открылось несколько окон %s' % (k, v)))


class Report:
    """Сводка по режиму: уникальные замечания проверок, ошибки сценария и страницы (без отсутствующих на стенде фото)."""
    CATS = ('docScroll', 'out', 'btnTxt', 'contrast', 'overlap', 'img', 'font', 'small')
    SKIP_OVERLAP = ('pw-eye', 'st-find', 'df-bar')
    BAD = ('SCRIPT', 'pageerror', 'DOUBLE', 'EMPTY')

    def __init__(self, out, mode):
        with open(os.path.join(out, 'res_%s.json' % mode), encoding='utf-8') as f:
            self.d = json.load(f)
        self.mode = mode

    def _key(self, c, y):
        if c in ('small', 'font'):
            y = re.sub(r' \d+×\d+$', '', re.sub(r'«[^»]*»', '«»', y))
        elif c == 'contrast':
            y = re.sub(r'\d+(\.\d+)?:1', '', y)
        return re.sub(r'\[data-(id|i)=[^\]]*\]', '', y)

    def found(self):
        agg = collections.defaultdict(collections.OrderedDict)
        for k, v in self.d['res'].items():
            if k == 'meta':
                continue
            for c in self.CATS:
                x = v.get(c)
                if not x:
                    continue
                if c == 'docScroll':
                    agg[c].setdefault('scrollWidth %s > %s' % (x, v['vw']), []).append(k)
                    continue
                for y in x:
                    if (c == 'overlap' and any(s in y for s in self.SKIP_OVERLAP)) or (c == 'contrast' and ('auth-logo' in y or 'brand' in y)):
                        continue
                    agg[c].setdefault(self._key(c, y), []).append(k)
        return agg

    def errors(self):
        seen, out = set(), []
        for st, t, m in self.d['errs']:
            if 'GL Driver' in m or '/img/' in m or 'Failed to load resource' in m or (t, m) in seen:
                continue
            seen.add((t, m))
            out.append((st, t, m))
        return out

    def bad(self):
        return [e for e in self.errors() if e[1] in self.BAD]

    def text(self, limit=30):
        lines = ['=== %s: снимков %d' % (self.mode, len([k for k in self.d['res'] if k != 'meta']))]
        for c, items in self.found().items():
            lines.append('### %s: %d уникальных' % (c, len(items)))
            lines += ['   %s | %d %s' % (key[:230], len(ks), ks[:3]) for key, ks in list(items.items())[:limit]]
        lines.append('### ошибки сценария и страницы')
        lines += ['   %s %s %s' % (st, t, m[:400]) for st, t, m in self.errors()]
        lines.append('   нет фото на стенде: %d' % sum(1 for e in self.d['errs'] if '/img/' in e[2]))
        lines.append('   этапы: ' + ', '.join(x for x in self.d['log'] if not x.startswith('snap ')))
        return '\n'.join(lines)


class Progon:
    """Запуск: стенд → по процессу на режим → сводка."""

    def __init__(self, argv):
        a = argparse.ArgumentParser(description='Прогон интерфейса в браузере (ПК, телефон, светлая и тёмная тема)')
        a.add_argument('--modes', default='pc,pcd,ph,phd')
        a.add_argument('--stages', default='', help='этапы через запятую: ' + ','.join(Modes.STAGES))
        a.add_argument('--out', default='')
        a.add_argument('--db', default='', help='КОПИЯ базы вместо вымышленных данных')
        a.add_argument('--worker', default='', help=argparse.SUPPRESS)
        a.add_argument('--cfg', default='', help=argparse.SUPPRESS)
        self.a = a.parse_args(argv)
        self.modes = [m for m in self.a.modes.split(',') if m]
        bad = [m for m in self.modes if m not in Modes.ALL]
        if bad:
            a.error('неизвестный режим: %s (есть %s)' % (', '.join(bad), ', '.join(Modes.ALL)))
        self.stages = [s for s in self.a.stages.split(',') if s]
        bad = [s for s in self.stages if s not in Modes.STAGES]
        if bad:
            a.error('неизвестный этап: %s (есть %s)' % (', '.join(bad), ', '.join(Modes.STAGES)))
        self.out = os.path.abspath(self.a.out or os.path.join(tempfile.gettempdir(), 'kp-progon-' + time.strftime('%Y%m%d-%H%M%S')))

    def worker(self):
        from playwright.sync_api import sync_playwright
        with open(self.a.cfg, encoding='utf-8') as f:
            cfg = json.load(f)
        with sync_playwright() as p:
            sc = Scenario(self.a.worker, cfg, self.out)
            sc.open(p)
            sc.run(self.stages)
        return 0

    def main(self):
        if self.a.worker:
            return self.worker()
        os.makedirs(self.out, exist_ok=True)
        stand = UiStand(self.a.db or None)
        try:
            cfg = stand.start()
            path = os.path.join(self.out, 'stand.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f)
            print('Стенд: http://127.0.0.1:%d — %s; итог — %s' % (cfg['port'], 'копия базы' if self.a.db else 'вымышленные данные', self.out), flush=True)
            procs = {}
            for m in self.modes:
                cmd = [sys.executable, os.path.abspath(__file__), '--worker', m, '--cfg', path, '--out', self.out]
                if self.stages:
                    cmd += ['--stages', ','.join(self.stages)]
                procs[m] = subprocess.Popen(cmd, stdout=open(os.path.join(self.out, 'log_%s.txt' % m), 'w'), stderr=subprocess.STDOUT)
            for m, pr in procs.items():
                pr.wait()
                print('режим %s: %s' % (m, 'готово' if pr.returncode == 0 else 'сбой (код %s, см. log_%s.txt)' % (pr.returncode, m)), flush=True)
        finally:
            stand.close()
        return self.summary(procs)

    def summary(self, procs):
        texts, bad = [], 0
        for m in self.modes:
            if not os.path.exists(os.path.join(self.out, 'res_%s.json' % m)):
                texts.append('=== %s: нет результата (см. log_%s.txt)' % (m, m))
                bad += 1
                continue
            r = Report(self.out, m)
            texts.append(r.text())
            bad += len(r.bad()) + (procs[m].returncode != 0)
        with open(os.path.join(self.out, 'report.txt'), 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(texts) + '\n')
        print('\n\n'.join(texts))
        print('\nИТОГ: %s. Снимки и подробности — %s' % ('сценарий прошёл' if not bad else 'есть сбои: %d' % bad, self.out))
        return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(Progon(sys.argv[1:]).main())
