# -*- coding: utf-8 -*-
"""Журнал сервера: data/logs/kp.log — ошибки запросов, фоновых задач и потоков, сообщения программы.

У EXE без консоли (и у сервера отдела, которого запускает Планировщик от имени SYSTEM) вывода нет: всё, что программа
печатала, и трассировки ошибок пропадали. ServerLog.install при запуске направляет вывод программы в файл (у запуска из
консоли — и в консоль тоже), ошибки записывает с трассировкой. Файл до 1 МБ и ещё 3 прежних (kp.log.1–3) — не больше 4 МБ.
«Настройки → Система» показывает последние ошибки и отдаёт журнал целиком (только администратору).
Запись: «ГГГГ-ММ-ДД ЧЧ:ММ:СС  УРОВЕНЬ  текст», продолжение (трассировка) — строками с отступом в 4 пробела.
"""
import io
import os
import re
import sys
import threading
import traceback
from datetime import datetime, timedelta


class ServerLog:
    NAME = 'kp.log'
    MAX = 1 << 20          # байт в файле до перехода на новый
    KEEP = 3               # прежних файлов
    ERROR, INFO, OUT = 'ОШИБКА', 'ИНФО', 'ВЫВОД'
    HEAD = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})  (\S+)\s+(.*)$')
    current = None         # журнал этого процесса (install)

    def __init__(self, folder):
        self.folder = folder
        self.path = os.path.join(folder, self.NAME)
        self.lock = threading.RLock()
        self.f = None

    # ---------- запись
    def _file(self):
        if self.f is None:
            os.makedirs(self.folder, exist_ok=True)
            self.f = open(self.path, 'a', encoding='utf-8', newline='\n')
        return self.f

    def _rotate(self):
        try:
            if os.path.getsize(self.path) < self.MAX:
                return
        except OSError:
            return
        if self.f:
            self.f.close()
            self.f = None
        for i in range(self.KEEP, 0, -1):
            src = self.path if i == 1 else '%s.%d' % (self.path, i - 1)
            try:
                if os.path.exists(src):
                    os.replace(src, '%s.%d' % (self.path, i))
            except OSError:
                pass

    def write(self, level, text):
        lines = str(text).rstrip().split('\n')
        rec = '%s  %-6s %s\n' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), level, lines[0].rstrip()) + \
              ''.join('    %s\n' % x.rstrip() for x in lines[1:] if x.strip())
        with self.lock:
            try:
                self._rotate()
                f = self._file()
                f.write(rec)
                f.flush()
            except (OSError, ValueError):
                pass

    def info(self, text):
        self.write(self.INFO, text)

    def close(self):
        with self.lock:
            if self.f:
                self.f.close()
                self.f = None

    def error(self, where, exc=None, tb=None):
        """Ошибка с трассировкой: where — где (запрос, поток, задача); exc — исключение (по умолчанию — текущее)."""
        if exc is None and sys.exc_info()[1] is not None:
            exc, tb = sys.exc_info()[1], sys.exc_info()[2]
        head = '%s — %s: %s' % (where, type(exc).__name__, str(exc)[:500]) if exc is not None else str(where)
        trace = ''.join(traceback.format_exception(type(exc), exc, tb or exc.__traceback__)) if exc is not None else ''
        self.write(self.ERROR, head + ('\n' + trace if trace else ''))
        if sys.__stderr__ is not None:          # запуск из консоли — трассировка и там
            try:
                sys.__stderr__.write(head + '\n' + trace)
            except Exception:
                pass

    @classmethod
    def failure(cls, where, exc=None, tb=None):
        """Ошибка в журнал этого процесса (или в консоль, если журнала нет)."""
        if cls.current is not None:
            return cls.current.error(where, exc, tb)
        print(where, exc if exc is not None else '', file=sys.stderr)

    @classmethod
    def note(cls, text):
        if cls.current is not None:
            cls.current.info(text)

    # ---------- подключение
    @classmethod
    def install(cls, data_dir):
        """Журнал процесса: вывод программы и ошибки потоков — в data/logs/kp.log. → журнал или None (папку не создать)."""
        log = cls(os.path.join(data_dir, 'logs'))
        try:
            with log.lock:
                log._file()
        except OSError:
            return None
        cls.current = log
        sys.stdout = _LogStream(log, sys.stdout)
        sys.stderr = _LogStream(log, sys.stderr)

        def thread_failed(a):
            if a.exc_type is not SystemExit:
                log.error('поток «%s»' % getattr(a.thread, 'name', '?'), a.exc_value, a.exc_traceback)
        threading.excepthook = thread_failed
        return log

    # ---------- чтение (только администратору)
    def _flush(self):
        """Записанное этим процессом — на диск до чтения файлов журнала."""
        with self.lock:
            if self.f:
                self.f.flush()

    def files(self):
        """Файлы журнала от старого к новому."""
        out = ['%s.%d' % (self.path, i) for i in range(self.KEEP, 0, -1)] + [self.path]
        return [p for p in out if os.path.isfile(p)]

    def records(self):
        """Все записи от старых к новым: [{at, level, text, detail}]."""
        self._flush()
        out = []
        for p in self.files():
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    for line in f:
                        line = line.rstrip('\n')
                        m = self.HEAD.match(line)
                        if m:
                            out.append({'at': m.group(1).replace(' ', 'T'), 'level': m.group(2), 'text': m.group(3), 'detail': []})
                        elif out and line.startswith('    '):
                            out[-1]['detail'].append(line[4:])
            except OSError:
                pass
        return out

    def errors(self, limit=30):
        """Последние ошибки, новые первыми."""
        errs = [dict(r, detail='\n'.join(r['detail'])[-6000:]) for r in self.records() if r['level'] == self.ERROR]
        return errs[::-1][:limit]

    def count_since(self, hours=24):
        edge = (datetime.now() - timedelta(hours=hours)).isoformat(timespec='seconds')
        return sum(1 for r in self.records() if r['level'] == self.ERROR and r['at'] >= edge)

    def text(self):
        """Журнал целиком (до 4 МБ) — для «Скачать журнал»."""
        self._flush()
        parts = []
        for p in self.files():
            try:
                with open(p, 'r', encoding='utf-8', errors='replace') as f:
                    parts.append(f.read())
            except OSError:
                pass
        return ''.join(parts)

    def size(self):
        return sum(os.path.getsize(p) for p in self.files())


class _LogStream(io.TextIOBase):
    """Вывод программы (print) → журнал строками; у запуска из консоли — и в консоль, как раньше."""
    def __init__(self, log, orig):
        super().__init__()
        self.log, self.orig = log, orig
        self.buf = threading.local()

    def write(self, s):
        if self.orig is not None:
            try:
                self.orig.write(s)
            except Exception:
                pass
        text = getattr(self.buf, 'v', '') + str(s)
        *done, self.buf.v = text.split('\n')
        for line in done:
            if line.strip():
                self.log.write(ServerLog.OUT, line)
        return len(s)

    def flush(self):
        if self.orig is not None:
            try:
                self.orig.flush()
            except Exception:
                pass

    @property
    def encoding(self):
        return 'utf-8'

    def writable(self):
        return True

    def isatty(self):
        return False
