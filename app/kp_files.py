# -*- coding: utf-8 -*-
"""Справочные документы к КП: паспорта, сертификаты, схемы, опросные листы — хранятся вместе с КП, в документ КП не входят.

Файлы — на диске в папке данных: data/kp_files/<номер КП>/<случайное имя>.<расширение> (имя на диске выбирает программа,
путь из запроса не используется); описание — в таблице kp_files (миграция «2027-08-kp-files», app/storage.py): исходное имя
для показа и скачивания, размер, тип, примечание, кто и когда добавил.

Типы — по расширению и по содержимому (сигнатуре): PDF, Word, Excel, картинки JPEG и PNG, чертежи DWG и DXF, архив ZIP, текст.
Программы, страницы HTML, SVG и скрипты не принимаются (и внутри архива тоже). Пределы — «Настройки → Значения программы»
(kp.fileMB — файл, kp.filesMax и kp.filesMB — на одно КП, kp.mailMB — вложения письма клиенту).

Удаление файла — только администратор («Настройки → Сохранённые КП»). КП в корзине — файлы остаются (КП восстановится вместе
с ними); КП удалено из корзины навсегда — его файлы удаляет плановое обслуживание (purge).
"""
import io
import os
import re
import uuid
import zipfile
from datetime import datetime, timedelta

from defaults import SrvVal


class KpFiles:
    FOLDER = 'kp_files'
    MB = 1024 * 1024
    NAME_MAX = 150
    NOTE_MAX = 300
    KP_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
    DISK = re.compile(r'^[0-9a-f]{32}\.[a-z]{3,4}$')
    BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
    OLE = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'          # прежние Word и Excel (.doc, .xls)
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
    ZIP_BAD = ('.exe', '.com', '.bat', '.cmd', '.scr', '.msi', '.msp', '.dll', '.cpl', '.lnk', '.pif', '.js', '.jse', '.vbs',
               '.vbe', '.wsf', '.wsh', '.ps1', '.psm1', '.hta', '.jar', '.reg', '.html', '.htm', '.xhtml', '.svg', '.mht', '.url')
    TEXT_BAD = (b'<!doctype', b'<html', b'<script', b'<svg', b'<?xml', b'<head', b'<body', b'<iframe')

    def __init__(self, store, data_dir):
        self.store = store
        self.root = os.path.join(data_dir, self.FOLDER)

    @classmethod
    def of(cls, store):
        """Файлы КП этой базы: папка kp_files — рядом с файлом базы (data)."""
        return cls(store, os.path.dirname(os.path.abspath(store.path)))

    # ---------------------------------------------------------------- пределы
    def limits(self):
        return {'fileMB': SrvVal.get(self.store, 'kp.fileMB'), 'filesMax': SrvVal.get(self.store, 'kp.filesMax'),
                'filesMB': SrvVal.get(self.store, 'kp.filesMB'), 'mailMB': SrvVal.get(self.store, 'kp.mailMB')}

    @classmethod
    def mb(cls, n):
        x = n / cls.MB
        return ('%.1f' % x).replace('.', ',') if x < 10 else str(int(round(x)))

    # ---------------------------------------------------------------- имя и содержимое
    @classmethod
    def clean_name(cls, name):
        """Имя для показа и скачивания: без пути и запрещённых символов, не длиннее NAME_MAX → (имя, расширение)."""
        s = re.split(r'[\\/]', str(name or ''))[-1]
        s = re.sub(r'\s+', ' ', cls.BAD_CHARS.sub('', s)).strip().strip('.').strip()
        stem, ext = os.path.splitext(s)
        ext = ext.lower()
        if not stem or ext not in cls.TYPES:
            raise ValueError('Такой файл не прикрепить: можно PDF, Word (.doc, .docx), Excel (.xls, .xlsx), картинки JPG и PNG, '
                             'чертежи DWG и DXF, архив ZIP и текст TXT')
        stem = stem[:cls.NAME_MAX - len(ext)].rstrip(' .')
        return stem + ext, ext

    @classmethod
    def check_content(cls, name, ext, data):
        """Содержимое соответствует расширению — иначе ValueError с понятным текстом."""
        kind, what = cls.TYPES[ext][1], cls.TYPES[ext][2]
        bad = ValueError('Файл «%s» по содержимому — не %s. Сохраните его заново в своей программе (или в PDF) и прикрепите ещё раз'
                         % (name, what))
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
            ok = head.startswith(b'AutoCAD Binary DXF') or (b'\x00' not in head and re.match(rb'^\s*\d{1,4}[ \t]*\r?\n', head) is not None)
        else:
            ok = cls._text_ok(data)
        if not ok:
            raise bad
        if kind == 'zip':
            cls._zip_safe(name, data)

    @staticmethod
    def _zip_ok(data, kind):
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
    def _zip_safe(cls, name, data):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            bad = [n for n in z.namelist() if os.path.splitext(n.rstrip('/'))[1].lower() in cls.ZIP_BAD]
        if bad:
            raise ValueError('В архиве «%s» есть программы, скрипты или страницы (%s) — такие файлы не прикрепляются. '
                             'Уберите их из архива или прикрепите документы по одному' % (name, os.path.basename(bad[0].rstrip('/'))[:60]))

    @classmethod
    def _text_ok(cls, data):
        head = data[:65536]
        if head.startswith((b'\xff\xfe', b'\xfe\xff')):          # текст UTF-16 (Блокнот «Юникод»)
            return True
        if b'\x00' in head:
            return False
        h = head.lstrip(b'\xef\xbb\xbf \t\r\n').lower()
        return not h.startswith(cls.TEXT_BAD)

    # ---------------------------------------------------------------- папки
    def _kp(self, kid):
        if not self.KP_ID.match(str(kid or '')):
            raise ValueError('Недопустимый номер КП')
        return str(kid)

    def _dir(self, kid):
        return os.path.join(self.root, self._kp(kid))

    def _path(self, kid, disk):
        """Файл на диске по имени из базы: только своё имя (случайное) и только в папке этого КП."""
        if not self.DISK.match(str(disk or '')):
            raise ValueError('Неверная запись файла')
        f = os.path.join(self._dir(kid), disk)
        root = os.path.normcase(os.path.abspath(self.root)) + os.sep
        if not os.path.normcase(os.path.abspath(f)).startswith(root):
            raise ValueError('Неверная запись файла')
        return f

    # ---------------------------------------------------------------- список и запись
    COLS = ('id', 'name', 'file', 'size', 'mime', 'note', 'added', 'added_by', 'added_by_id')

    @staticmethod
    def _row(d):
        """Описание для ответа из строки таблицы {столбец: значение}."""
        return {'id': d['id'], 'name': d['name'], 'size': d['size'] or 0, 'mime': d['mime'] or '', 'note': d['note'] or '',
                'added': d['added'] or '', 'by': d['added_by'] or '', 'ext': os.path.splitext(d['name'])[1].lower().lstrip('.')}

    def list(self, kid, uid=None):
        """Документы КП; у своих свежих файлов (uid — кто спрашивает) — undoUntil: до какого времени автор может удалить."""
        rows = self.store.all('SELECT %s FROM kp_files WHERE kp_id=? ORDER BY id' % ', '.join(self.COLS), (self._kp(kid),))
        out = []
        for r in rows:
            d = dict(zip(self.COLS, r))
            rec = self._row(d)
            until = self.undo_until(d, uid)
            if until:
                rec['undoUntil'] = until.isoformat(timespec='seconds')
            out.append(rec)
        return out

    def undo_until(self, d, uid):
        """До какого времени автор uid может удалить свой документ d (строка таблицы) — или None, если не может."""
        minutes = SrvVal.get(self.store, 'kp.fileUndoMin')
        if not uid or not minutes or d.get('added_by_id') != uid:
            return None
        try:
            until = datetime.fromisoformat(d['added']) + timedelta(minutes=minutes)
        except (TypeError, ValueError):
            return None
        return until if datetime.now() < until else None

    def delete_own(self, kid, fid, uid):
        """Автор удаляет свой документ в первые kp.fileUndoMin минут → прежнее описание. LookupError — нет документа,
        PermissionError — чужой или время вышло."""
        d = self._get(kid, fid)
        if not d:
            raise LookupError('Документ не найден')
        if not self.undo_until(d, uid):
            raise PermissionError('Удалить документ может его автор в первые %d мин после загрузки, позже — администратор'
                                  % SrvVal.get(self.store, 'kp.fileUndoMin'))
        return self.delete(kid, fid)

    def counts(self, ids):
        """Сколько документов у каждого КП из списка: {номер КП: число} (без документов — нет в ответе)."""
        want = {str(x) for x in ids if self.KP_ID.match(str(x or ''))}
        if not want:
            return {}
        if len(want) <= 500:
            rows = self.store.all('SELECT kp_id, COUNT(*) FROM kp_files WHERE kp_id IN (%s) GROUP BY kp_id' % ','.join('?' * len(want)), sorted(want))
        else:            # весь журнал (админка): одним запросом по всем КП с документами
            rows = self.store.all('SELECT kp_id, COUNT(*) FROM kp_files GROUP BY kp_id')
        return {k: n for k, n in rows if k in want}

    def _get(self, kid, fid):
        r = self.store.one('SELECT %s FROM kp_files WHERE kp_id=? AND id=?' % ', '.join(self.COLS), (self._kp(kid), int(fid)))
        return dict(zip(self.COLS, r)) if r else None

    def get(self, kid, fid):
        d = self._get(kid, fid)
        return self._row(d) if d else None

    def read(self, kid, fid):
        """(описание, содержимое) или None — нет такой записи или файл пропал с диска."""
        d = self._get(kid, fid)
        if not d:
            return None
        f = self._path(kid, d['file'])
        if not os.path.isfile(f):
            return None
        with open(f, 'rb') as fh:
            data = fh.read()
        return self._row(d), data

    @classmethod
    def clean_note(cls, note):
        return re.sub(r'\s+', ' ', cls.BAD_CHARS.sub(' ', str(note or ''))).strip()[:cls.NOTE_MAX]

    def add(self, kid, name, data, note='', by='', by_id=''):
        """Прикрепить файл к КП → описание. ValueError — понятным текстом (тип, размер, пределы КП)."""
        kid = self._kp(kid)
        name, ext = self.clean_name(name)
        lim = self.limits()
        if not data:
            raise ValueError('Файл «%s» пустой' % name)
        if len(data) > lim['fileMB'] * self.MB:
            raise ValueError('Файл «%s» — %s МБ, можно не больше %s МБ. Сожмите его (PDF — «уменьшить размер», картинки — меньше '
                             'разрешение) или разделите на части' % (name, self.mb(len(data)), lim['fileMB']))
        self.check_content(name, ext, data)
        disk = uuid.uuid4().hex + ('.jpg' if ext == '.jpeg' else ext)
        f = self._path(kid, disk)
        tmp = f + '.part'
        with self.store.lock:
            n, total = self.store.one('SELECT COUNT(*), COALESCE(SUM(size), 0) FROM kp_files WHERE kp_id=?', (kid,))
            if n >= lim['filesMax']:
                raise ValueError('У КП уже %d документов — больше %d прикрепить нельзя. Объедините часть в один PDF или архив ZIP'
                                 % (n, lim['filesMax']))
            if total + len(data) > lim['filesMB'] * self.MB:
                raise ValueError('Документы КП вместе займут %s МБ — можно не больше %s МБ на одно КП'
                                 % (self.mb(total + len(data)), lim['filesMB']))
            try:
                os.makedirs(os.path.dirname(f), exist_ok=True)
                with open(tmp, 'wb') as fh:
                    fh.write(data)
                os.replace(tmp, f)
                c = self.store.conn()
                cur = c.execute('INSERT INTO kp_files (kp_id, name, file, size, mime, note, added, added_by, added_by_id) '
                                'VALUES (?,?,?,?,?,?,?,?,?)',
                                (kid, name, disk, len(data), self.TYPES[ext][0], self.clean_note(note),
                                 datetime.now().isoformat(timespec='seconds'), str(by or '')[:120], str(by_id or '')[:64] or None))
                c.commit()
            except Exception:
                for x in (tmp, f):
                    try:
                        if os.path.isfile(x):
                            os.remove(x)
                    except OSError:
                        pass
                raise
        return self.get(kid, cur.lastrowid)

    def set_note(self, kid, fid, note):
        if not self._get(kid, fid):
            raise LookupError('Документ не найден')
        self.store.write('UPDATE kp_files SET note=? WHERE kp_id=? AND id=?', (self.clean_note(note), self._kp(kid), int(fid)))
        return self.get(kid, fid)

    def delete(self, kid, fid):
        """Удалить документ (администратор или автор через delete_own — проверяет маршрут) → прежнее описание или None."""
        d = self._get(kid, fid)
        if not d:
            return None
        self.store.write('DELETE FROM kp_files WHERE kp_id=? AND id=?', (self._kp(kid), int(fid)))
        self._remove(kid, d['file'])
        return self._row(d)

    def _remove(self, kid, disk):
        try:
            f = self._path(kid, disk)
            if os.path.isfile(f):
                os.remove(f)
            folder = self._dir(kid)
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except (OSError, ValueError):
            pass

    # ---------------------------------------------------------------- письмо клиенту
    def for_mail(self, kid, ids, already=0):
        """Выбранные документы для письма: [(имя, содержимое, тип)]; вместе с already байт (файл КП) — не больше kp.mailMB."""
        want = []
        for x in ids or []:
            try:
                want.append(int(x))
            except (TypeError, ValueError):
                raise ValueError('Неверный список документов')
        out, total = [], already
        for fid in dict.fromkeys(want):
            got = self.read(kid, fid)
            if not got:
                raise ValueError('Документ не найден — обновите окно письма')
            rec, data = got
            out.append((rec['name'], data, rec['mime'] or 'application/octet-stream'))
            total += len(data)
        lim = self.limits()['mailMB']
        if out and total > lim * self.MB:
            raise ValueError('Вложения вместе — %s МБ, почта клиента может не принять письмо больше %s МБ. Снимите галочки с части '
                             'документов (их можно отправить вторым письмом)' % (self.mb(total), lim))
        return out

    # ---------------------------------------------------------------- обслуживание
    def purge(self):
        """Документы КП, которых нет ни в журнале, ни в корзине (удалены из корзины навсегда), — удалить с диска и из базы."""
        rows = self.store.all("SELECT kp_id, id, file FROM kp_files WHERE kp_id NOT IN (SELECT id FROM kp) "
                              "AND kp_id NOT IN (SELECT entity_id FROM trash WHERE entity_type='kp')")
        for kid, fid, disk in rows:
            self.store.write('DELETE FROM kp_files WHERE id=?', (fid,))
            if self.KP_ID.match(str(kid or '')):
                self._remove(kid, disk)
        return len(rows)
