"""Справочные документы к КП: хранение в data/kp_files, проверка содержимого, пределы, удаление автором."""

import builtins
import io
import os
import re
import uuid
import zipfile
from datetime import datetime, timedelta

from defaults import SrvVal


class KpFiles:
    FOLDER = 'kp_files'
    MEGABYTE = 1024 * 1024
    NAME_MAX = 150
    NOTE_MAX = 300
    KP_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
    DISK = re.compile(r'^[0-9a-f]{32}\.[a-z]{3,4}$')
    BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
    OLE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'  # прежние Word и Excel (.doc, .xls)
    # расширение: (тип для скачивания, как проверить содержимое, что это — для сообщения)
    TYPES = {
        '.pdf': ('application/pdf', 'pdf', 'документ PDF'),
        '.doc': ('application/msword', 'ole', 'документ Word'),
        '.docx': ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', 'документ Word'),
        '.xls': ('application/vnd.ms-excel', 'ole', 'таблица Excel'),
        '.xlsx': ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', 'таблица Excel'),
        '.jpg': ('image/jpeg', 'jpg', 'картинка JPEG'),
        '.jpeg': ('image/jpeg', 'jpg', 'картинка JPEG'),
        '.png': ('image/png', 'png', 'картинка PNG'),
        '.dwg': ('application/acad', 'dwg', 'чертёж DWG'),
        '.dxf': ('application/dxf', 'dxf', 'чертёж DXF'),
        '.zip': ('application/zip', 'zip', 'архив ZIP'),
        '.txt': ('text/plain', 'txt', 'текстовый файл'),
    }
    # внутри архива — без программ, скриптов и страниц (их нельзя запускать с компьютеров отдела)
    ZIP_BAD = (
        '.exe',
        '.com',
        '.bat',
        '.cmd',
        '.scr',
        '.msi',
        '.msp',
        '.dll',
        '.cpl',
        '.lnk',
        '.pif',
        '.js',
        '.jse',
        '.vbs',
        '.vbe',
        '.wsf',
        '.wsh',
        '.ps1',
        '.psm1',
        '.hta',
        '.jar',
        '.reg',
        '.html',
        '.htm',
        '.xhtml',
        '.svg',
        '.mht',
        '.url',
        '.docm',
        '.xlsm',
        '.pptm',
        '.dotm',
        '.xltm',
        '.iso',
        '.img',
        '.vhd',
        '.vhdx',
        '.chm',
        '.appx',
        '.msix',
        '.sys',
        '.ocx',
        '.application',
        '.gadget',
        '.inf',
        '.scf',
        '.settingcontent-ms',
    )
    ARCHIVES = ('.zip', '.7z', '.rar', '.cab', '.tar', '.gz', '.tgz', '.bz2', '.xz')
    ZIP_INNER = 32 * 1024 * 1024  # вложенный архив проверяется, если не больше этого (распакованный размер)
    TEXT_BAD = (b'<!doctype', b'<html', b'<script', b'<svg', b'<?xml', b'<head', b'<body', b'<iframe')

    def __init__(self, store, data_dir: str) -> None:
        self.store = store
        self.root = os.path.join(data_dir, self.FOLDER)

    @classmethod
    def of(cls, store) -> 'KpFiles':
        """Файлы КП этой базы: папка kp_files — рядом с файлом базы (data)."""
        return cls(store, os.path.dirname(os.path.abspath(store.path)))

    def limits(self) -> dict:
        return {
            'fileMB': SrvVal.get(self.store, 'kp.fileMB'),
            'filesMax': SrvVal.get(self.store, 'kp.filesMax'),
            'filesMB': SrvVal.get(self.store, 'kp.filesMB'),
            'mailMB': SrvVal.get(self.store, 'kp.mailMB'),
        }

    @classmethod
    def megabytes(cls, size) -> str:
        x = size / cls.MEGABYTE
        return (f'{x:.1f}').replace('.', ',') if x < 10 else str(round(x))

    @classmethod
    def clean_name(cls, name) -> tuple:
        """Имя для показа и скачивания: без пути и запрещённых символов, не длиннее NAME_MAX → (имя, расширение)."""
        text = re.split(r'[\\/]', str(name or ''))[-1]
        text = re.sub(r'\s+', ' ', cls.BAD_CHARS.sub('', text)).strip().strip('.').strip()
        stem, ext = os.path.splitext(text)
        ext = ext.lower()
        if not stem or ext not in cls.TYPES:
            raise ValueError(
                'Такой файл не прикрепить: можно PDF, Word (.doc, .docx), Excel (.xls, .xlsx), картинки JPG и PNG, '
                'чертежи DWG и DXF, архив ZIP и текст TXT'
            )
        stem = stem[: cls.NAME_MAX - len(ext)].rstrip(' .')
        return stem + ext, ext

    @classmethod
    def check_content(cls, name, ext, data) -> None:
        """Содержимое соответствует расширению — иначе ValueError с понятным текстом."""
        kind, what = cls.TYPES[ext][1], cls.TYPES[ext][2]
        bad = ValueError(
            f'Файл «{name}» по содержимому — не {what}. Сохраните его заново в своей программе (или в PDF) и прикрепите ещё раз'
        )
        head = data[:4096]
        if kind == 'pdf':
            ok = b'%PDF-' in data[:1024]
        elif kind == 'ole':
            ok = data.startswith(cls.OLE)
        elif kind in ('docx', 'xlsx', 'zip'):
            ok = data.startswith((b'PK\x03\x04', b'PK\x05\x06')) and cls._zip_ok(data, kind)
        elif kind == 'jpg':
            ok = data.startswith(b'\xff\xd8\xff')
        elif kind == 'png':
            ok = data.startswith(b'\x89PNG\r\n\x1a\n')
        elif kind == 'dwg':
            ok = re.match(rb'^AC[12][.\d]', head) is not None
        elif kind == 'dxf':
            ok = head.startswith(b'AutoCAD Binary DXF') or (
                b'\x00' not in head and re.match(rb'^\s*\d{1,4}[ \t]*\r?\n', head) is not None
            )
        else:
            ok = cls._text_ok(data)
        if not ok:
            raise bad
        if kind == 'zip':
            cls._zip_safe(name, data)

    @staticmethod
    def _zip_ok(data, kind) -> bool:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = z.namelist()
        except (zipfile.BadZipFile, OSError, ValueError, RuntimeError):
            return False
        if kind == 'docx':
            return 'word/document.xml' in names
        if kind == 'xlsx':
            return 'xl/workbook.xml' in names
        return True

    @classmethod
    def _ext(cls, name) -> str:
        """Расширение имени из архива так, как его увидит Windows: точки и пробелы в конце она отбрасывает («a.exe.» → .exe)."""
        return os.path.splitext(name.rstrip('/').rstrip(' .'))[1].lower()

    @classmethod
    def _zip_bad(cls, data, depth=0) -> list[str]:
        """Запрещённые имена в архиве; вложенный ZIP — на уровень глубже, прочие архивы внутри запрещены."""
        bad: list[str] = []
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                ext = cls._ext(info.filename)
                if ext in cls.ZIP_BAD or (
                    ext in cls.ARCHIVES and (ext != '.zip' or depth or info.file_size > cls.ZIP_INNER)
                ):
                    bad.append(info.filename)
                elif ext == '.zip':
                    try:
                        bad += cls._zip_bad(z.read(info), depth + 1)
                    except (zipfile.BadZipFile, RuntimeError, ValueError):
                        bad.append(info.filename)
        return bad

    @classmethod
    def _zip_safe(cls, name, data) -> None:
        bad = cls._zip_bad(data)
        if bad:
            raise ValueError(
                'В архиве «{}» есть программы, скрипты или страницы ({}) — такие файлы не прикрепляются. '
                'Уберите их из архива или прикрепите документы по одному'.format(
                    name, os.path.basename(bad[0].rstrip('/'))[:60]
                )
            )

    @classmethod
    def _text_ok(cls, data) -> bool:
        head = data[:65536]
        if head.startswith((b'\xff\xfe', b'\xfe\xff')):  # текст UTF-16 (Блокнот «Юникод»)
            return True
        if b'\x00' in head:
            return False
        head_low = head.lstrip(b'\xef\xbb\xbf \t\r\n').lower()
        return not head_low.startswith(cls.TEXT_BAD)

    def _kp_id(self, kid: str) -> str:
        if not self.KP_ID.match(str(kid or '')):
            raise ValueError('Недопустимый номер КП')
        return str(kid)

    def _dir(self, kid: str) -> str:
        return os.path.join(self.root, self._kp_id(kid))

    def _path(self, kid: str, disk) -> str:
        """Файл на диске по имени из базы: только своё имя (случайное) и только в папке этого КП."""
        if not self.DISK.match(str(disk or '')):
            raise ValueError('Неверная запись файла')
        path = os.path.join(self._dir(kid), disk)
        root = os.path.normcase(os.path.abspath(self.root)) + os.sep
        if not os.path.normcase(os.path.abspath(path)).startswith(root):
            raise ValueError('Неверная запись файла')
        return path

    COLS = ('id', 'name', 'file', 'size', 'mime', 'note', 'added', 'added_by', 'added_by_id')

    @staticmethod
    def _row(rec) -> dict:
        """Описание для ответа из строки таблицы {столбец: значение}."""
        return {
            'id': rec['id'],
            'name': rec['name'],
            'size': rec['size'] or 0,
            'mime': rec['mime'] or '',
            'note': rec['note'] or '',
            'added': rec['added'] or '',
            'by': rec['added_by'] or '',
            'ext': os.path.splitext(rec['name'])[1].lower().lstrip('.'),
        }

    def list(self, kid: str, uid: str | None = None) -> list[dict]:
        """Документы КП; у своих свежих файлов (uid — кто спрашивает) — undoUntil: до какого времени автор может удалить."""
        rows = self.store.all(
            'SELECT {} FROM kp_files WHERE kp_id=? ORDER BY id'.format(', '.join(self.COLS)), (self._kp_id(kid),)
        )
        out = []
        for row in rows:
            raw = dict(zip(self.COLS, row, strict=False))
            rec = self._row(raw)
            until = self.undo_until(raw, uid)
            if until:
                rec['undoUntil'] = until.isoformat(timespec='seconds')
            out.append(rec)
        return out

    def undo_until(self, rec, uid: str | None) -> datetime | None:
        """До какого времени автор uid может удалить свой документ d (строка таблицы) — или None, если не может."""
        minutes = SrvVal.get(self.store, 'kp.fileUndoMin')
        if not uid or not minutes or rec.get('added_by_id') != uid:
            return None
        try:
            until = datetime.fromisoformat(rec['added']) + timedelta(minutes=minutes)
        except (TypeError, ValueError):
            return None
        return until if datetime.now() < until else None

    def delete_own(self, kid: str, fid: str, uid: str) -> dict:
        """Автор удаляет свой документ в первые kp.fileUndoMin минут → прежнее описание."""
        rec = self._get(kid, fid)
        if not rec:
            raise LookupError('Документ не найден')
        if not self.undo_until(rec, uid):
            raise PermissionError(
                f'Удалить документ может его автор в первые {SrvVal.get(self.store, "kp.fileUndoMin")} мин после загрузки, '
                'позже — администратор'
            )
        rec = self.delete(kid, fid)
        if rec is None:
            raise LookupError('Документ не найден')
        return rec

    def counts(self, ids) -> dict:
        """Сколько документов у каждого КП из списка: {номер КП: число} (без документов — нет в ответе)."""
        want = {str(x) for x in ids if self.KP_ID.match(str(x or ''))}
        if not want:
            return {}
        if len(want) <= 500:
            rows = self.store.all(
                'SELECT kp_id, COUNT(*) FROM kp_files WHERE kp_id IN ({}) GROUP BY kp_id'.format(
                    ','.join('?' * len(want))
                ),
                sorted(want),
            )
        else:  # весь журнал (админка): одним запросом по всем КП с документами
            rows = self.store.all('SELECT kp_id, COUNT(*) FROM kp_files GROUP BY kp_id')
        return {k: count for k, count in rows if k in want}

    def _get(self, kid: str, fid: str) -> dict | None:
        row = self.store.one(
            'SELECT {} FROM kp_files WHERE kp_id=? AND id=?'.format(', '.join(self.COLS)), (self._kp_id(kid), int(fid))
        )
        return dict(zip(self.COLS, row, strict=False)) if row else None

    def get(self, kid: str, fid: str) -> dict | None:
        rec = self._get(kid, fid)
        return self._row(rec) if rec else None

    def _require(self, kid: str, fid) -> dict:
        found = self.get(kid, fid)
        if found is None:
            raise LookupError('Документ не найден')
        return found

    def read(self, kid: str, fid: str | int) -> tuple | None:
        """(описание, содержимое) или None — нет такой записи или файл пропал с диска."""
        rec = self._get(kid, fid)
        if not rec:
            return None
        path = self._path(kid, rec['file'])
        if not os.path.isfile(path):
            return None
        with open(path, 'rb') as handle:
            data = handle.read()
        return self._row(rec), data

    @classmethod
    def clean_note(cls, note) -> str:
        return re.sub(r'\s+', ' ', cls.BAD_CHARS.sub(' ', str(note or ''))).strip()[: cls.NOTE_MAX]

    def add(self, kid: str, name, data, note='', author: str = '', by_id='') -> dict:
        """Прикрепить файл к КП → описание. ValueError — понятным текстом (тип, размер, пределы КП)."""
        kid = self._kp_id(kid)
        name, ext = self.clean_name(name)
        lim = self.limits()
        if not data:
            raise ValueError(f'Файл «{name}» пустой')
        if len(data) > lim['fileMB'] * self.MEGABYTE:
            raise ValueError(
                'Файл «{}» — {} МБ, можно не больше {} МБ. Сожмите его (PDF — «уменьшить размер», картинки — меньше '
                'разрешение) или разделите на части'.format(name, self.megabytes(len(data)), lim['fileMB'])
            )
        self.check_content(name, ext, data)
        disk = uuid.uuid4().hex + ('.jpg' if ext == '.jpeg' else ext)
        path = self._path(kid, disk)
        tmp = path + '.part'
        with self.store.lock:
            usage, total = self.store.one('SELECT COUNT(*), COALESCE(SUM(size), 0) FROM kp_files WHERE kp_id=?', (kid,))
            if usage >= lim['filesMax']:
                raise ValueError(
                    f'У КП уже {usage} документов — больше {lim["filesMax"]} прикрепить нельзя. '
                    'Объедините часть в один PDF или архив ZIP'
                )
            if total + len(data) > lim['filesMB'] * self.MEGABYTE:
                raise ValueError(
                    'Документы КП вместе займут {} МБ — можно не больше {} МБ на одно КП'.format(
                        self.megabytes(total + len(data)), lim['filesMB']
                    )
                )
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(tmp, 'wb') as handle:
                    handle.write(data)
                os.replace(tmp, path)
                conn = self.store.conn()
                cur = conn.execute(
                    'INSERT INTO kp_files (kp_id, name, file, size, mime, note, added, added_by, added_by_id) '
                    'VALUES (?,?,?,?,?,?,?,?,?)',
                    (
                        kid,
                        name,
                        disk,
                        len(data),
                        self.TYPES[ext][0],
                        self.clean_note(note),
                        datetime.now().isoformat(timespec='seconds'),
                        str(author or '')[:120],
                        str(by_id or '')[:64] or None,
                    ),
                )
                conn.commit()
            except Exception:
                for x in (tmp, path):
                    try:
                        if os.path.isfile(x):
                            os.remove(x)
                    except OSError:
                        pass
                raise
        return self._require(kid, cur.lastrowid)

    def set_note(self, kid: str, fid: str, note) -> dict:
        if not self._get(kid, fid):
            raise LookupError('Документ не найден')
        self.store.write(
            'UPDATE kp_files SET note=? WHERE kp_id=? AND id=?', (self.clean_note(note), self._kp_id(kid), int(fid))
        )
        return self._require(kid, fid)

    def delete(self, kid: str, fid: str) -> dict | None:
        """Удалить документ (администратор или автор через delete_own — проверяет маршрут) → прежнее описание или None."""
        rec = self._get(kid, fid)
        if not rec:
            return None
        self.store.write('DELETE FROM kp_files WHERE kp_id=? AND id=?', (self._kp_id(kid), int(fid)))
        self._remove(kid, rec['file'])
        return self._row(rec)

    def _remove(self, kid: str, disk) -> None:
        try:
            path = self._path(kid, disk)
            if os.path.isfile(path):
                os.remove(path)
            folder = self._dir(kid)
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except (OSError, ValueError):
            pass

    def for_mail(self, kid: str, ids, already=0) -> builtins.list:
        """Выбранные документы для письма: [(имя, содержимое, тип)]; вместе с already байт (файл КП) — не больше kp.mailMB."""
        want = []
        for x in ids or []:
            try:
                want.append(int(x))
            except (TypeError, ValueError):
                raise ValueError('Неверный список документов') from None
        out, total = [], already
        for fid in dict.fromkeys(want):
            got = self.read(kid, fid)
            if not got:
                raise ValueError('Документ не найден — обновите окно письма')
            rec, data = got
            out.append((rec['name'], data, rec['mime'] or 'application/octet-stream'))
            total += len(data)
        lim = self.limits()['mailMB']
        if out and total > lim * self.MEGABYTE:
            raise ValueError(
                f'Вложения вместе — {self.megabytes(total)} МБ, почта клиента может не принять письмо больше {lim} МБ. Снимите галочки с части '
                'документов (их можно отправить вторым письмом)'
            )
        return out

    def purge(self) -> int:
        """Документы КП, которых нет ни в журнале, ни в корзине (удалены из корзины навсегда), — удалить с диска и из базы."""
        rows = self.store.all(
            'SELECT kp_id, id, file FROM kp_files WHERE kp_id NOT IN (SELECT id FROM kp) '
            "AND kp_id NOT IN (SELECT entity_id FROM trash WHERE entity_type='kp')"
        )
        for kid, fid, disk in rows:
            self.store.write('DELETE FROM kp_files WHERE id=?', (fid,))
            if self.KP_ID.match(str(kid or '')):
                self._remove(kid, disk)
        return len(rows)
