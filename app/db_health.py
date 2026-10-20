"""Проверка «здоровья» базы раз в неделю и по кнопке: целостность, категории, повторы, файлы КП."""

import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

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
