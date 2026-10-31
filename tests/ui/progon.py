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
- Зависание: этап, не закончившийся за --stage-max минут (по умолчанию 10), записывается как HUNG, режим перезапускается со
  следующего этапа (профиль браузера — на диске, открытое КП и вкладки те же), не больше 3 раз. 3D-вид станции (WebGL
  программно) режимы строят по очереди — параллельно он перегружал стенд, и страница переставала отвечать.

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
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))


class Modes:
    IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
              'Version/18.0 Mobile/15E148 Safari/604.1')
    IPAD = ('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
            'Version/18.0 Mobile/15E148 Safari/604.1')
    BASE = {'locale': 'ru-RU', 'timezone_id': 'Europe/Moscow'}
    ALL = {'pc': dict(BASE, viewport={'width': 1440, 'height': 900}, color_scheme='light'),
           'pcd': dict(BASE, viewport={'width': 1366, 'height': 768}, color_scheme='dark'),
           'ph': dict(BASE, viewport={'width': 430, 'height': 932}, color_scheme='light', is_mobile=True, has_touch=True,
                      device_scale_factor=3, user_agent=IPHONE),
           'phd': dict(BASE, viewport={'width': 430, 'height': 932}, color_scheme='dark', is_mobile=True, has_touch=True,
                       device_scale_factor=3, user_agent=IPHONE),
           # планшет (iPad Air, книжная): раскладка ПК, но касания и узкий экран
           'tab': dict(BASE, viewport={'width': 820, 'height': 1180}, color_scheme='light', is_mobile=True, has_touch=True,
                       device_scale_factor=2, user_agent=IPAD),
           # широкий монитор (по запросу: --modes wide) — растягивание окон
           'wide': dict(BASE, viewport={'width': 1920, 'height': 1080}, color_scheme='light')}
    STAGES = ('client', 'cat', 'editor', 'station', 'price', 'deal', 'steps', 'preview', 'save', 'files', 'mail',
              'journal', 'kptabs', 'misc', 'cabinet', 'settings', 'bitrix', 'mirror', 'regs', 'dbl')

    @staticmethod
    def chromium():
        p = os.environ.get('KP_CHROMIUM')
        if p and os.path.isfile(p):
            return p
        found = sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome'))
        if found:
            return found[-1]
        return '/opt/pw-browsers/chromium' if os.path.isfile('/opt/pw-browsers/chromium') else None


class GlQueue:
    """Этапы с 3D-видом станции (WebGL на процессоре, swiftshader) — по одному режиму за раз: четыре сразу перегружали стенд,
    и страница переставала отвечать. Очередь — папка-замок в папке прогона (os.mkdir атомарен и в Windows)."""
    STAGES = ('station',)
    STALE = 1800

    def __init__(self, out):
        self.path = os.path.join(out, 'gl.lock')
        self.held = False

    def acquire(self, beat):
        while True:
            try:
                os.mkdir(self.path)
                self.held = True
                return
            except FileExistsError:
                self._drop_stale()
                beat()
                time.sleep(2)

    def _drop_stale(self):
        try:
            if time.time() - os.path.getmtime(self.path) > self.STALE:
                os.rmdir(self.path)
        except OSError:
            pass

    def release(self):
        if not self.held:
            return
        self.held = False
        try:
            os.rmdir(self.path)
        except OSError:
            pass


class StageGuard:
    """Предел времени этапа (Playwright evaluate ждёт страницу без предела): не уложился — HUNG в ошибках, результат на
    диск, выход с кодом HUNG; Progon перезапустит режим со следующего этапа."""
    HUNG = 3
    TICK = 5

    def __init__(self, run, limit):
        self.run, self.limit = run, limit
        self.stage, self.until = 'start', None
        self.path = os.path.join(run.out, 'progress_%s.json' % run.mode)
        threading.Thread(target=self._watch, daemon=True).start()

    def begin(self, stage):
        self.stage, self.until = stage, time.time() + self.limit
        self._write({'stage': stage})

    def beat(self):
        self._write({'stage': self.stage, 'wait': 'очередь 3D'})

    def end(self):
        self.until = None

    def _write(self, data):
        try:
            with open(self.path, 'w', encoding='utf-8') as f:
                json.dump(dict(data, t=time.time()), f, ensure_ascii=False)
        except OSError:
            pass

    def _watch(self):
        while True:
            time.sleep(self.TICK)
            if self.until and time.time() > self.until:
                self._give_up()

    def _give_up(self):
        run = self.run
        minutes = ('%.1f' % (self.limit / 60)).rstrip('0').rstrip('.').replace('.', ',')
        run.errs.append((self.stage, 'HUNG', 'этап не закончился за %s мин — страница не отвечала; режим продолжен со следующего '
                                             'этапа' % minutes))
        run.log.append('%s HUNG' % self.stage)
        for _ in range(3):   # словари меняет и основной поток — повторить, если поменялись во время записи
            try:
                run.save()
                break
            except (RuntimeError, ValueError):
                time.sleep(0.2)
        run.gl.release()
        self._write({'stage': self.stage, 'hung': self.stage})
        os._exit(self.HUNG)


class ProfileProcs:
    """Браузер зависшего режима после выхода процесса-режима остаётся работать и грузит стенд — закрыть по папке профиля
    (Linux, /proc; в Windows браузер закрывается вместе с драйвером Playwright)."""

    @staticmethod
    def kill(profile):
        # путь целиком, до конца аргумента: «profile/pc» — начало «profile/pcd»
        mark = b'--user-data-dir=' + profile.encode() + b'\0'
        for cmd in glob.glob('/proc/[0-9]*/cmdline'):
            try:
                with open(cmd, 'rb') as f:
                    if mark not in f.read():
                        continue
                os.kill(int(cmd.split('/')[2]), 9)
            except (OSError, ValueError):
                pass


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

    # «Наши реквизиты» стенда (вымышленные): основное — ОСНО, второе — УСН «доходы» с НДС 5 % (продавец в экономике сделки,
    # документы)
    REQUISITES = {
        'main': 'pr1',
        'items': [
            {'id': 'pr1', 'name': 'ООО «Пример-Пневмо»', 'inn': '7700000001', 'vat': ''},
            {'id': 'pr2', 'name': 'ИП Примеров Пётр Петрович', 'inn': '770000000002', 'vat': '5', 'usn': 'income'},
        ],
    }

    def __init__(self, db=None):
        from kit import SampleData, Stand
        self.st = Stand(mode='server', sample=None if db else SampleData())
        if not db:
            self.st.kv_set('ourRequisites', self.REQUISITES)
        if db:
            os.makedirs(self.st.data, exist_ok=True)
            with open(db, 'rb') as src, open(self.st.db, 'wb') as dst:
                dst.write(src.read())
            c = sqlite3.connect(self.st.db)
            c.execute("DELETE FROM kv WHERE key IN ('admin', 'admins')")
            c.commit()
            c.close()
        self._quiet()

    def _quiet(self):
        """Внешние обмены стенда. Битрикс24 — по «Обменяться сейчас» прогона, фоновый опрос — раз в час (раз в 90 с он
        попадал между снимками: сделка то «ждёт отправки», то уже в Битриксе); копия базы — без портала и второй папки
        копий владельца: стенд не пишет в его Битрикс24 и на его диск (прогон подключает подставной портал сам)."""
        import storage
        from bitrix import BitrixConf
        store = storage.Store(self.st.db)
        try:
            bitrix = store.kv_get(BitrixConf.KEY) or {}
            store.kv_set(BitrixConf.KEY, dict(bitrix, on=False, pollSec=BitrixConf.POLL[1]))
            settings = store.kv_get('settings') or {}
            if settings.get('backup2'):
                store.kv_set('settings', dict(settings, backup2=dict(settings['backup2'], on=False)))
        finally:
            store.conn().close()

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
        # этап «regs»: воронка «Обращения» и поля регламента оформления сделки (как в «Правилах ведения сделки»)
        fake.categories.append({'id': 5, 'name': 'Обращения'})
        fake.stages['DEAL_STAGE_5'] = [('C5:NEW', 'Новая заявка', 'P'), ('C5:TAKEN', 'Взято в работу', 'P'),
                                       ('C5:TKP', 'ТКП отправлено клиенту', 'P'), ('C5:AGREE', 'Согласование договора', 'P'),
                                       ('C5:SIGNED', 'Договор подписан', 'P'), ('C5:WON', 'В проект', 'S'),
                                       ('C5:LOSE', 'Сделка проиграна', 'F'), ('C5:DUP', 'Дубль сделки', 'F')]
        fake.portal_fields += [
            {'FIELD_NAME': 'UF_CRM_SRC', 'USER_TYPE_ID': 'enumeration', 'L': 'Источник1',
             'ITEMS': [{'ID': '1', 'VALUE': 'Рекламная заявка'}, {'ID': '2', 'VALUE': 'Повторная заявка'}, {'ID': '3', 'VALUE': 'Личная заявка'}]},
            {'FIELD_NAME': 'UF_CRM_CTYPE', 'USER_TYPE_ID': 'enumeration', 'L': 'Тип компании',
             'ITEMS': [{'ID': '31', 'VALUE': 'Конечный клиент'}, {'ID': '32', 'VALUE': 'Дилер'}]},
            {'FIELD_NAME': 'UF_CRM_EQ', 'USER_TYPE_ID': 'enumeration', 'L': 'Тип оборудования1',
             'ITEMS': [{'ID': '51', 'VALUE': 'Компрессоры'}, {'ID': '52', 'VALUE': 'Насосы'}]},
            {'FIELD_NAME': 'UF_CRM_ASKB', 'USER_TYPE_ID': 'string', 'L': 'Запрошенный бренд1'},
            {'FIELD_NAME': 'UF_CRM_ASKG', 'USER_TYPE_ID': 'string', 'L': 'Запрошенный товар1'},
            {'FIELD_NAME': 'UF_CRM_LOSTC', 'USER_TYPE_ID': 'string', 'L': 'Комментарий к проигранной Сделке'},
            {'FIELD_NAME': 'UF_CRM_DUP', 'USER_TYPE_ID': 'string', 'L': 'ID Основной сделки для Статуса "Дубль Сделки"'},
        ]

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
        self.gl = GlQueue(out)
        self.guard = None

    def open(self, p):
        exe = Modes.chromium()
        gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']   # WebGL2 программно — 3D-вид станции, как у менеджера
        # профиль на диске: перезапущенный после зависания режим открывает то же КП и вкладки
        self.ctx = p.chromium.launch_persistent_context(self.profile(), executable_path=exe or None, args=gl,
                                                        accept_downloads=True, **Modes.ALL[self.mode])
        self.br = self.ctx
        if self.mode == 'phd':
            self.ctx.add_init_script("try{ if(!localStorage.getItem('kp.theme')) localStorage.setItem('kp.theme','dark') }catch(e){}")
        self.ctx.add_init_script(self.expose_script())
        pg = self.pg = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        pg.on('pageerror', lambda e: self.errs.append((self.cur, 'pageerror', str(e)[:400])))
        pg.on('console', self._console)
        pg.on('response', self._response)
        pg.on('dialog', self._dialog)
        return pg

    # ответ 4xx, который программа ждёт: клиента КП нет в справочнике — ClientStore.byId → null (не ошибка)
    EXPECTED_HTTP = re.compile(r'^GET /api/clients/[^/?]+$')

    def _response(self, resp):
        if resp.status < 400:
            return
        what = resp.request.method + ' ' + resp.url.replace(self.base, '')[:200]
        if resp.status == 404 and self.EXPECTED_HTTP.match(what):
            return
        self.errs.append((self.cur, 'http %d' % resp.status, what))

    def profile(self):
        return os.path.join(self.out, 'profile', self.mode)

    @staticmethod
    def expose_script():
        """Классы программы — именами в окне страницы, только для проверок прогона (в программе их нет: модули
        подключают друг друга import). Живые свойства: S после смены КП — новое. Разделы «по требованию»
        (tz-out, rules-doc) не подключаются — проверяется их загрузка по первому нажатию; main.js и index.js страница
        подключает с меткой версии (?v=…) — повторный import запустил бы их второй раз. Обзор первого входа и совет
        кабинета — выключены (совет держится до первой перерисовки кабинета — в снимках был бы через раз; его снимок —
        на этапе «Кабинет»)."""
        root = os.path.join(ROOT, 'app', 'web', 'js')
        mods = []
        for d, _, files in os.walk(root):
            if any(x in d for x in ('tz-out', 'rules-doc', 'docx')):
                continue
            for f in sorted(files):
                if not f.endswith('.js') or f in ('index.js', 'boot.js', 'main.js'):
                    continue
                path = os.path.join(d, f)
                with open(path, encoding='utf-8') as src:
                    names = re.findall(r'^export (?:class|const|let|function) (\w+)', src.read(), re.M)
                if names:
                    mods.append(['/web/js/' + os.path.relpath(path, root).replace(os.sep, '/'), names])
        return '''try { localStorage.setItem('kp.tour', '1'); localStorage.setItem('kp.cab.tip', '1'); } catch (e) {}
addEventListener('DOMContentLoaded', async () => {
  for (const [path, names] of %s) {
    const ns = await import(path);
    for (const name of names) if (!(name in window)) Object.defineProperty(window, name, { get: () => ns[name], configurable: true });
  }
  window.__kpExposed = true;
});''' % json.dumps(mods)

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

    def touch_drag(self, x, y, dist, steps=12):
        """Провести пальцем по экрану (телефон): касание, движение на dist px по вертикали, отпускание — прокрутка, как у
        менеджера (window.scrollTo и щелчок Playwright прокручивают и там, где палец не может)."""
        if not getattr(self, 'touch', None):
            self.touch = self.ctx.new_cdp_session(self.pg)
        self.touch.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for k in range(1, steps + 1):
            self.touch.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + dist * k / steps}]})
            self.wait(16)
        self.touch.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        self.wait(900)

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
        if os.environ.get('KP_PROGON_DOM'):   # разметка страницы рядом со снимком — сверка до и после переписывания кода
            try:
                with open(fn[:-4] + '.html', 'w', encoding='utf-8') as f:
                    f.write(self.ev(self.DOM))
            except Exception:
                pass
        if os.environ.get('KP_PROGON_GEOM'):   # место, размер и вид каждого элемента — сверка вёрстки до и после правки стилей
            try:
                with open(fn[:-4] + '.geom.json', 'w', encoding='utf-8') as f:
                    json.dump({'els': self.ev(self.GEOM), 'dialogs': self.ev(self.DLG)}, f, ensure_ascii=False)
            except Exception:
                pass
        self.res[name] = r
        self.log.append('snap ' + name)
        return r

    # разметка страницы со значениями полей, как на экране: набранное, но ещё не перерисованное, в атрибутах не видно —
    # снимок зависел бы от того, успела ли форма перерисоваться; страница не меняется (значения — в копии)
    DOM = """() => {
        const live = document.body.querySelectorAll('input, textarea, select');
        const copy = document.body.cloneNode(true);
        const twins = copy.querySelectorAll('input, textarea, select');
        live.forEach((el, k) => {
          const twin = twins[k];
          if (!twin) return;
          if (el.tagName === 'TEXTAREA') twin.textContent = el.value;
          else if (el.tagName === 'SELECT') [...twin.options].forEach((opt, j) => opt.toggleAttribute('selected', !!(el.options[j] && el.options[j].selected)));
          else if (el.type === 'checkbox' || el.type === 'radio') twin.toggleAttribute('checked', el.checked);
          else if (el.type !== 'file' && el.type !== 'password') twin.setAttribute('value', el.value);
        });
        return copy.outerHTML;
      }"""
    # [тег#id.классы, x, y, ширина, высота, кегль, цвет, фон, display] видимых элементов — по порядку в документе
    GEOM = """() => [...document.querySelectorAll('body *')].filter(e => !e.closest('svg') || e.tagName === 'svg').map(e => {
        const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; const cs = getComputedStyle(e);
        const cls = typeof e.className === 'string' ? e.className.trim().split(/\\s+/).filter(Boolean).join('.') : '';
        const half = v => Math.round(v * 2) / 2;
        return [e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : ''), half(r.x), half(r.y), half(r.width),
          half(r.height), cs.fontSize, cs.color, cs.backgroundColor, cs.display];
      }).filter(Boolean)"""
    # открытые окна: вычисленные размер, пределы, место, отступы, скругление — правила окна перебивают друг друга
    DLG = """() => [...document.querySelectorAll('dialog[open]')].map(d => {
        const cs = getComputedStyle(d);
        return [d.id + '.' + d.className.trim().split(/\\s+/).join('.'), ...['position', 'top', 'right', 'bottom', 'left', 'width',
          'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
          'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'resize', 'display',
          'overflowY', 'zIndex'].map(k => cs[k])];
      })"""

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
        if self.guard and name in GlQueue.STAGES:
            self.gl.acquire(self.guard.beat)
        if self.guard:
            self.guard.begin(name)
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
        if self.guard:
            self.guard.end()
        self.gl.release()
        self.log.append('%s %.1fs' % (name, time.time() - t))
        self.save()

    def closeall(self):
        self.pg.keyboard.press('Escape')
        self.wait(150)
        self.ev("document.querySelectorAll('dialog[open]').forEach(d=>d.close())")

    def topdlg(self):
        return self.ev("(()=>{const d=[...document.querySelectorAll('dialog[open]:not(.tab-off)')].pop(); if(!d) return null; "
                       "if(!d.id) d.id='__d'+Math.random().toString(36).slice(2,7); return '#'+d.id})()")

    def meta(self):
        return self.res.setdefault('meta', {})

    def save(self):
        text = json.dumps({'res': self.res, 'errs': self.errs, 'dialogs': self.dialogs, 'log': self.log}, ensure_ascii=False, indent=1)
        with open(os.path.join(self.out, 'res_%s.json' % self.mode), 'w', encoding='utf-8') as f:
            f.write(text)

    def load(self):
        """Продолжение после зависания: найденное до перезапуска — из файла режима."""
        try:
            with open(os.path.join(self.out, 'res_%s.json' % self.mode), encoding='utf-8') as f:
                d = json.load(f)
        except (OSError, ValueError):
            return
        self.res, self.errs, self.dialogs, self.log = d['res'], [tuple(e) for e in d['errs']], d['dialogs'], d['log']


class Scenario(UiRun):
    """Путь менеджера: клиент → каталог → карточка → станция → цены → экономика сделки → оформление → сохранение КП →
    файлы и письмо → журнал → прочие окна → «Настройки» администратора → двойные щелчки."""

    def go(self, step):
        if self.phone:
            self.pg.locator('#mbar').wait_for()
        self.ev("Steps.open('%s')" % step)
        self.wait(500)
        self.ev("window.scrollTo(0,0)")

    def settle(self, what, js, timeout=60000):
        """Дождаться, пока страница будет готова к снимку (условие js); не дождались — отметка в отчёт."""
        try:
            self.pg.wait_for_function(js, timeout=timeout)
        except Exception:
            self.errs.append((self.cur, 'NOTE', '%s — не дождались за %d с' % (what, timeout // 1000)))

    # картинки станций собраны: нет пересборки и отложенной (3D-вид и листы — в фоне, по очереди)
    IMAGES = "StationImages.busy.size === 0 && StationImages.timers.size === 0"
    # предпросмотр КП собран (документ или ошибка вместо «Собираю документ…»): под нагрузкой сборка дольше 6 с
    PREVIEW = ("(() => { const body = document.querySelector('#pvBody'); "
               "return !!body && !/^Собираю документ/.test(body.textContent.trim()); })()")
    # миниатюра титула построена (или пустая / с ошибкой)
    COVER = ("(() => { const box = document.querySelector('#cvThumb'); return !box || (!box.classList.contains('loading') "
             "&& !!box.querySelector('section.docx, .cv-empty')); })()")

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

    def run(self, stages, resume=False):
        pg = self.pg
        if self.guard:
            self.guard.begin('start')
        pg.goto(self.base + '/')
        pg.wait_for_function("window.__kpExposed && Catalog.cache.length>0", timeout=60000)
        self.wait(1500)
        if resume:
            self.load()
        else:
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
            self.ev("CatalogWindow.open({})")
        pg.wait_for_selector('#cwList .cw-row', timeout=20000)
        self.snap('21_cat_open', '#catdlg')
        if self.phone:
            self._cat_scroll()
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
        if self.mode == 'tab' and self.visible('#cwPv .pv-x'):   # планшет: карточка — выдвижной панелью поверх списка
            pg.click('#cwPv .pv-x')
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
            self.ev("CatalogWindow.open({})")
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
        if self.phone:
            self._kp_swipe()

    # телефон: где верх окна каталога, строка поиска, отбор и список (px от верха экрана), прокрутка окна и сколько строк нарисовано
    CAT_GEO = ("(() => { const box = sel => document.querySelector(sel).getBoundingClientRect(); "
               "return {main: document.querySelector('#catdlg .cw-main').scrollTop, q: box('#cwQ').top, bar: box('#cwBar').bottom, "
               "head: box('#catdlg .cw-h').bottom, foot: box('#cwF').top, list: box('#cwList').top, "
               "rows: document.querySelectorAll('#cwList .cw-row').length, page: CatalogWindow.PAGE}; })()")

    def _cat_scroll(self):
        """Телефон: список каталога пальцем вверх — заголовок, отбор и «Найдено» уходят вместе с ним, строка поиска остаётся у
        края, списку — почти весь экран (31.10: было меньше половины); затем — снова к началу."""
        before = self.ev(self.CAT_GEO)
        self.touch_drag(215, 650, -400)
        after = self.ev(self.CAT_GEO)
        self.snap('21b_cat_scrolled', '#catdlg')
        self.meta()['cat_list_px'] = [round(geo['foot'] - max(geo['list'], geo['head'])) for geo in (before, after)]
        if not (after['main'] > before['main'] and 0 <= after['q'] < before['q'] and after['bar'] <= after['q']):
            self.errs.append((self.cur, 'ERR', 'каталог на телефоне: при прокрутке списка верх окна не уходит или строка поиска '
                                               'не остаётся у края — %s → %s' % (before, after)))
        if after['rows'] > after['page']:   # строки — частями по мере прокрутки, а не все позиции каталога сразу
            self.errs.append((self.cur, 'ERR', 'каталог на телефоне: нарисовано строк %d — больше порции %d' % (after['rows'], after['page'])))
        self.ev("document.querySelector('#catdlg .cw-main').scrollTop = 0")
        self.wait(300)

    def _kp_swipe(self):
        """Телефон: страница КП прокручивается пальцем, когда вкладки разделов открыты в фоне — как у менеджера: кабинет открыт с
        запуска, на КП — нижней панелью (31.10: правило «под открытым окном страница не прокручивается» срабатывало и на спрятанных
        вкладках — КП не листалось совсем)."""
        self.pg.click('[data-tab="cab"]')
        self.pg.wait_for_selector('#cabWin[open]')
        self.wait(800)
        self.pg.click('[data-tab="kp"]')
        self.wait(800)
        before = self.ev('scrollY')
        self.touch_drag(215, 600, -300)
        moved = self.ev('scrollY') - before
        self.meta()['kp_swipe_px'] = moved
        if moved <= 0 and self.ev('document.documentElement.scrollHeight > innerHeight + 300'):
            self.errs.append((self.cur, 'ERR', 'страница КП на телефоне не прокручивается пальцем (вкладки разделов открыты в фоне)'))
        self.ev('window.scrollTo(0, 0)')
        self.ev("AppTabs.close('cab')")
        self.wait(500)

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
        self.wait(2000)
        self.settle('картинки станции', self.IMAGES, 180000)
        self.snap('44_equip_with_station', None, full=True)
        self.closeall()      # после подбора программа сама открывает карточку станции — открываем заново, как менеджер
        n = self.ev("S.items.length") - 1
        pg.locator('#form button.btn[data-a=edit][data-i="%d"]' % n).first.click()
        pg.wait_for_selector('#edlg[open]')
        self.wait(1500)
        self.settle('картинки станции', self.IMAGES, 180000)
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
            src = pg.evaluate("async()=>{ const x=S.items[S.items.length-1], plan=StationPlan.plan(x), meta=StationMeta.meta(x, plan);"
                              " if (!StationRender.ok()) return 'skip'; const late=new Promise(ok=>setTimeout(()=>ok('late'), 180000));"
                              " const im=await Promise.race([StationRender.image(plan, meta, 'out', 72), late]); if (im==='late') return 'late';"
                              " return im ? im.src : 'ERR '+(StationRender.lastErr||''); }")
            if src.startswith('data:image/jpeg;base64,'):
                import base64
                with open(os.path.join(self.shots, '45r_st_paint_left.jpg'), 'wb') as f:
                    f.write(base64.b64decode(src.split(',', 1)[1]))
            elif src == 'late':
                self.errs.append(('station', 'NOTE', 'вид снаружи (WebGL) не построился за 3 мин — перегрузка стенда'))
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
            self.errs.append(('station', 'mods', 'бок о бок — не помещается: ' + pg.locator('dialog.md-dlg .smd-st').inner_text()[:150]))
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
        self._pic_view()

    def _pic_view(self):
        """3D-вид станции — на весь экран (PicView): открывается, листается, закрывается."""
        pg = self.pg
        img = pg.locator('#edlg img[data-st3d]').first
        if not img.count() or not img.is_visible():
            return
        try:
            img.click()
            pg.wait_for_selector('dialog.pv-dlg', timeout=5000)
            self.snap('46v_st_picview', 'dialog.pv-dlg', wait=500)
            if pg.locator('dialog.pv-dlg [data-pv="1"]').count():
                pg.locator('dialog.pv-dlg [data-pv="1"]').click()
            pg.keyboard.press('Escape')
            pg.wait_for_selector('dialog.pv-dlg', state='detached', timeout=5000)
        except Exception as e:
            self.errs.append(('station', 'SCRIPT-picview', str(e)[:150]))

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
            # скидка форму не перерисовывает (FieldEvents.leave) — сумма во вкладке КП обновилась бы только при следующей
            # перерисовке, и снимок зависел бы от неё
            self.ev("KpForm.render()")
        self.snap('51_price_filled', None, full=True, wait=800)

    def _open_deal(self):
        b = self.pg.locator('#form [data-a=deal]').first
        b.click() if b.count() else self.ev("DealWin.open()")

    def _deal_seller(self, root):
        """«Деньги и налог» → «Продавец»: на УСН с НДС 5 % (второе юрлицо стенда) вычета нет — строка «Вычета нет»."""
        pg, pick = self.pg, 'dialog[open] select[data-dlseller]'
        pg.locator('dialog[open] .dl-tab[data-id="money"]').first.click()
        self.wait(800)
        if not pg.locator(pick).count():
            self.errs.append(('deal', 'NOTE', 'нет выбора продавца («Наши реквизиты» стенда)'))
            return
        pg.select_option(pick, 'pr2')
        self.wait(1200)
        if not self.ev("/Вычета нет/.test((document.querySelector('dialog[open] .dl-vat') || {}).textContent || '')"):
            self.errs.append(('deal', 'SCRIPT', 'продавец на УСН 5 %: нет строки «Вычета нет» в «НДС к уплате»'))
        if not self.ev("/Налог УСН «доходы»/.test((document.querySelector('dialog[open] .dl-money') || {}).textContent || '')"):
            self.errs.append(('deal', 'SCRIPT', 'продавец на УСН «доходы»: нет строки «Налог УСН «доходы»» в «Деньгах и налоге»'))
        # условия из расчёта сделки подставляются при перерисовке окна, а шаги КП за окном — при следующей перерисовке
        # формы: снимок зависел бы от того, успела ли она
        self.ev("KpForm.renderSide()")
        self.snap('60_deal_money_usn', root, wait=300)
        pg.select_option(pick, 'pr1')
        self.wait(800)

    def _deal_addr_to_kp(self, tabs):
        """«Логистика» → «→ В КП»: адрес поставки — в «Адрес объекта» КП."""
        pg, addr = self.pg, 'г. Казань, ул. Прогонная, д. 7'
        for t in tabs:
            pg.locator('dialog[open] .dl-tab[data-id="%s"]' % t).first.click()
            self.wait(800)
            # поле «Куда — адрес объекта»: у поставщика, который везёт на сборку станции, «Куда» — склад сборщика, без «→ В КП»
            field = pg.locator('dialog[open] input[data-lgf="to"][placeholder^="адрес объекта"]')
            if field.count():
                break
        else:
            self.errs.append(('deal', 'NOTE', 'нет поля «Куда» в логистике'))
            return
        # кнопка «→ В КП» того же поставщика: у станции их несколько, первая на странице может быть чужой
        k = field.first.get_attribute('data-k') or ''
        tokp = 'dialog[open] [data-lgx="tokp"][data-k="%s"]' % k
        field.first.fill(addr)
        # через 0,3 с открываются подсказки адреса («Казань» из встроенных городов); у нижнего края окна — над полем, поверх
        # «→ В КП»: щелчок выбрал бы город. Менеджер закрывает список — Escape (список открыт — окно не закрывается)
        try:
            pg.wait_for_selector('.geo-box', timeout=2000)
            field.first.press('Escape')
        except Exception:
            pass
        self.wait(600)
        pg.locator(tokp).first.click()
        self.wait(400)
        got = self.ev("S.object && S.object.address")
        if got != addr:
            self.errs.append(('deal', 'SCRIPT', 'адрес в КП: ожидался %r, в КП %r' % (addr, got)))
        if pg.locator(tokp).count():
            self.errs.append(('deal', 'SCRIPT', 'кнопка «→ В КП» не скрылась после копирования'))

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
        self._deal_seller(root)
        self._deal_addr_to_kp(tabs)
        self.closeall()
        self._open_deal()   # повторное открытие — окно не пустое
        self.snap('61_deal_reopen', self.topdlg(), wait=2000)
        self.closeall()

    def s_steps(self):
        pg = self.pg
        self.go('cover')
        self.settle('миниатюра титула', self.COVER, 60000)
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
        self.wait(600)
        self.settle('менеджер в справочнике', "!/Сохраняю/.test((document.querySelector('#mgrStat') || {}).textContent || '')", 15000)
        self.snap('73_mgr_filled', None, full=True)
        self.go('client')
        self.fill_empty((('contact.name', 'Петров Пётр'), ('contact.phone', '+7 900 111-22-33')))
        self.meta()['problems'] = self.ev("Problems.list().map(p=>p[0])")

    def s_preview(self):
        self.ev("FormView.render()")
        if self.phone:
            self.ev("KpPreview.open()")
        else:
            self.pg.locator('#side [data-a=kpPreview]').first.click()
        self.pg.wait_for_selector('#pvdlg[open]', timeout=20000)
        self.settle('предпросмотр КП', self.PREVIEW)
        self.snap('80_preview', '#pvdlg', wait=1000)
        self.closeall()
        self.ev("KpPreview.open()")
        self.settle('предпросмотр КП заново', self.PREVIEW)
        self.snap('81_preview_reopen', '#pvdlg', wait=1000)
        self.closeall()

    def s_save(self):
        """Сохранение КП (Word) двойным щелчком: запрос один, окно итога."""
        meta = self.meta()
        meta['problems_before_save'] = self.ev("Problems.list().map(p=>p[0])")
        posts = []
        self.pg.on('request', lambda r: posts.append(r.method + ' ' + r.url.replace(self.base, ''))
                   if r.method in ('POST', 'PUT') and '/api/kp' in r.url else None)
        b = self.pg.locator('#side [data-a=download]').first
        if self.phone:
            self.go(self.ev("Steps.visible().slice(-1)[0].id"))
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
        pg.click('#appTabs [data-tab=jrn]')  # вкладка «Журнал КП» (ПК — сверху, телефон — нижняя панель)
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
        self.ev("Journal.open()")
        self.snap('a4_journal_reopen', self.topdlg(), wait=2500)
        self.closeall()

    def kp_tabs(self):
        return self.ev("KpTabs.items().map(t=>({uid:t.uid,label:t.label,on:t.on}))")

    def kp_pick(self, n):
        """Перейти на n-е открытое КП: ПК — вкладка сверху, телефон — «КП» внизу и список."""
        pg = self.pg
        if not self.phone:
            pg.locator('#appTabs [data-kpu]').nth(n).click()
        else:
            pg.click('#appTabs [data-tab=kp]')
            self.wait(400)
            if not self.visible('.kt-dlg'):
                pg.click('#appTabs [data-tab=kp]')
            self.wait(400)
            pg.locator('.kt-dlg [data-kto]').nth(n).click()
        self.wait(1500)

    def _unlock_others(self):
        """КП коллеги открыто только для просмотра: снимок полосы, затем «Разрешить правку» — дальше сценарий правит его."""
        button = self.visible('.kpv-bar [data-kpunlock]')
        if not button:
            return
        self.snap('k0_kp_view_only', None)
        button.click()
        self.wait(500)
        self.pg.locator('dialog[open] [data-v]:not([data-v="0"])').last.click()
        self.wait(800)

    def s_kptabs(self):
        """Несколько КП вкладками: открыть из журнала второе, правка в нём не трогает первое, «＋» — новое пустое,
        то же КП ещё раз — переход на его вкладку, после перезагрузки — те же вкладки и несохранённая правка, ✕ — закрыть."""
        pg = self.pg
        bad = []
        first = self.ev("({client:S.client, kpId:S.kpId||'', n:S.items.length, extra:S.condExtra})")
        pg.click('#appTabs [data-tab=jrn]')
        self.wait(2500)
        rows = pg.locator('#jList [data-jo]')
        other = None
        for k in range(rows.count()):
            if rows.nth(k).get_attribute('data-jo') != first['kpId']:
                other = rows.nth(k)
                break
        if other is None:
            self.errs.append(('kptabs', 'SCRIPT', 'нет второго КП в журнале'))
            return
        other_id = other.get_attribute('data-jo')
        other.click()
        self.wait(2500)
        tabs = self.kp_tabs()
        second = self.ev("({client:S.client, kpId:S.kpId||'', number:S.number||''})")
        if len(tabs) != 2 or second['kpId'] != other_id:
            bad.append('из журнала — не новой вкладкой: %s' % tabs)
        self._unlock_others()
        self.go('conds')
        loc = self.visible('#form [data-p=condExtra]')
        if loc:
            loc.fill('Вкладка Б — проверка')
            self.wait(900)
        else:
            self.errs.append(('kptabs', 'SCRIPT', 'нет поля «Дополнительные условия»'))
        self.snap('k0_two_kp', None)
        self.kp_pick(0)
        now = self.ev("({client:S.client, kpId:S.kpId||'', n:S.items.length, extra:S.condExtra})")
        if now != first:
            bad.append('первое КП изменилось: было %s, стало %s' % (first, now))
        # правка КП, открытого из журнала, при переходе на другую вкладку — в черновике (было: до первого автосохранения
        # правка не считалась несохранённой — ни черновика, ни вопроса при закрытии вкладки)
        drafts = self.ev("Drafts.list().then(rows => rows.map(row => row.kp))")
        if second['number'] and second['number'] not in drafts:
            bad.append('правка КП № %s, открытого из журнала, не отложена в черновик: %s' % (second['number'], drafts))
        self.kp_pick(1)
        if self.ev("S.condExtra") != 'Вкладка Б — проверка':
            bad.append('правка второго КП потерялась: %s' % self.ev("S.condExtra"))
        if self.phone:
            pg.click('#appTabs [data-tab=kp]')
            self.wait(500)
            if not self.visible('.kt-dlg'):
                pg.click('#appTabs [data-tab=kp]')
            self.snap('k1_kp_menu', '.kt-dlg', wait=600)
            pg.locator('.kt-dlg [data-ktn]').click()
        else:
            pg.click('#appTabs [data-kpadd]')
        self.wait(2000)
        self.closeall()
        tabs = self.kp_tabs()
        if len(tabs) != 3 or self.ev("S.client") or self.ev("S.items.length"):
            bad.append('«＋» — не новое пустое КП: %s, клиент «%s»' % (tabs, self.ev("S.client")))
        pg.click('#appTabs [data-tab=jrn]')
        self.wait(2000)
        same = first['kpId'] or other_id  # первое КП не сохранено — проверяем по второму
        pg.locator('#jList [data-jo="%s"]' % same).first.click()
        self.wait(2000)
        if len(self.kp_tabs()) != 3 or self.ev("S.kpId") != same:
            bad.append('то же КП открылось второй раз: %s' % self.kp_tabs())
        self.wait(800)
        self._edit_reload(bad)
        self.closeall()
        after = self.kp_tabs()
        if len(after) != 3:
            bad.append('после перезагрузки вкладок не 3: %s' % after)
        self.kp_pick(1)
        if self.ev("S.condExtra") != 'Вкладка Б — проверка':
            bad.append('после перезагрузки второе КП другое: %s' % self.ev("S.condExtra"))
        self.kp_pick(0)
        if self.ev("({client:S.client, kpId:S.kpId||'', n:S.items.length, extra:S.condExtra})") != first:
            bad.append('после перезагрузки первое КП другое')
        self.snap('k2_after_reload', None)
        uid = self.kp_tabs()[1]['uid']
        if self.phone:
            pg.click('#appTabs [data-tab=kp]')
            self.wait(500)
            if not self.visible('.kt-dlg'):
                pg.click('#appTabs [data-tab=kp]')
            self.wait(400)
            pg.locator('.kt-dlg [data-ktx="%s"]' % uid).click()
        else:
            pg.locator('#appTabs [data-kpx="%s"]' % uid).click()
        self.wait(2500)
        if len(self.kp_tabs()) != 2:
            bad.append('✕ не закрыл вкладку: %s' % self.kp_tabs())
        self.res.setdefault('k0_two_kp', {})['tabs'] = bad or 'ok'
        for b in bad:
            self.errs.append(('kptabs', 'ИЗОЛЯЦИЯ', b))
        self.closeall()

    def _edit_reload(self, bad):
        """Правка перед перезагрузкой страницы, ещё не попавшая в черновик (автосохранение на это время — пауза), после неё —
        несохранённая, с сообщением (было: считалась сохранённой — переход на другое КП терял её молча)."""
        pg = self.pg
        mark = 'Перед перезагрузкой — проверка'
        self.ev("t => { S.object.purpose = t; KpState.persist(); KpState.flush(); Drafts.paused = true; }", mark)
        asked = len(self.dialogs)
        pg.reload()
        pg.wait_for_function("window.__kpExposed && Catalog.cache.length>0", timeout=60000)
        try:
            pg.wait_for_function("(document.querySelector('#toast') || {}).textContent?.includes('Несохранённые правки КП')",
                                 timeout=15000)
        except Exception:
            bad.append('после перезагрузки нет сообщения о несохранённых правках КП')
        self.wait(2500)
        # «Покинуть страницу?» при несохранённой правке — так и задумано (BackGuard), не ошибка прогона
        self.dialogs[asked:] = [dialog for dialog in self.dialogs[asked:] if dialog[1] != 'beforeunload']
        if self.ev("S.object.purpose") != mark or not self.ev("!!Drafts.pending()"):
            bad.append('правка перед перезагрузкой страницы после неё — не несохранённая')

    def s_misc(self):
        for nm, js in (('b0_myday', 'MyDay.open()'), ('b1_myprefs', 'MyPrefs.open()'), ('b2_help', 'HelpWindow.open()'),
                       ('b3_versions', "HelpWindow.open('versions')"), ('b4_newkp', 'NewKp.open()'), ('b5_reminders', 'Reminders.open()'),
                       ('b7_find', 'QuickSearch.open()')):
            try:
                self.closeall()
                self.ev(js)
                self.wait(2000)
                r = self.topdlg()
                self.snap(nm, r)
                if r and self.ev("document.querySelector('%s').innerText.trim().length" % r) < 30:
                    self.errs.append((nm, 'EMPTY', 'окно почти пустое'))
                if nm == 'b3_versions' and not self.ev("/Версия \\d+\\.\\d+/.test(document.querySelector('#helpdlg').innerText)"):
                    self.errs.append((nm, 'EMPTY', 'история версий не загрузилась (help-versions.js)'))
            except Exception as e:
                self.errs.append((nm, 'SCRIPT', str(e)[:200]))
        self.closeall()
        if self.phone:
            self.pg.click('#appTabs [data-tab=more]')  # «Ещё» на нижней панели
            self.snap('b6_mobile_menu', self.topdlg(), wait=800)
            self.closeall()
        else:
            self.pg.click('details.topmenu > summary')
            self.snap('b6_topmenu', None)
            self.pg.click('details.topmenu > summary')
        self._tour()

    def _tour(self):
        """Тур первого входа: все подсказки по очереди, «Готово» закрывает."""
        pg = self.pg
        self.closeall()
        self.ev("Tour.start()")
        for k in range(8):
            if not pg.locator('.tour').count():
                break
            self.snap('b8_tour_%d' % k, None, wait=300)
            pg.locator('.tour [data-tourn]').click()
            self.wait(300)
        if pg.locator('.tour').count():
            self.errs.append(('tour', 'SCRIPT', 'тур не закрылся кнопкой «Готово»'))

    def s_settings(self):
        """«Настройки»: вход администратора через форму, все вкладки всех групп и их подразделы."""
        pg = self.pg
        self.closeall()
        self.ev("SettingsWindow.open()")
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
        self.ev("SettingsWindow.open()")
        self.snap('c3_settings_reopen', self.topdlg(), wait=1500)
        self.closeall()

    def _settings_tab(self, t):
        pg = self.pg
        pg.evaluate("t => { const b = document.querySelector('#setdlg nav [data-sttab=\"' + t + '\"]'); const more = b && b.closest('details'); if (more) more.open = true; }", t)
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
        for panel in self.ev("t => (AdminNav.tab(t).panels || []).map(p => p.key)", t)[1:]:
            pg.locator('#setdlg [data-stpanel="%s"]' % panel).first.click()
            self.wait(1800)
            if self.ev("[...document.querySelectorAll('dialog[open]')].some(d=>d.id!=='setdlg')"):
                self.ev("[...document.querySelectorAll('dialog[open]')].filter(d=>d.id!=='setdlg').forEach(d=>d.close())")
                self.wait(300)
            self.snap('c2_set_%s_%s' % (t, panel), '#setdlg', wait=300)
        if t == 'params':
            for extra in self.ev("DefaultsTab.EXTRA.map(e => e[0])"):
                pg.locator('#setdlg [data-dsec="%s"]' % extra).first.click()
                self.wait(1500)
                self.snap('c2_set_params_%s' % extra, '#setdlg', wait=300)
            return
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
        self.ev("SettingsWindow.open('bx-link')")
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

    def _bx_run(self):
        """«Обменяться сейчас» и дождаться конца: поля экономики и связь сделок с Битриксом — до снимков, а не когда успеет
        фоновый обмен (иначе «Как в Битрикс24» через раз без полей КП и прежних сделок)."""
        pg = self.pg
        run = pg.locator('#setdlg #bxRun')
        if not run.count() or not run.is_enabled():
            return
        run.click()
        self.settle('обмен с Битриксом', "(b => !b || (!b.disabled && !/Обмениваюсь/.test(b.textContent)))(document.querySelector('#setdlg #bxRun'))", 90000)

    def _bx_tab(self, tab):
        """Вкладка «Связи → Битрикс24» в «Настройках» (щелчок из страницы — на телефоне меню может быть свёрнуто)."""
        self.ev("""t => {
          const tab = document.querySelector('#setdlg [data-bxtab="' + t + '"]');
          if (tab) tab.click();
          else document.querySelector('#setdlg nav [data-sttab="bitrix"]').click();
        }""", tab)
        self.wait(1500)
        if not self.ev("t => !!document.querySelector('#setdlg [data-bxtab=\"' + t + '\"].on')", tab):
            self.ev("t => document.querySelector('#setdlg [data-bxtab=\"' + t + '\"]')?.click()", tab)
            self.wait(1500)

    def s_bitrix(self):
        """«Настройки → Битрикс24» на подставном Битриксе: связь, все пункты раздела, пробный прогон, старые сделки."""
        pg = self.pg
        self._bx_connect()
        self._bx_run()
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
            if t == 'regs':
                pg.wait_for_selector('#setdlg #bxRegsSave', state='attached', timeout=20000)
            if pg.locator('#setdlg .msg.err').count():
                self.errs.append(('bitrix', 'ERR', '%s: %s' % (t, pg.locator('#setdlg .msg.err').first.inner_text()[:200])))
            self.snap('d_bx_' + t, '#setdlg', wait=300)
        self.closeall()

    def s_cabinet(self):
        """Кабинет менеджера: все разделы (весь отдел), доска и список, карточка сделки панелью (дело, «‹ ›»), новая сделка с первым делом."""
        pg = self.pg
        self.closeall()
        # раздел кабинета помнится, пока страница открыта (20.10): прежние этапы могли оставить «Сделки» — открыть «Сегодня»
        self.ev("Cabinet.open('today')")
        pg.wait_for_selector('#cabWin .cab-tabs', timeout=30000)
        self.wait(1200)
        if self.ev("CabState.tab") != 'today':
            self.errs.append(('cabinet', 'ERR', 'кабинет открылся не на «Сегодня»'))
        self.snap('f_cab_start', '#cabWin', wait=200)
        self._cab_tip()
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
        if self.ev("CabState.tab") != 'deals':
            self.errs.append(('cabinet', 'ERR', 'кабинет не запомнил раздел'))
        pg.click('#cabWin [data-cguide]')
        pg.wait_for_selector('dialog.cg-dlg[open]', timeout=10000)
        self.snap('f_cab_guide', 'dialog.cg-dlg[open]', wait=200)
        self.closeall()
        self._cab_intake()

    def _cab_tip(self):
        """Совет при первом открытии кабинета (в общем ходе прогона выключен — expose_script): показан сверху «Сегодня» (и на
        телефоне) и «Понятно» убирает его."""
        pg = self.pg
        self.ev("localStorage.removeItem('kp.cab.tip')")
        self.ev("Cabinet.renderBody()")
        try:
            pg.wait_for_selector('#cabWin .cab-tip', timeout=5000)
        except Exception:
            self.errs.append(('cabinet', 'ERR', 'совет при первом открытии кабинета не показан'))
            return
        pg.locator('#cabWin .cab-tip').scroll_into_view_if_needed()
        self.snap('f_cab_tip', '#cabWin', wait=200)
        pg.click('#cabWin .cab-tip [data-ctip]')
        self.wait(300)
        if pg.locator('#cabWin .cab-tip').count() or self.ev("localStorage.getItem('kp.cab.tip')") != '1':
            self.errs.append(('cabinet', 'ERR', '«Понятно» не убрал совет кабинета'))

    def _cab_intake(self):
        """Заявка из письма: «Разобрать» — клиент (ИНН), задача, контакт и модель каталога; сделка → КП с этой моделью."""
        pg = self.pg
        self.ev("Cabinet.open()")
        self.wait(800)
        model = self.ev("(Catalog.cache.find(x => /\\d/.test(x.name || '')) || {}).name || ''")
        letter = ('Добрый день!\nПросим выставить КП на %s, 1 шт., поставка в Казань.\n\nС уважением,\n'
                  'Кузнецова Мария Ивановна\nООО «Ромашка-Прогон», ИНН 7701234567\nтел. +7 (916) 555-44-33, m.kuz@romashka-test.ru'
                  % (model or 'компрессор'))
        self._new_deal_dialog(snap=False)
        pg.click('dialog.dk-new-dlg[open] .dk-mail > summary')
        pg.fill('dialog.dk-new-dlg[open] [name=mail]', letter)
        pg.click('dialog.dk-new-dlg[open] [data-dnparse]')
        pg.wait_for_selector('dialog.dk-new-dlg[open] .dk-mail-f', timeout=20000)
        self.snap('f_deal_mail', 'dialog.dk-new-dlg[open]', wait=300)
        got = self.ev("""() => { const f = document.querySelector('dialog.dk-new-dlg[open] form').elements;
          return {client: f.client.value, title: f.title.value, task: f.task.value,
            models: [...document.querySelectorAll('dialog.dk-new-dlg[open] [name=dnmodel]')].length}; }""")
        if got['client'] != '7701234567' or not got['title'].startswith('Просим выставить КП') or 'Кузнецова' not in got['task']:
            self.errs.append(('cabinet', 'ERR', 'заявка из письма: поля не заполнены — %s' % got))
        if model and not got['models']:
            self.errs.append(('cabinet', 'ERR', 'заявка из письма: модель «%s» не найдена' % model))
        pg.fill('dialog.dk-new-dlg[open] [name=client]', 'ООО «Ромашка-Прогон»')  # без ФНС: на стенде нет интернета
        src = pg.locator('dialog.dk-new-dlg[open] [data-dnsrc]')
        if src.count():
            src.first.click()
        pg.click('dialog.dk-new-dlg[open] button[type=submit]')
        self.wait(3000)
        if model:
            items = self.ev("S.items.map(x => x.name)")
            if model not in items or not self.ev("S.dealId"):
                self.errs.append(('cabinet', 'ERR', 'КП из заявки: ждали «%s», в КП %s' % (model, items)))
            self.snap('f_deal_mail_kp', None, wait=300)
        self.closeall()

    def _deal_stage(self, key):
        """Стадия в карточке сделки: на ПК — стрелкой, на телефоне — из списка."""
        pg = self.pg
        chevron = pg.locator('dialog.deal-dlg[open] [data-dks="%s"]' % key)
        if chevron.count() and chevron.first.is_visible():
            chevron.first.click()
        else:
            pg.select_option('dialog.deal-dlg[open] select[data-dkf="stage"]', key)

    def _cab_card(self):
        pg = self.pg
        card = pg.locator('#cabWin .dc, #cabWin .cab-lr').first
        if not card.count():
            self.errs.append(('cabinet', 'ERR', 'в «Сделках» нет сделок'))
            return
        card.click()
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-in', timeout=15000)
        self.snap('f_deal_card', 'dialog.deal-dlg[open]', wait=800)
        title = 'Позвонить главному инженеру (прогон, %s)' % self.mode  # своё имя у режима — по нему ищется в ленте
        self._part('feed')
        pg.click('dialog.deal-dlg[open] [data-feedmode="task"]')
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

    def _part(self, key):
        """Открыть вкладку карточки сделки («Исполнение», «Поля Битрикс24», «Документы», на телефоне — «Дела»)."""
        tab = self.pg.locator('dialog.deal-dlg[open] [data-dktab="%s"]' % key)
        if tab.count() and tab.get_attribute('aria-selected') != 'true':
            tab.click()
            self.wait(300)

    PLAN = {'start': '', 'ready': 30, 'delivery': 40, 'end': 45, 'pnr': None, 'pays': [{'d': 0, 'p': 50, 't': 'Аванс 50 %'}],
            'steps': [{'k': 'c1', 'd': 0, 't': 'Аванс 50 % — при подписании договора', 'p': 'cust', 'a': 450000, 'pc': 50},
                      {'k': 'sp:s1:0', 'd': 3, 't': 'Поставщику: предоплата 100 %', 'p': 'sup', 'a': 610000},
                      {'k': 'log:s1', 'd': 30, 't': 'Перевозка и сборы', 'p': 'log', 'a': 48000},
                      {'k': 'c2', 'd': 45, 't': 'Окончательный расчёт 50 % — после поставки', 'p': 'cust', 'a': 450000, 'pc': 50}]}

    def _cab_exec(self):
        """Исполнение сделки: план из экономики КП (вписан в описание КП стенда), «Договор подписан», дела сами, отметка «✓»."""
        pg = self.pg
        did = self.ev("""async plan => { const b = await Api.request('/api/crm/board?manager=all');
          const d = b.deals.find(x => (x.kps || []).length && !x.execSum && !['won', 'lost'].includes(x.stage)); if (!d) return '';
          const kid = d.kps[0].id, m = await Api.request(`/api/kp/${kid}/meta`); m.plan = plan;
          await Api.request(`/api/kp/${kid}/meta`, {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8', 'X-KP-Edit-Other': '1'}, body: JSON.stringify(m)});
          const cur = await Api.request(`/api/crm/deal/${d.id}`);
          try { await Api.request(`/api/crm/deal/${d.id}`, {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8',
            'X-KP-Rev': String(cur.rev)}, body: JSON.stringify({stage: 'contract'})}); }
          catch (e) { return /регламент/.test(e.message) ? 'regs' : Promise.reject(e); }
          return d.id; }""", self.PLAN)
        if did == 'regs':  # режимы идут параллельно: этап regs другого режима включил регламент на общем стенде
            self.errs.append(('cabinet', 'NOTE', 'исполнение не проверено — на стенде в это время включён регламент Битрикс24'))
            return
        if not did:
            self.errs.append(('cabinet', 'ERR', 'нет сделки с КП для исполнения'))
            return
        self.ev("id => DealCard.open(id)", did)
        pg.wait_for_selector('dialog.deal-dlg[open] [data-dktab="exec"]', timeout=15000)
        self._part('exec')
        self.snap('f_deal_exec0', 'dialog.deal-dlg[open]', wait=800)
        pg.click('dialog.deal-dlg[open] [data-exsign]')
        pg.wait_for_selector('dialog.deal-dlg[open] .ex-r.ex-done', timeout=15000)
        self.wait(500)
        self._part('feed')
        text = pg.locator('dialog.deal-dlg[open]').inner_text()
        if 'Оплатить поставщику' not in text:
            self.errs.append(('cabinet', 'ERR', 'после «Договор подписан» не появилось дело «Оплатить поставщику»'))
        self._part('exec')
        pg.locator('dialog.deal-dlg[open] [data-exmark]').first.click()
        self.wait(1200)
        if self.ev("DealCard.deal.exec.paid") != 450000:
            self.errs.append(('cabinet', 'ERR', 'оплата заказчика не отмечена: %s' % self.ev("DealCard.deal.exec.paid")))
        self.snap('f_deal_exec1', 'dialog.deal-dlg[open]', wait=300)
        self._cab_sent_call()
        pg.keyboard.press('Escape')
        self.wait(500)

    def _cab_sent_call(self):
        """«Уже отправил сам» — окно «Когда позвонить клиенту?», «Через неделю» переносит звонок, который программа поставила сама."""
        pg = self.pg
        sent = pg.locator('dialog.deal-dlg[open] [data-dknow="sent"]')
        if not sent.count():
            self.errs.append(('cabinet', 'ERR', 'нет кнопки «Уже отправил сам» у неотправленного КП'))
            return
        sent.click()
        pg.wait_for_selector('dialog.sc-dlg[open]', timeout=15000)
        self.snap('f_deal_call', 'dialog.sc-dlg[open]', wait=200)
        week = pg.locator('dialog.sc-dlg[open] [data-dchip]', has_text='Через неделю')
        day = week.get_attribute('data-day')
        week.click()
        pg.click('dialog.sc-dlg[open] button[type="submit"]')
        self.wait(1500)
        calls = self.ev("""() => (DealCard.deal.tasks || []).filter(t => t.kind === 'call' && t.state === 'open'
          && String(t.title).startsWith('Обратная связь по КП')).map(t => t.due)""")
        if calls != [day]:
            self.errs.append(('cabinet', 'ERR', 'звонок после отправки КП: ждали один на %s, есть %s' % (day, calls)))
        self._cab_call_result()

    def _call_check(self, title):
        """Галочка у открытого звонка сделки по началу названия → окно «Итог звонка»."""
        pg = self.pg
        self._part('feed')
        tid = self.ev("""t => ((DealCard.deal.tasks || []).find(x => x.kind === 'call' && x.state === 'open'
          && String(x.title).startsWith(t)) || {}).id""", title)
        if not tid:
            self.errs.append(('cabinet', 'ERR', 'нет открытого звонка «%s…»' % title))
            return None
        pg.locator('dialog.deal-dlg[open] [data-tdone="%s"]' % tid).first.check()
        pg.wait_for_selector('dialog.cr-dlg[open]', timeout=15000)
        return tid

    def _cab_call_result(self):
        """Итог звонка: «Думает» — звонок сделан, новый через 3 дня, заметка в ленте; «Договорились» — дело и стадия дальше."""
        pg = self.pg
        tid = self._call_check('Обратная связь по КП')
        if not tid:
            return
        pg.click('dialog.cr-dlg[open] [data-cro="think"]')
        pg.fill('dialog.cr-dlg[open] textarea[name="note"]', 'Ждут бюджет (прогон)')
        self.snap('f_call_result', 'dialog.cr-dlg[open]', wait=200)
        day = pg.locator('dialog.cr-dlg[open] input[name="due"]').input_value()
        # режимы прогона работают с одной сделкой стенда параллельно: считается прирост, а не общее число звонков
        again = """() => (DealCard.deal.tasks || []).filter(t => t.state === 'open' && t.title === 'Перезвонить: клиент думает').length"""
        before = self.ev(again)
        pg.click('dialog.cr-dlg[open] button[type="submit"]')
        self.wait(2500)
        got = self.ev("""id => { const d = DealCard.deal, all = d.tasks || [];
          return {done: (all.find(t => t.id === id) || {}).state,
            again: all.filter(t => t.state === 'open' && t.title === 'Перезвонить: клиент думает').map(t => t.due),
            said: (d.comments || []).some(c => String(c.text).includes('Ждут бюджет (прогон)'))}; }""", tid)
        if got['done'] != 'done' or not got['said'] or day not in got['again'] or len(got['again']) > before + 1:
            self.errs.append(('cabinet', 'ERR', 'итог «Думает»: %s, ждали звонок на %s' % (got, day)))
        if not self._call_check('Перезвонить: клиент думает'):
            return
        pg.click('dialog.cr-dlg[open] [data-cro="agreed"]')
        pg.fill('dialog.cr-dlg[open] input[name="title"]', 'Подготовить договор (прогон)')
        move = pg.locator('dialog.cr-dlg[open] input[name="move"]')
        target = move.get_attribute('value') if move.count() else ''
        pg.click('dialog.cr-dlg[open] button[type="submit"]')
        self.wait(2500)
        need = pg.locator('dialog.dn-dlg[open] button.primary')
        if need.count():
            need.first.click()
            self.wait(1500)
        got = self.ev("""() => ({stage: [DealCard.deal.stage, DealCard.deal.fstage],
          step: (DealCard.deal.tasks || []).some(t => t.state === 'open' && t.title === 'Подготовить договор (прогон)')})""")
        if not got['step'] or (target and target not in got['stage']):
            self.errs.append(('cabinet', 'ERR', 'итог «Договорились»: %s, ждали стадию %s' % (got, target)))
        self._cab_docs()

    PDF = b'%PDF-1.4\n' + b'0' * 2000

    def _doc_upload(self, button, name):
        pg = self.pg
        with pg.expect_file_chooser() as chooser:
            pg.click(button)
        chooser.value.set_files({'name': name, 'mimeType': 'application/pdf', 'buffer': self.PDF})
        self.wait(2000)

    def _cab_docs(self):
        """Документы сделки: договор — чипом и кнопкой; «Выиграно» → «Прикрепите закрывающие» → УПД, напоминание снято."""
        pg = self.pg
        self._part('docs')
        pg.click('dialog.deal-dlg[open] [data-ddkind="contract"]')
        self._doc_upload('dialog.deal-dlg[open] [data-ddpick]', 'Договор поставки (прогон).pdf')
        kinds = self.ev("(DealCard.deal.files || []).map(f => f.kind + ':' + f.name)")
        if 'contract:Договор поставки (прогон).pdf' not in kinds:
            self.errs.append(('cabinet', 'ERR', 'договор не прикреплён: %s' % kinds))
        self.ev("""async () => { const d = DealCard.deal; await Api.request(`/api/crm/deal/${d.id}`, {method: 'PUT',
          headers: {'Content-Type': 'application/json; charset=utf-8', 'X-KP-Rev': String(d.rev)}, body: JSON.stringify({stage: 'won'})});
          await DealCard.reload(); }""")
        pg.wait_for_selector('dialog.deal-dlg[open] [data-dknow="docs"]', timeout=15000)
        self.snap('f_deal_docs', 'dialog.deal-dlg[open]', wait=300)
        self._doc_upload('dialog.deal-dlg[open] [data-dknow="docs"]', 'УПД № 7 (прогон).pdf')
        got = self.ev("({due: DealCard.deal.closingDue, upd: (DealCard.deal.files || []).some(f => f.kind === 'upd')})")
        if got != {'due': False, 'upd': True}:
            self.errs.append(('cabinet', 'ERR', 'закрывающие: %s' % got))
        self.snap('f_deal_docs1', 'dialog.deal-dlg[open]', wait=300)

    def _new_deal_dialog(self, snap=True):
        pg = self.pg
        pg.click('#cabWin [data-cnew]')
        if snap:
            self.snap('f_cab_new', '#cabWin', wait=200)
        pg.click('#cabWin .cab-newm [data-cq="deal"]')
        pg.wait_for_selector('dialog.dk-new-dlg[open]', timeout=10000)

    def _cab_new(self):
        pg = self.pg
        self._new_deal_dialog()
        self.ev("""() => Api.request('/api/clients/innprogon1', {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8'},
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
        self._part('feed')
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
        self._bx_run()
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
        pg.wait_for_selector('dialog.deal-dlg[open] [data-dktab="fields"]', timeout=20000)
        self._part('fields')
        self.snap('e2_card', 'dialog.deal-dlg[open]', wait=300)
        sel = pg.locator('dialog.deal-dlg[open] select[data-uf="UF_CRM_REGION"]')
        sel.select_option('12')
        self.wait(2000)
        saved = self.ev("DealCard.deal && (DealCard.deal.uf||{}).UF_CRM_REGION")
        if saved != '12':
            self.errs.append(('mirror', 'ERR', 'поле Битрикса не сохранилось: %s' % saved))
        self.snap('e3_card_saved', 'dialog.deal-dlg[open]', wait=300)
        self.closeall()

    def s_regs(self):
        """Регламент сделки Битрикс24: окно «Заполните» перед стадией, проигрыш «дублем», источник в новой сделке, вкладка регламента."""
        pg = self.pg
        self._bx_connect()
        self._mirror_tab()
        self._mirror_act('structure', 'Структура загружена')
        self._bx_tab('regs')
        pg.wait_for_selector('#setdlg #bxRegsSave', state='attached', timeout=20000)
        self.snap('g0_regs_admin', '#setdlg', wait=300)
        self.closeall()
        deal = self.ev("""() => Api.request('/api/crm/deal', {method: 'POST', headers: {'Content-Type': 'application/json; charset=utf-8'},
          body: JSON.stringify({title: 'Компрессор на завод (регламент)', client: 'ООО «Регламент-Прогон»', funnel: 'b5', source: 'ad'})})""")
        self.ev("id => DealCard.open(id)", deal['id'])
        pg.wait_for_selector('dialog.deal-dlg[open] .dk-in', timeout=20000)
        self._part('deal')
        self.snap('g1_regs_card', 'dialog.deal-dlg[open]', wait=400)
        self._part('fields')
        self.snap('g1_regs_fields', 'dialog.deal-dlg[open]', wait=300)
        self._part('deal')
        self._deal_stage('C5:TAKEN')
        pg.wait_for_selector('dialog.dn-dlg[open]', timeout=15000)
        self.snap('g2_regs_need', 'dialog.dn-dlg[open]', wait=300)
        self._regs_fill()
        pg.click('dialog.dn-dlg[open] [data-dnok]')
        self.wait(2500)
        if self.ev("DealCard.deal && DealCard.deal.fstage") != 'C5:TAKEN':
            self.errs.append(('regs', 'ERR', 'после «Заполните» сделка не на «Взято в работу»: %s' % self.ev("DealCard.deal && DealCard.deal.fstage")))
        self.snap('g3_regs_taken', 'dialog.deal-dlg[open]', wait=300)
        self._contacts()
        pg.click('dialog.deal-dlg[open] [data-dks="lost"]')
        pg.wait_for_selector('dialog.dk-lost-dlg[open]', timeout=10000)
        pg.check('dialog.dk-lost-dlg[open] input[value="C5:DUP"]')
        self.snap('g3_regs_lost', 'dialog.dk-lost-dlg[open]', wait=300)
        pg.fill('dialog.dk-lost-dlg[open] #lpC', 'Клиент уже ведётся в другой сделке')
        pg.click('dialog.dk-lost-dlg[open] [data-ok]')
        pg.wait_for_selector('dialog.dn-dlg[open]', timeout=15000)
        self.snap('g4_regs_dup', 'dialog.dn-dlg[open]', wait=300)
        pg.fill('dialog.dn-dlg[open] [data-uf="UF_CRM_DUP"]', '12345')
        pg.click('dialog.dn-dlg[open] [data-dnok]')
        self.wait(2500)
        if self.ev("DealCard.deal && DealCard.deal.fstage") != 'C5:DUP':
            self.errs.append(('regs', 'ERR', 'дубль не закрыт: %s' % self.ev("DealCard.deal && DealCard.deal.fstage")))
        self.closeall()
        self.ev("Cabinet.open('deals')")
        pg.wait_for_selector('#cabWin .cab-tabs', timeout=30000)
        self.wait(1200)
        self.ev("DealNew.open()")
        pg.wait_for_selector('dialog.dk-new-dlg[open] [data-dnsrc]', timeout=10000)
        self.snap('g5_regs_new', 'dialog.dk-new-dlg[open]', wait=300)
        self.closeall()

    def _contacts(self):
        """Карточка клиента из сделки: добавить контакт и исправить его — сделка показывает новый контакт."""
        pg = self.pg
        pg.click('dialog.deal-dlg[open] .dk-ce')
        box = 'dialog.cc-dlg[open]'
        pg.wait_for_selector(box + ' [data-ccca]', timeout=15000)
        pg.click(box + ' [data-ccca]')
        name = 'Сидоров Пётр (%s)' % self.mode  # своё имя у режима — по нему ищется в карточке
        pg.fill(box + ' [data-cccf="name"]', name)
        pg.fill(box + ' [data-cccf="phone"]', '+7 900 555-66-77')
        pg.click(box + ' [data-cccs]')
        pg.wait_for_selector(box + ' [data-ccce="0"]', timeout=10000)
        pg.click(box + ' [data-ccce="0"]')
        pg.fill(box + ' [data-cccf="post"]', 'Главный механик')
        self.snap('g3_contact_edit', box, wait=200)
        pg.click(box + ' [data-cccs]')
        self.wait(800)
        text = pg.locator(box + ' #ccPeople').inner_text()
        if name not in text or 'Главный механик' not in text:
            self.errs.append(('regs', 'ERR', 'контакт не добавлен или не исправлен: %s' % text[:200]))
        self.snap('g3_contact_saved', box, wait=200)
        pg.click(box + ' [data-x]')
        self.wait(1200)
        if name not in pg.locator('dialog.deal-dlg[open] .dk-cl').inner_text():
            self.errs.append(('regs', 'ERR', 'новый контакт не появился в сделке'))

    def _regs_fill(self):
        """Окно «Заполните»: списки — первым вариантом, строки и заметка — текстом, клиент — вымышленным."""
        pg = self.pg
        box = 'dialog.dn-dlg[open]'
        for sel in pg.locator(box + ' select[data-uf]').all():
            sel.select_option(index=1)
        for inp in pg.locator(box + ' input[data-uf]').all():
            inp.fill('Прогон: значение')
        note = pg.locator(box + ' [data-dnnote]')
        if note.count() and not note.input_value():
            note.fill('Нужен винтовой компрессор на завод')
        values = {'companyPhone': '+7 495 100-20-30', 'companyEmail': 'info@reglament.example', 'inn': '7700000155',
                  'person': 'Орлова Анна Сергеевна', 'personPhone': '+7 900 222-33-44', 'personEmail': 'orlova@reglament.example'}
        for key, value in values.items():
            loc = pg.locator(box + ' [data-dnc="%s"]' % key)
            if loc.count():
                loc.fill(value)

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
    BAD = ('SCRIPT', 'pageerror', 'DOUBLE', 'EMPTY', 'HUNG')

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


class ProgonPlan:
    """Прогон по изменённому с прошлой сборки (--changed [--since v3.218.1]): этапы — разделов, файлы которых менялись,
    режимы — по виду правок. Логика JS — ПК; вёрстка (CSS, HTML) — ПК и телефон; цвета и темы — ещё тёмные; общее
    (core/, ui/, main.js, index.html, общие стили, сам прогон) — все этапы. Только сервер — прогон не нужен (его проверяют
    наборы tests/). Полный прогон всех режимов — по просьбе или при большой переделке интерфейса."""

    WEB = 'app/web/'
    COMMON = re.compile(r'^(app/web/(index\.html|js/(main|boot)\.js|js/(ui|core)/|css/(base|tabs|layout|compact|mobile)\.css)|tests/ui/)')
    THEME = re.compile(r'^app/web/(css/base\.css|js/core/theme\.js|js/boot\.js)')
    PHONE = re.compile(r'^app/web/(css/|index\.html|js/ui/mobile\.js)')
    STATION = r'(layout|calc|draw|eskd|view|kit|station|req|rules|rules-doc|tz|tz-out)'
    SECTIONS = (
        (r'^app/web/(js/features/(catalog|wizard)/|css/catalog\.css)', ('cat', 'editor', 'dbl')),
        (r'^(app/web/(js/features/(kp|doc)/|js/docx/|css/(client|items|preview|track|pricing|datepicker)\.css)|templates/)',
         ('client', 'steps', 'price', 'preview', 'save', 'files', 'mail', 'journal', 'kptabs')),
        (r'^app/web/(js/features/deal/|css/(deal|geo)\.css)', ('deal', 'price')),
        (r'^app/web/(js/features/crm/|css/cabinet\.css)', ('cabinet', 'regs', 'mirror')),
        (r'^app/web/(js/features/admin/|css/(settings|template-designer|template-editor)\.css)', ('settings', 'bitrix')),
        (r'^app/web/(js/features/' + STATION + '/|rules/)', ('station',)),
        (r'^app/web/(js/features/help\.js|css/help\.css)', ('misc',)),
    )

    def __init__(self, since: str = '') -> None:
        self.since = since or self._last_build()
        if not self._git('rev-parse', '--verify', '--quiet', self.since + '^{commit}'):
            raise SystemExit('--since: нет такой метки или коммита: %s' % self.since)
        self.files = self._files()

    @staticmethod
    def _git(*args) -> str:
        r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        return r.stdout.strip() if r.returncode == 0 else ''

    def _last_build(self) -> str:
        """Последний выпуск (метка v*) — с него и считаются правки."""
        return self._git('describe', '--tags', '--abbrev=0', '--match', 'v*') or 'HEAD'

    def _files(self) -> list:
        names = set(self._git('diff', '--name-only', self.since).splitlines())
        names |= set(self._git('ls-files', '--others', '--exclude-standard').splitlines())
        return sorted(name for name in names if name.startswith((self.WEB, 'templates/', 'tests/ui/')))

    def stages(self) -> list:
        if any(self.COMMON.match(name) for name in self.files):
            return list(Modes.STAGES)
        picked = {stage for pattern, stages in self.SECTIONS for stage in stages
                  if any(re.match(pattern, name) for name in self.files)}
        unknown = [name for name in self.files if not any(re.match(pattern, name) for pattern, _ in self.SECTIONS)]
        if unknown:  # файл интерфейса вне известных разделов — проверяется всё
            return list(Modes.STAGES)
        return [stage for stage in Modes.STAGES if stage in picked]

    def modes(self) -> list:
        if not self.files:
            return []
        modes = ['pc']
        if any(self.PHONE.match(name) for name in self.files):
            modes.append('ph')
        if any(self.THEME.match(name) for name in self.files):
            modes += ['pcd', 'phd']
        return modes

    def text(self) -> str:
        if not self.files:
            return 'С %s интерфейс не менялся — прогон не нужен (сервер проверяют наборы tests/).' % self.since
        return 'С %s изменено файлов интерфейса: %d → режимы %s, этапы %s' % (
            self.since, len(self.files), ','.join(self.modes()), ','.join(self.stages()))


class Progon:
    """Запуск: по стенду и процессу на режим → сводка."""

    def __init__(self, argv):
        a = argparse.ArgumentParser(description='Прогон интерфейса в браузере (ПК, телефон, светлая и тёмная тема)')
        a.add_argument('--modes', default='pc,pcd,ph,phd,tab')
        a.add_argument('--stages', default='', help='этапы через запятую: ' + ','.join(Modes.STAGES))
        a.add_argument('--out', default='')
        a.add_argument('--db', default='', help='КОПИЯ базы вместо вымышленных данных')
        a.add_argument('--worker', default='', help=argparse.SUPPRESS)
        a.add_argument('--cfg', default='', help=argparse.SUPPRESS)
        a.add_argument('--resume', action='store_true', help=argparse.SUPPRESS)
        a.add_argument('--stage-max', type=float, default=10, help='предел этапа, мин (дольше — «завис», режим продолжается)')
        a.add_argument('--changed', action='store_true', help='только этапы и режимы, затронутые правками с прошлой сборки')
        a.add_argument('--since', default='', help='с какой метки считать правки для --changed (по умолчанию — последняя v*)')
        self.a = a.parse_args(argv)
        self.plan = ProgonPlan(self.a.since) if self.a.changed and not self.a.worker else None
        if self.plan:
            print(self.plan.text(), flush=True)
            self.a.modes, self.a.stages = ','.join(self.plan.modes()), ','.join(self.plan.stages())
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
            sc.guard = StageGuard(sc, int(self.a.stage_max * 60))
            sc.open(p)
            sc.run(self.stages, resume=self.a.resume)
        return 0

    RESTARTS = 3

    def _spawn(self, m, path, stages, resume=False):
        cmd = [sys.executable, os.path.abspath(__file__), '--worker', m, '--cfg', path, '--out', self.out,
               '--stage-max', str(self.a.stage_max)]
        if stages:
            cmd += ['--stages', ','.join(stages)]
        if resume:
            cmd.append('--resume')
        log = open(os.path.join(self.out, 'log_%s.txt' % m), 'a')
        return subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)

    def _after_hung(self, m):
        """Этапы после зависшего (из выбранных); None — продолжать нечего."""
        try:
            with open(os.path.join(self.out, 'progress_%s.json' % m), encoding='utf-8') as f:
                hung = json.load(f).get('hung')
        except (OSError, ValueError):
            return None
        chosen = [s for s in Modes.STAGES if not self.stages or s in self.stages]
        if hung not in Modes.STAGES:
            return chosen
        rest = chosen[chosen.index(hung) + 1:] if hung in chosen else []
        return rest or None

    def _wait(self, procs, paths):
        restarts = collections.Counter()
        pending = dict(procs)
        while pending:
            for m, pr in list(pending.items()):
                if pr.poll() is None:
                    continue
                if pr.returncode:
                    ProfileProcs.kill(os.path.join(self.out, 'profile', m))
                rest = self._after_hung(m) if pr.returncode == StageGuard.HUNG else None
                if rest and restarts[m] < self.RESTARTS:
                    restarts[m] += 1
                    print('режим %s: этап завис — продолжаю с «%s»' % (m, rest[0]), flush=True)
                    pending[m] = procs[m] = self._spawn(m, paths[m], rest, resume=True)
                    continue
                print('режим %s: %s' % (m, 'готово' if pr.returncode == 0 else 'сбой (код %s, см. log_%s.txt)' % (pr.returncode, m)), flush=True)
                del pending[m]
            time.sleep(2)

    def main(self):
        if self.a.worker:
            return self.worker()
        if self.plan and not self.modes:
            return 0
        os.makedirs(self.out, exist_ok=True)
        stands, procs, paths = [], {}, {}
        try:
            for m in self.modes:  # у каждого режима свой стенд: режимы не меняют сделки и дела друг друга
                stand = UiStand(self.a.db or None)
                stands.append(stand)
                cfg = stand.start()
                path = os.path.join(self.out, 'stand_%s.json' % m)
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(cfg, f)
                print('Стенд %s: http://127.0.0.1:%d — %s' % (m, cfg['port'], 'копия базы' if self.a.db else 'вымышленные данные'), flush=True)
                paths[m] = path
                procs[m] = self._spawn(m, path, self.stages)
            print('Итог — %s' % self.out, flush=True)
            self._wait(procs, paths)
        finally:
            for stand in stands:
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
