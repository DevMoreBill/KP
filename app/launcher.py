"""Точка входа EXE: подключение пакета обновления (папка update) и возврат к прежней версии при сбое запуска."""

import importlib.abc
import importlib.util
import json
import os
import shutil
import sys
import time
import traceback
from datetime import datetime

import version


class _UpdateFinder(importlib.abc.MetaPathFinder):
    """Модули программы (app\\*.py) — из папки обновления, раньше встроенных в EXE."""

    def __init__(self, folder: str) -> None:
        self.folder = folder

    def find_spec(self, name, path=None, target=None):
        if '.' in name:
            return None
        file_path = os.path.join(self.folder, name + '.py')
        return importlib.util.spec_from_file_location(name, file_path) if os.path.isfile(file_path) else None


class Launcher:
    """Запуск программы: подключение обновления (патча) и возврат к прежней версии, если обновление не запустилось."""

    FAILED_LOG = 'update-failed.json'
    KEEP = 10
    TRIES = 10  # папку может ненадолго занять антивирус
    # KP_UPDATE_FALLBACK — этот EXE умеет откатиться: только тогда обновление проверяет себя (app_update.StartCheck)
    ENV = ('KP_UPDATE_DIR', 'KP_BASE_VERSION', 'KP_UPDATE_VERSION', 'KP_UPDATE_FALLBACK')

    def __init__(self) -> None:
        self.frozen = bool(getattr(sys, 'frozen', False))
        self.root = os.path.dirname(os.path.abspath(sys.executable if self.frozen else __file__))
        self.upd = os.path.join(self.root, 'update')
        self.finder: _UpdateFinder | None = None
        self.update_version = ''

    @staticmethod
    def dir_version(folder: str) -> str:
        try:
            with open(os.path.join(folder, 'version.json'), encoding='utf-8-sig') as file:
                return str(json.load(file).get('version') or '')
        except (OSError, ValueError, AttributeError):
            return ''

    @staticmethod
    def newer(v: str) -> bool:
        """Версия v новее встроенной в EXE (модуль version здесь — всегда встроенный)."""
        return bool(v) and version.as_tuple(v) > version.as_tuple(version.VERSION)

    def activate(self) -> bool:
        """Подключить обновление из папки update, если оно новее EXE. → True, если подключено."""
        upd_version = self.dir_version(self.upd)
        app = os.path.join(self.upd, 'app')
        if not (self.frozen and self.newer(upd_version) and os.path.isfile(os.path.join(app, 'kp_server.py'))):
            return False
        os.environ['KP_UPDATE_DIR'] = self.upd
        os.environ['KP_BASE_VERSION'] = version.VERSION  # версия, встроенная в EXE («Настройки → Обновления»)
        os.environ['KP_UPDATE_VERSION'] = upd_version
        os.environ['KP_UPDATE_FALLBACK'] = '1'
        self.finder = _UpdateFinder(app)
        sys.meta_path.insert(0, self.finder)
        sys.modules.pop('version', None)  # версия — тоже из обновления
        self.update_version = upd_version
        return True

    def run(self):
        if not self.activate():
            import kp_server

            return kp_server.main()
        try:
            import kp_server

            return kp_server.main()
        except Exception as exc:
            # после самопроверки (kp_server.STARTED) программа уже работала — это не сбой запуска обновления
            if getattr(sys.modules.get('kp_server'), 'STARTED', False):
                raise
            return self.fall_back(exc)

    # ---------- возврат к прежней версии
    def fall_back(self, exc: BaseException):
        rec = {
            'version': self.update_version,
            'exe': version.VERSION,
            'at': datetime.now().isoformat(timespec='seconds'),
            'reason': (f'{type(exc).__name__}: {exc}')[:600],
            'trace': traceback.format_exc()[-6000:],
        }
        self._unload()
        if not self._disable():
            self._message(
                'Обновление {} не запустилось, и отключить его не удалось (папка {} занята или нет прав).\n\n'
                'Причина: {}\n\nУдалите папку update рядом с программой и запустите программу снова — '
                'заработает версия {}.'.format(self.update_version, self.upd, rec['reason'], version.VERSION)
            )
            return 1
        rec['back'] = self._restore_prev() or version.VERSION
        self._record(rec)
        try:
            import config
            from app_update import Restarter  # встроенный в EXE: модули обновления уже выгружены

            Restarter(config.SERVER_MODE).spawn(browser=not os.environ.get('KP_NO_BROWSER'))
        except Exception as err:
            self._message(
                'Обновление {} не запустилось — программа вернулась к версии {}, но перезапустить себя не смогла: {}.\n\n'
                'Запустите программу ещё раз.'.format(self.update_version, rec['back'], err)
            )
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(0)  # сразу: фоновые задачи неудачной версии не должны пережить перезапуск

    def _unload(self) -> None:
        """Выгрузить модули обновления: дальше работают только встроенные в EXE."""
        if self.finder in sys.meta_path:
            sys.meta_path.remove(self.finder)
        top = os.path.normcase(os.path.join(self.upd, ''))
        for name, module in list(sys.modules.items()):
            path = getattr(module, '__file__', None) or ''
            if path and os.path.normcase(os.path.abspath(path)).startswith(top):
                sys.modules.pop(name, None)
        sys.modules['version'] = version
        for k in self.ENV:
            os.environ.pop(k, None)

    def _disable(self) -> bool:
        """update → update.failed (прежняя неудачная — удаляется)."""
        if not os.path.isdir(self.upd):
            return True
        failed = self.upd + '.failed'
        for _ in range(self.TRIES):
            try:
                if os.path.isdir(failed):
                    shutil.rmtree(failed)
                os.replace(self.upd, failed)
                return True
            except OSError:
                time.sleep(0.5)
        try:
            os.replace(os.path.join(self.upd, 'version.json'), os.path.join(self.upd, 'version.failed.json'))
            return True
        except OSError:
            return False

    def _restore_prev(self) -> str:
        """Предыдущее обновление (update.prev), если оно новее EXE, — снова в update. → его версия или ''."""
        prev = self.upd + '.prev'
        prev_version = self.dir_version(prev)
        if not self.newer(prev_version) or os.path.exists(self.upd):
            return ''
        try:
            os.replace(prev, self.upd)
            return prev_version
        except OSError:
            return ''

    def _record(self, rec: dict) -> None:
        path = os.path.join(self.root, self.FAILED_LOG)
        try:
            with open(path, encoding='utf-8') as file:
                recs = json.load(file)
            recs = recs if isinstance(recs, list) else []
        except (OSError, ValueError):
            recs = []
        recs = ([*recs, rec])[-self.KEEP :]
        try:
            with open(path + '.tmp', 'w', encoding='utf-8') as file:
                json.dump(recs, file, ensure_ascii=False, indent=1)
            os.replace(path + '.tmp', path)
        except OSError:
            pass

    @staticmethod
    def _message(text: str) -> None:
        """Окно — на компьютере; у сервера отдела рабочего стола нет, окно повесило бы запуск — только журнал."""
        try:
            import config

            if not config.SERVER_MODE:
                return config.MessageBox.error(text)
        except Exception:
            pass
        try:
            print(text, file=sys.stderr, flush=True)
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(Launcher().run())
