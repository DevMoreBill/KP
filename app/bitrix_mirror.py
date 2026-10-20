"""Кабинет как Битрикс24: воронки Битрикса повторяются в программе (стадии — те же), поля сделки — в обе стороны."""

from typing import Any

from crm_funnels import DealFields, Funnels, UfValue


class BitrixMirror:
    """Повторённые воронки и поля сделки в обмене (BitrixSync): воронка ↔ воронка Битрикса, стадия ↔ стадия, поле ↔ поле."""

    PREFIX = 'uf:'
    LOST_REASON = 'lostReason'

    def __init__(self, store) -> None:
        self.store = store
        self.funnels = Funnels(store)
        self.fields = DealFields(store)
        self._defs: dict | None = None

    def defs(self) -> dict:
        """Поля, значения которых хранятся в программе: {код: описание} (читаются один раз за обмен)."""
        if self._defs is None:
            shown = set(self.fields.codes())
            self._defs = {code: field for code, field in self.fields.by_code().items() if code in shown}
        return self._defs

    def cat(self, deal) -> str | None:
        """Воронка Битрикса сделки повторённой воронки (или None — своя воронка программы)."""
        fid = deal.get('funnel') or Funnels.MAIN
        if fid == Funnels.MAIN:
            return None
        funnel = self.funnels.get(fid)
        return str(funnel['bx']) if funnel else None

    def funnel(self, cat) -> str | None:
        return self.funnels.of_bx(cat) if cat is not None else None

    def cats(self) -> list[str]:
        """Воронки Битрикса, которые опрашиваются (повторённые и не скрытые)."""
        return [str(row['bx']) for row in self.funnels.mirror() if not row.get('hidden')]

    def select(self) -> list[str]:
        return ['*', *self.defs()]

    def shared(self) -> list[str]:
        return [self.PREFIX + code for code in self.defs()]

    def field(self, key: str) -> dict | None:
        """Правило обмена поля «uf:код»: правится в программе — в обе стороны (последняя правка), иначе — только из Битрикса."""
        if not key.startswith(self.PREFIX):
            return None
        code = key[len(self.PREFIX) :]
        field = self.defs().get(code)
        if not field:
            return {'bx': code, 'dir': 'off', 'win': 'last', 'label': code, 'own': False}
        return {
            'bx': code,
            'dir': 'both' if field.get('type') in UfValue.EDIT else 'in',
            'win': 'last',
            'label': field.get('label') or code,
            'own': False,
        }

    def ours(self, deal) -> dict:
        values = deal.get('uf') or {}
        return {self.PREFIX + code: UfValue.norm(field, values.get(code)) for code, field in self.defs().items()}

    def theirs(self, bx_deal) -> dict:
        """Значения полей сделки Битрикса; поля, которых нет в ответе, не сравниваются (не считаются очищенными)."""
        return {
            self.PREFIX + code: UfValue.norm(field, bx_deal.get(code))
            for code, field in self.defs().items()
            if code in bx_deal
        }

    def uf_of(self, bx_deal) -> dict:
        return {key[len(self.PREFIX) :]: value for key, value in self.theirs(bx_deal).items()}

    def uf_back(self, back) -> dict:
        return {key[len(self.PREFIX) :]: value for key, value in back.items() if key.startswith(self.PREFIX)}

    def to_bx(self, key: str, value: Any) -> Any:
        if not key.startswith(self.PREFIX):
            return value
        field = self.defs().get(key[len(self.PREFIX) :])
        return UfValue.to_bx(field, value) if field else value

    def place(self, bx_deal) -> dict:
        """Новая сделка из повторённой воронки: воронка и стадия — как в Битриксе (причина провала — название стадии)."""
        fid = self.funnel(str(bx_deal.get('CATEGORY_ID') or '0'))
        if not fid:
            return {}
        stage = str(bx_deal.get('STAGE_ID') or '')
        if not self.funnels.resolve(fid, stage):
            stage = self.funnels.first(fid)
        return {'funnel': fid, 'stage': stage, self.LOST_REASON: ''}

    def stage_back(self, deal, stage: str, bx_deal, body: dict) -> bool:
        """Стадия из Битрикса для сделки повторённой воронки → body (воронка и стадия). False — не повторённая воронка."""
        cat = str((bx_deal or {}).get('CATEGORY_ID') or '') or None
        fid = self.funnel(cat) or (deal.get('funnel') if self.cat(deal) else None)
        if not fid:
            return False
        if not self.funnels.resolve(fid, stage):
            return True
        if fid != deal.get('funnel'):
            body['funnel'] = fid
        if 'funnel' in body or stage != (deal.get('fstage') or deal.get('stage')):
            body['stage'] = stage
        return True

    def stage_label(self, stage: str) -> str:
        for funnel in self.funnels.mirror():
            found = next((row for row in funnel['stages'] if row['key'] == stage), None)
            if found:
                return f'{found["label"]} ({funnel["name"]})'
        return ''
