# -*- coding: utf-8 -*-
"""Задача Планировщика Windows, которая запускает сервер отдела при включении компьютера (её создаёт
server-setup\\1. Установить сервер отдела.bat).

Задаче из «schtasks /Create» Планировщик ставит настройки не для сервера: останавливать её через 3 дня работы
(ExecutionTimeLimit PT72H), не запускать и останавливать при работе от батареи (так Windows видит и ИБП, когда пропало
питание), приоритет процесса ниже обычного. ServerTask при запуске сервера отдела проверяет задачу и исправляет её —
программа работает от имени SYSTEM, прав хватает; итог — kv serverTask, «Настройки → Система» и «Требует внимания».
Те же настройки задают установщики (Set-KPTask в install\\kp-common.ps1).
"""
import json
import os
import re
import subprocess
import threading
from datetime import datetime


class ServerTask:
    NAME = 'Конструктор КП — сервер отдела'      # как в Restarter.TASK и установщиках
    KV = 'serverTask'
    DELAY = 10           # проверка — через 10 с после запуска, не мешая подготовке программы
    TIMEOUT = 120        # PowerShell с модулем ScheduledTasks на медленном компьютере запускается до минуты
    PRIORITY = 5         # обычный (у задач по умолчанию — 7, ниже обычного)
    READ = ("$t = Get-ScheduledTask -TaskName '{name}' -ErrorAction SilentlyContinue; "
            "if (-not $t) {{ '{{\"exists\": false}}'; exit 0 }}; $s = $t.Settings; "
            "[pscustomobject]@{{exists = $true; limit = [string]$s.ExecutionTimeLimit; noBattery = [bool]$s.DisallowStartIfOnBatteries; "
            "stopBattery = [bool]$s.StopIfGoingOnBatteries; priority = [int]$s.Priority; restart = [int]$s.RestartCount}} | ConvertTo-Json -Compress")
    FIX = ("$s = (Get-ScheduledTask -TaskName '{name}').Settings; $s.ExecutionTimeLimit = 'PT0S'; "
           "$s.DisallowStartIfOnBatteries = $false; $s.StopIfGoingOnBatteries = $false; $s.Priority = {priority}; "
           "$s.RestartCount = 3; $s.RestartInterval = 'PT1M'; Set-ScheduledTask -TaskName '{name}' -Settings $s | Out-Null")

    def __init__(self, store):
        self.store = store

    @staticmethod
    def applicable(server_mode):
        return os.name == 'nt' and bool(server_mode)

    @staticmethod
    def duration(iso):
        """PT72H → «72 ч», P3D → «3 дн.» — срок из настроек задачи."""
        m = re.match(r'^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$', iso or '')
        if not m:
            return iso or ''
        d, h, mi = (int(x or 0) for x in m.groups())
        h += d * 24
        return ('%d ч' % h if h else '') + (' %d мин' % mi if mi else '') or iso

    @classmethod
    def problems(cls, s):
        """Что в настройках задачи мешает серверу отдела: [текст] (пусто — всё в порядке)."""
        out = []
        if s.get('limit') and s['limit'] != 'PT0S':
            out.append('останавливает программу через %s работы' % cls.duration(s['limit']).strip())
        if s.get('noBattery') or s.get('stopBattery'):
            out.append('не работает от батареи и ИБП')
        if int(s.get('priority') or 0) > 6:
            out.append('пониженный приоритет')
        return out

    def _ps(self, script):
        """PowerShell без окна → (код выхода, вывод, ошибки)."""
        cmd = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
               '[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; $ErrorActionPreference = "Stop"; ' + script]
        r = subprocess.run(cmd, capture_output=True, timeout=self.TIMEOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        def text(b):
            return (b or b'').decode('utf-8', 'replace').replace('﻿', '').strip()
        return r.returncode, text(r.stdout), text(r.stderr)

    def read(self):
        """Настройки задачи: {exists, limit, noBattery, stopBattery, priority, restart}."""
        code, out, err = self._ps(self.READ.format(name=self.NAME))
        line = next((x.strip().lstrip('\ufeff') for x in reversed(out.splitlines()) if x.strip().lstrip('\ufeff').startswith('{')), '')
        if code or not line:
            raise RuntimeError((err or out or 'PowerShell завершился с кодом %d' % code)[:300])
        return json.loads(line)

    @staticmethod
    def iso(ts):
        return datetime.fromtimestamp(ts).isoformat(timespec='seconds')

    def check(self, started):
        """Проверить задачу и при необходимости исправить; → запись kv serverTask (started — когда запущена программа)."""
        rec = {'at': datetime.now().isoformat(timespec='seconds'), 'started': self.iso(started), 'exists': False}
        try:
            s = self.read()
            rec['exists'] = bool(s.get('exists'))
            if rec['exists']:
                rec['settings'] = s
                if self.problems(s):
                    rec['before'] = s
                    code, out, err = self._ps(self.FIX.format(name=self.NAME, priority=self.PRIORITY))
                    rec['settings'] = self.read()
                    if self.problems(rec['settings']):
                        rec['error'] = (err or out or 'настройки не изменились')[:300]
                    else:
                        rec['fixed'] = rec['at']
        except Exception as e:              # нет PowerShell 3+, нет прав — показываем, программе не мешаем
            rec['error'] = str(e)[:300]
        prev = self.store.kv_get(self.KV) or {}
        if prev.get('fixed') and not rec.get('fixed'):
            rec['fixedBefore'] = prev['fixed']           # когда задачу уже исправляли — для «Системы»
        self.store.kv_set(self.KV, rec)
        return rec

    def start(self, started):
        t = threading.Timer(self.DELAY, self._safe_check, args=(started,))
        t.daemon = True
        t.start()
        return t

    def _safe_check(self, started):
        try:
            self.check(started)
        except Exception as e:
            from server_log import ServerLog
            ServerLog.failure('проверка задачи Планировщика', e)

    def status(self):
        """Для «Системы» и «Требует внимания»: запись проверки и что осталось исправить."""
        rec = self.store.kv_get(self.KV) or {}
        return dict(rec, problems=self.problems(rec.get('settings') or {})) if rec else None
