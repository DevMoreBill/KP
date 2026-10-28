"""Журнал сервера data/logs/kp.log: ошибки запросов и потоков, вывод программы; ротация по размеру."""

import io
import os
import re
import sys
import threading
import traceback
from datetime import datetime, timedelta


class LogMask:
    """Ключи, токены и пароли — не в журнал сервера: в адресе, вебхуке Битрикс24, заголовке и JSON — звёздочками."""

    QUERY = re.compile(r'(?i)((?:token|access_token|appkey|api_?key|key|secret|password|client_secret)=)[^&\s"\'<>]+')
    WEBHOOK = re.compile(r'(/rest/\d+/)[^/\s"\'<>]+')
    HEADER = re.compile(
        r'(?i)((?:authorization|nrgapi-devtoken|x-api-key)["\']?\s*[:=]\s*["\']?(?:basic |bearer |token )?)[^\s"\',}]+'
    )
    FIELD = re.compile(r'(?i)(["\'](?:password|pass|pwd|key|apiKey|token|secret)["\']\s*:\s*["\'])[^"\']+')

    @classmethod
    def hide(cls, text: object) -> str:
        out = cls.QUERY.sub(r'\1***', str(text or ''))
        out = cls.WEBHOOK.sub(r'\1***', out)
        out = cls.HEADER.sub(r'\1***', out)
        return cls.FIELD.sub(r'\1***', out)


class ServerLog:
    NAME = 'kp.log'
    MAX = 1 << 20  # байт в файле до перехода на новый
    KEEP = 3  # прежних файлов
    ERROR, INFO, OUT = 'ОШИБКА', 'ИНФО', 'ВЫВОД'
    HEAD = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})  (\S+)\s+(.*)$')
    current = None  # журнал этого процесса (install)

    def __init__(self, folder: str) -> None:
        self.folder = folder
        self.path = os.path.join(folder, self.NAME)
        self.lock = threading.RLock()
        self.handle = None

    def _file(self):
        if self.handle is None:
            os.makedirs(self.folder, exist_ok=True)
            self.handle = open(self.path, 'a', encoding='utf-8', newline='\n')  # noqa: SIM115 — журнал открыт всё время работы
        return self.handle

    def _rotate(self):
        try:
            if os.path.getsize(self.path) < self.MAX:
                return
        except OSError:
            return
        if self.handle:
            self.handle.close()
            self.handle = None
        for i in range(self.KEEP, 0, -1):
            src = self.path if i == 1 else f'{self.path}.{i - 1}'
            try:
                if os.path.exists(src):
                    os.replace(src, f'{self.path}.{i}')
            except OSError:
                pass

    def write(self, level: str, text) -> None:
        lines = LogMask.hide(text).rstrip().split('\n')
        head = f'{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}  {level:<6} {lines[0].rstrip()}\n'
        rec = head + ''.join(f'    {x.rstrip()}\n' for x in lines[1:] if x.strip())
        with self.lock:
            try:
                self._rotate()
                handle = self._file()
                handle.write(rec)
                handle.flush()
            except (OSError, ValueError):
                pass

    def info(self, text) -> None:
        self.write(self.INFO, text)

    def close(self) -> None:
        with self.lock:
            if self.handle:
                self.handle.close()
                self.handle = None

    def error(self, where: str, exc: BaseException | None = None, trace_obj=None) -> None:
        """Ошибка с трассировкой: where — где (запрос, поток, задача); exc — исключение (по умолчанию — текущее)."""
        if exc is None and sys.exc_info()[1] is not None:
            exc, trace_obj = sys.exc_info()[1], sys.exc_info()[2]
        head = f'{where} — {type(exc).__name__}: {str(exc)[:500]}' if exc is not None else str(where)
        trace = (
            ''.join(traceback.format_exception(type(exc), exc, trace_obj or exc.__traceback__))
            if exc is not None
            else ''
        )
        self.write(self.ERROR, head + ('\n' + trace if trace else ''))
        if sys.__stderr__ is not None:  # запуск из консоли — трассировка и там
            try:
                sys.__stderr__.write(head + '\n' + trace)
            except Exception:
                pass

    @classmethod
    def failure(cls, where: str, exc: BaseException | None = None, trace=None) -> None:
        """Ошибка в журнал этого процесса (или в консоль, если журнала нет)."""
        if cls.current is not None:
            return cls.current.error(where, exc, trace)
        print(where, exc if exc is not None else '', file=sys.stderr)
        return None

    @classmethod
    def note(cls, text) -> None:
        if cls.current is not None:
            cls.current.info(text)

    # ---------- подключение
    @classmethod
    def of(cls, data_dir: str) -> 'ServerLog':
        """Журнал для чтения: этого процесса, а если он не подключён — файлы в data/logs."""
        return cls.current or cls(os.path.join(data_dir, 'logs'))

    @classmethod
    def install(cls, data_dir: str) -> 'ServerLog | None':
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

        def thread_failed(args):
            if args.exc_type is not SystemExit:
                log.error('поток «{}»'.format(getattr(args.thread, 'name', '?')), args.exc_value, args.exc_traceback)

        threading.excepthook = thread_failed
        return log

    # ---------- чтение (только администратору)
    def _flush(self) -> None:
        """Записанное этим процессом — на диск до чтения файлов журнала."""
        with self.lock:
            if self.handle:
                self.handle.flush()

    def files(self) -> list[str]:
        """Файлы журнала от старого к новому."""
        out = [f'{self.path}.{i}' for i in range(self.KEEP, 0, -1)] + [self.path]
        return [path for path in out if os.path.isfile(path)]

    def records(self) -> list[dict]:
        """Все записи от старых к новым: [{at, level, text, detail}]."""
        self._flush()
        out: list = []
        for path in self.files():
            try:
                with open(path, encoding='utf-8', errors='replace') as file:
                    for raw in file:
                        line = raw.rstrip('\n')
                        match = self.HEAD.match(line)
                        if match:
                            out.append(
                                {
                                    'at': match.group(1).replace(' ', 'T'),
                                    'level': match.group(2),
                                    'text': match.group(3),
                                    'detail': [],
                                }
                            )
                        elif out and line.startswith('    '):
                            out[-1]['detail'].append(line[4:])
            except OSError:
                pass
        return out

    def errors(self, limit: int = 30) -> list[dict]:
        """Последние ошибки, новые первыми."""
        errs = [
            dict(rec, detail='\n'.join(rec['detail'])[-6000:]) for rec in self.records() if rec['level'] == self.ERROR
        ]
        return errs[::-1][:limit]

    def count_since(self, hours: float = 24) -> int:
        edge = (datetime.now() - timedelta(hours=hours)).isoformat(timespec='seconds')
        return sum(1 for rec in self.records() if rec['level'] == self.ERROR and rec['at'] >= edge)

    def text(self) -> str:
        """Журнал целиком (до 4 МБ) — для «Скачать журнал»."""
        self._flush()
        parts = []
        for path in self.files():
            try:
                with open(path, encoding='utf-8', errors='replace') as file:
                    parts.append(file.read())
            except OSError:
                pass
        return ''.join(parts)

    def size(self) -> int:
        return sum(os.path.getsize(path) for path in self.files())


class _LogStream(io.TextIOBase):
    """Вывод программы (print) → журнал строками; у запуска из консоли — и в консоль, как раньше."""

    def __init__(self, log: ServerLog, orig) -> None:
        super().__init__()
        self.log, self.orig = log, orig
        self.buf = threading.local()

    def write(self, chunk: str) -> int:
        if self.orig is not None:
            try:
                self.orig.write(chunk)
            except Exception:
                pass
        text = getattr(self.buf, 'v', '') + str(chunk)
        *done, self.buf.v = text.split('\n')
        for line in done:
            if line.strip():
                self.log.write(ServerLog.OUT, line)
        return len(chunk)

    def flush(self) -> None:
        if self.orig is not None:
            try:
                self.orig.flush()
            except Exception:
                pass

    @property
    def encoding(self):
        return 'utf-8'

    def writable(self) -> bool:
        return True

    def isatty(self) -> bool:
        return False
