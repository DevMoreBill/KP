"""Задача Планировщика Windows для сервера отдела: проверка и исправление настроек (без лимита, батареи, приоритета)."""

import json
import os
import re
import subprocess
import threading
from datetime import datetime
from typing import Any

from server_log import ErrorText


class ServerTask:
    PRIORITY_MAX = 6
    NAME = 'Конструктор КП — сервер отдела'  # как в Restarter.TASK и установщиках
    KV_KEY = 'serverTask'
    DELAY = 10
    TIMEOUT = 120
    PRIORITY = 5  # обычный; у задач по умолчанию — 7
    READ = (
        "$t = Get-ScheduledTask -TaskName '{name}' -ErrorAction SilentlyContinue; "
        'if (-not $t) {{ \'{{"exists": false}}\'; exit 0 }}; $s = $t.Settings; '
        '[pscustomobject]@{{exists = $true; limit = [string]$s.ExecutionTimeLimit; noBattery = [bool]$s.DisallowStartIfOnBatteries; '
        'stopBattery = [bool]$s.StopIfGoingOnBatteries; priority = [int]$s.Priority; restart = [int]$s.RestartCount}} | ConvertTo-Json -Compress'
    )
    FIX = (
        "$s = (Get-ScheduledTask -TaskName '{name}').Settings; $s.ExecutionTimeLimit = 'PT0S'; "
        '$s.DisallowStartIfOnBatteries = $false; $s.StopIfGoingOnBatteries = $false; $s.Priority = {priority}; '
        "$s.RestartCount = 3; $s.RestartInterval = 'PT1M'; Set-ScheduledTask -TaskName '{name}' -Settings $s | Out-Null"
    )

    def __init__(self, store) -> None:
        self.store = store

    @staticmethod
    def applicable(server_mode) -> bool:
        return os.name == 'nt' and bool(server_mode)

    @staticmethod
    def duration(iso: str) -> str:
        """PT72H → «72 ч»."""
        match = re.match(r'^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$', iso or '')
        if not match:
            return iso or ''
        days, hours, minutes = (int(x or 0) for x in match.groups())
        hours += days * 24
        return (f'{hours} ч' if hours else '') + (f' {minutes} мин' if minutes else '') or iso

    @classmethod
    def problems(cls, state: dict) -> list[str]:
        """Что в настройках задачи мешает серверу отдела."""
        out = []
        if state.get('limit') and state['limit'] != 'PT0S':
            out.append(f'останавливает программу через {cls.duration(state["limit"]).strip()} работы')
        if state.get('noBattery') or state.get('stopBattery'):
            out.append('не работает от батареи и ИБП')
        if int(state.get('priority') or 0) > cls.PRIORITY_MAX:
            out.append('пониженный приоритет')
        return out

    def _powershell(self, script: str) -> tuple[int, str, str]:
        """PowerShell без окна → (код выхода, вывод, ошибки)."""
        cmd = [
            'powershell.exe',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            '[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; $ErrorActionPreference = "Stop"; '
            + script,
        ]
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            timeout=self.TIMEOUT,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        return proc.returncode, self._text(proc.stdout), self._text(proc.stderr)

    @staticmethod
    def _text(raw: bytes | None) -> str:
        return (raw or b'').decode('utf-8', 'replace').replace('\ufeff', '').strip()

    def read(self) -> dict[str, Any]:
        """{exists, limit, noBattery, stopBattery, priority, restart}."""
        code, out, err = self._powershell(self.READ.format(name=self.NAME))
        line = next(
            (
                x.strip().lstrip('\ufeff')
                for x in reversed(out.splitlines())
                if x.strip().lstrip('\ufeff').startswith('{')
            ),
            '',
        )
        if code or not line:
            raise RuntimeError((err or out or f'PowerShell завершился с кодом {code}')[:300])
        return json.loads(line)

    @staticmethod
    def iso(stamp: float) -> str:
        return datetime.fromtimestamp(stamp).isoformat(timespec='seconds')

    def check(self, started: float) -> dict:
        """Проверить задачу и исправить при необходимости → запись kv serverTask."""
        rec: dict[str, Any] = {
            'at': datetime.now().isoformat(timespec='seconds'),
            'started': self.iso(started),
            'exists': False,
        }
        try:
            state = self.read()
            rec['exists'] = bool(state.get('exists'))
            if rec['exists']:
                rec['settings'] = state
                if self.problems(state):
                    rec['before'] = state
                    _code, out, err = self._powershell(self.FIX.format(name=self.NAME, priority=self.PRIORITY))
                    rec['settings'] = self.read()
                    if self.problems(rec['settings']):
                        rec['error'] = (err or out or 'настройки не изменились')[:300]
                    else:
                        rec['fixed'] = rec['at']
        except Exception as exc:  # нет PowerShell 3+ или прав — только показать
            rec['error'] = ErrorText.of(exc)[:300]
        prev = self.store.kv_get(self.KV_KEY) or {}
        if prev.get('fixed') and not rec.get('fixed'):
            rec['fixedBefore'] = prev['fixed']
        self.store.kv_set(self.KV_KEY, rec)
        return rec

    def start(self, started: float) -> threading.Timer:
        timer = threading.Timer(self.DELAY, self._safe_check, args=(started,))
        timer.daemon = True
        timer.start()
        return timer

    def _safe_check(self, started: float) -> None:
        try:
            self.check(started)
        except Exception as exc:
            from server_log import ServerLog

            ServerLog.failure('проверка задачи Планировщика', exc)

    def status(self) -> dict | None:
        """Запись проверки и что осталось исправить."""
        rec = self.store.kv_get(self.KV_KEY) or {}
        return dict(rec, problems=self.problems(rec.get('settings') or {})) if rec else None
