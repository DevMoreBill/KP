"""Проверка «здоровья» базы раз в неделю и по кнопке: целостность, категории, повторы, файлы КП."""

import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

from defaults import SrvVal
from storage import DbZip


class DbHealth:
    KV_KEY = 'health'
    EVERY_DAYS = 7
    SAMPLES = 8

    def __init__(self, store, data_dir: str | None = None, docs_dir: str | None = None) -> None:
        self.store, self.data_dir, self.docs_dir = store, data_dir, docs_dir

    def last(self) -> dict:
        v = self.store.kv_get(self.KV_KEY)
        return v if isinstance(v, dict) else {}

    def due(self) -> bool:
        stamp = self.last().get('at') or ''
        return not stamp or stamp < (datetime.now() - timedelta(days=self.EVERY_DAYS)).isoformat(timespec='seconds')

    def weekly(self) -> dict | None:
        return self.run() if self.due() else None

    def run(self) -> dict:
        started = time.time()
        res: dict[str, Any] = {
            'at': datetime.now().isoformat(timespec='seconds'),
            'integrity': DbZip.quick_check(self.store.path),
        }
        res['noCat'] = self._no_category()
        res['dups'] = self._duplicates()
        res['noFile'] = self._kp_without_file()
        res['seconds'] = round(time.time() - started, 1)
        self.store.kv_set(self.KV_KEY, res)
        return res

    def _types(self) -> set:
        from equipment_types import load_types

        return {item.get('id') for item in load_types().get('types') or [] if isinstance(item, dict)}

    def _no_category(self) -> dict:
        known = self._types()
        rows = [
            (cid, name, cat)
            for cid, name, cat in self.store.all('SELECT id, name, cat FROM catalog')
            if not cat or cat not in known
        ]
        return {
            'n': len(rows),
            'samples': [{'id': row, 'name': title or row, 'cat': k or ''} for row, title, k in rows[: self.SAMPLES]],
        }

    @staticmethod
    def _key(text) -> str:
        # пробелы и дефисы не важны, знаки в числах — важны: «7,5/8» и «75/8» — разные модели
        return re.sub(r'[\s\-_]+', '', str(text or '').lower().replace('ё', 'е').replace(',', '.'))

    def _duplicates(self) -> dict:
        """Одинаковое название основного оборудования в категории (не по модели: исполнения отличаются словами)."""
        from equipment_types import load_types

        main = {
            item.get('id')
            for item in load_types().get('types') or []
            if isinstance(item, dict) and item.get('role') != 'accessory'
        }
        groups: dict = {}
        for cid, name, cat in self.store.all('SELECT id, name, cat FROM catalog'):
            if cat in main and name:
                groups.setdefault((cat, self._key(name)), []).append({'id': cid, 'name': name})
        dup = [group for group in groups.values() if len(group) > 1]
        return {
            'n': sum(len(group) for group in dup),
            'groups': len(dup),
            'samples': [group[:3] for group in dup[: self.SAMPLES]],
        }

    def _kp_without_file(self) -> dict:
        rows = self.store.all('SELECT id, number, docx FROM kp WHERE meta IS NOT NULL')
        miss = []
        for kid, num, rel in rows:
            if not rel:
                miss.append((kid, num, 'не сохранён'))
            elif self.docs_dir and not os.path.isfile(
                os.path.join(self.docs_dir, *str(rel).replace('\\', '/').split('/'))
            ):
                miss.append((kid, num, 'файла нет в папке'))
        return {
            'n': len(miss),
            'samples': [{'id': k, 'number': number or k, 'why': who} for k, number, who in miss[: self.SAMPLES]],
        }

    def attention(self) -> list[dict]:
        """Пункты «Требует внимания» по последней проверке."""
        last = self.last()
        if not last:
            return []
        out = []
        if last.get('integrity') not in (None, 'ok'):
            out.append(
                {
                    'level': 'bad',
                    'text': f'Проверка базы: файл базы повреждён ({str(last["integrity"])[:120]}) — восстановите последнюю копию',
                    'tab': 'backup',
                    'key': 'health',
                    'alert': True,
                }
            )
        parts = []
        if (last.get('noCat') or {}).get('n'):
            parts.append(f'без категории — {last["noCat"]["n"]}')
        if (last.get('dups') or {}).get('groups'):
            parts.append(f'одинаковые названия — {last["dups"]["groups"]} групп')
        if (last.get('noFile') or {}).get('n'):
            parts.append(f'КП без файла Word — {last["noFile"]["n"]}')
        if parts:
            out.append(
                {
                    'level': 'info',
                    'text': f'Проверка базы {str(last.get("at") or "")[:10]}: {"; ".join(parts)}',
                    'tab': 'backup',
                }
            )
        return out


class NightCheck:
    """Ночная проверка базы (п. 16): размер, целостность, рост за сутки, последняя копия; утром — строка в «Главной»."""

    KV_KEY = 'nightCheck'
    HISTORY = 30
    PERCENT = 100
    MEGABYTE = 1024 * 1024

    def __init__(self, store, data_dir: str) -> None:
        self.store, self.data_dir = store, data_dir

    def history(self) -> list[dict]:
        rows = self.store.kv_get(self.KV_KEY)
        return rows if isinstance(rows, list) else []

    def run(self) -> dict:
        """Проверить сейчас и записать в историю (последние 30)."""
        import maintenance

        history = self.history()
        size = os.path.getsize(self.store.path)  # без файла -wal: его колебания — не рост базы
        copies = maintenance.DbCopy.listing(maintenance.auto_dir(self.data_dir))
        today = datetime.now().date().isoformat()
        prev = next((row['bytes'] for row in history if str(row.get('at') or '')[:10] < today), 0)
        res = {
            'at': datetime.now().isoformat(timespec='seconds'),
            'bytes': size,
            'growth': round((size - prev) / prev, 3) if prev else 0,
            'integrity': DbZip.quick_check(self.store.path),
            'lastCopy': copies[0]['date'] if copies else None,
        }
        self.store.kv_set(self.KV_KEY, [res, *history][: self.HISTORY])
        return res

    @classmethod
    def scheduled(cls, store, data_dir: str) -> dict | None:
        from features import FeatureAccess

        return cls(store, data_dir).run() if FeatureAccess(store).is_on('dbNight') else None

    def _problems(self, last: dict) -> list[str]:
        out = []
        if last.get('integrity') not in (None, 'ok'):
            out.append('файл базы повреждён — восстановите последнюю копию')
        if (last.get('growth') or 0) * self.PERCENT > SrvVal.get(self.store, 'srv.dbGrowthPct'):
            out.append(f'база выросла за сутки на {round(last["growth"] * 100)} %')
        copy_day = str(last.get('lastCopy') or '')
        stale = (datetime.now() - timedelta(days=SrvVal.get(self.store, 'srv.backupStaleDays'))).date().isoformat()
        if not copy_day or copy_day < stale:
            out.append('свежей копии нет' + (f' (последняя {copy_day})' if copy_day else ''))
        return out

    def attention(self) -> list[dict]:
        """Утренний отчёт: одна строка — всё в порядке или что не так."""
        history = self.history()
        if not history:
            return []
        last = history[0]
        problems = self._problems(last)
        size = f'{last["bytes"] / self.MEGABYTE:.1f} МБ'
        when = str(last.get('at') or '')[:16].replace('T', ' ')
        if problems:
            return [
                {
                    'level': 'bad',
                    'tab': 'backup',
                    'key': 'night',
                    'do': 'backup',
                    'text': f'Ночная проверка базы {when}: {"; ".join(problems)} · размер {size}',
                }
            ]
        growth = f' (+{round(last["growth"] * 100, 1)} % за сутки)' if last.get('growth') else ''
        return [
            {
                'level': 'info',
                'tab': 'backup',
                'key': 'night',
                'text': f'Ночная проверка базы {when}: в порядке · {size}{growth} · архив базы от {last.get("lastCopy")}',
            }
        ]
