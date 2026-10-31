"""Сверка разметки двух прогонов интерфейса (KP_PROGON_DOM=1 tests/ui/progon.py кладёт .html рядом со снимками): по
каждому снимку — что исчезло и что появилось, без шума стенда и времени (версия и журнал версий, случайные номера, время и
даты, пути и порт стенда, место на диске, всплывающие сообщения и отметки «Сохранено», приветствие по времени суток).
Строки, совпавшие после этого, взаимно гасятся (перестановка — не отличие). Пустой итог — поведение и вёрстка прежние.

Запуск (из корня репозитория): python tests/ui/dom_compare.py БЫЛО СТАЛО [--modes pc,ph] [--lines 12]
БЫЛО и СТАЛО — папки прогонов (--out), режимы по умолчанию — все, что есть в обеих. Код выхода 1 — есть отличия."""

import argparse
import difflib
import os
import re
import sys
from collections import Counter


class DomCompare:
    """Сверка снимков одного режима и сводка по всем."""

    NOISE = (
        # журнал версий в «Руководстве» растёт с каждым выпуском; номер версии — в подписях и «Настройках»
        (re.compile(r'<h4>Версия \d+\.\d+\.\d+ <span class="muted">· [^<]*</span></h4><ul>.*?</ul>', re.S), ''),
        (re.compile(r'[Вв]ерси[яи] \d+\.\d+(?:\.\d+)?'), 'версия X'),
        (re.compile(r'<b( class="up-big")?>\d+\.\d+(?:\.\d+)?</b>'), r'<b\1>X</b>'),
        (re.compile(r'\?v=[0-9a-f]+'), '?v='),
        (re.compile(r'<script type="importmap">.*?</script>', re.S), '<script type="importmap"></script>'),
        # случайные номера позиций, вкладок, окон и строк
        (re.compile(r'data-kpu="[^"]*"'), 'data-kpu=""'),
        (re.compile(r'\b(?:item|it|kp|id)-[a-z0-9]{5,}\b'), 'ID'),
        (re.compile(r'\b[a-z0-9]{7}\b(?=["~])'), 'ID'),
        (re.compile(r'(data-drd|data-did|data-kid|data-tid|data-fid|data-dro)="[^"]*"'), r'\1="ID"'),
        (re.compile(r'(data-sq3d|data-dlmap)="[a-z0-9]+'), r'\1="ID'),
        (re.compile(r'(data-st3do?|data-stimg|data-h)="[0-9a-f]{6,}"'), r'\1="HASH"'),
        (re.compile(r' id="__[a-z0-9]+"'), ''),
        (re.compile(r'ID-\d{6}'), 'ID-HHMMSS'),
        # время, даты, картинки и размеры, вычисленные при показе
        (re.compile(r'\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b'), 'YYYY-MM-DD'),
        (re.compile(r'\b\d{1,2}:\d{2}(?::\d{2})?\b'), 'HH:MM'),
        (re.compile(r'\b\d{2}\.\d{2}\.\d{4}\b'), 'DD.MM.YYYY'),
        (re.compile(r'blob:[^"\s)]+'), 'blob:'),
        (re.compile(r'data:image[^"]*'), 'data:image'),  # до конца атрибута: в SVG внутри — скобки и пробелы
        (re.compile(r'\b\d+(?:\.\d+)?px\b'), 'Npx'),
        (re.compile(r' style="--k: [^"]*"'), ''),
        (re.compile(r' style=""'), ''),
        # стенд: адрес, порт, папки, место на диске
        (re.compile(r'127\.0\.0\.1:\d+'), '127.0.0.1:PORT'),
        (re.compile(r'<b>\d+(?:,\d+)? ГБ</b>'), '<b>N ГБ</b>'),
        (re.compile(r'\b\d+(?:,\d+)? КБ\b'), 'N КБ'),
        # обслуживание базы (сжатие и проверка) идёт ночью — у стенда, запущенного ночью, уже есть итог
        (re.compile(r'(<td>Сжатие и проверка</td>\s*<td>).*?(</td>)', re.S), r'\1…\2'),
        # мимолётное: всплывающее сообщение, отметки «Сохранено», совет кабинета при первом открытии, приветствие по
        # времени суток, шапка телефона, спрятанная прокруткой
        (re.compile(r'<div id="toast"[^>]*>.*?</div>', re.S), '<div id="toast"></div>'),
        (re.compile(r'<span class="saved"[^>]*>[^<]*</span>'), '<span class="saved"></span>'),
        (re.compile(r'<span class="dk-saved[^"]*"([^>]*)>[^<]*</span>'), r'<span class="dk-saved"\1></span>'),
        (re.compile(r'<div class="cab-tip" role="note">.*?</button></div>', re.S), ''),
        (re.compile(r'<h3>(?:Доброй ночи|Доброе утро|Добрый день|Добрый вечер)(?:, [^<!]*)?!</h3>'), '<h3>GREETING</h3>'),
        (re.compile(r'(<body[^>]*class="[^"]*?) top-hide'), r'\1'),
    )
    # строки, меняющиеся от стенда и времени работы: папки и адрес сервера, время работы, размер базы, журнал действий
    DROP = re.compile(
        r'/tmp/|http://vm:|мин \(с |ГБ из \d|\d МБ|"src": "/img/|"hash":|<pre>YYYY-|Товар [a-z0-9]{14}|'
        r'<pre>[a-z0-9]{14}</pre>'
    )

    def __init__(self, before: str, after: str, lines: int) -> None:
        self.before, self.after, self.lines = before, after, lines

    def norm(self, path: str) -> list[str]:
        """Разметка снимка без шума — по тегу на строку."""
        with open(path, encoding='utf-8', errors='replace') as src:
            text = src.read()
        for pattern, repl in self.NOISE:
            text = pattern.sub(repl, text)
        return re.sub(r'>\s*<', '>\n<', text).splitlines()

    def diff(self, old: list[str], new: list[str]) -> list[str]:
        """Исчезло (−) и появилось (+) — без перестановок и строк стенда."""
        rows = [line for line in difflib.unified_diff(old, new, lineterm='', n=0)
                if line[:1] in '+-' and line[:3] not in ('+++', '---')]
        gone = Counter(line[1:] for line in rows if line[0] == '-')
        came = Counter(line[1:] for line in rows if line[0] == '+')
        rest = ['-' + line for line in (gone - came).elements()] + ['+' + line for line in (came - gone).elements()]
        return [line for line in rest if not self.DROP.search(line)]

    def modes(self) -> list[str]:
        """Режимы, снятые в обоих прогонах."""
        def found(root: str) -> set[str]:
            shots = os.path.join(root, 'shots')
            return {name for name in os.listdir(shots) if os.path.isdir(os.path.join(shots, name))} if os.path.isdir(shots) else set()
        return sorted(found(self.before) & found(self.after))

    def mode(self, mode: str) -> int:
        """Сверка режима: печать отличий; ответ — число снимков с отличиями."""
        old_dir, new_dir = (os.path.join(root, 'shots', mode) for root in (self.before, self.after))
        olds = {name for name in os.listdir(old_dir) if name.endswith('.html')}
        news = {name for name in os.listdir(new_dir) if name.endswith('.html')}
        both = sorted(olds & news)
        found = {}
        for name in both:
            rest = self.diff(self.norm(os.path.join(old_dir, name)), self.norm(os.path.join(new_dir, name)))
            if rest:
                found[name] = rest
        print('== %s: снимков %d, с отличиями %d%s%s' % (
            mode, len(both), len(found),
            '; только было: ' + ', '.join(sorted(olds - news)) if olds - news else '',
            '; только стало: ' + ', '.join(sorted(news - olds)) if news - olds else ''))
        for name, rest in found.items():
            print('  -- %s: %d' % (name, len(rest)))
            for line in rest[:self.lines]:
                print('       ' + line[:220])
        return len(found) + len(olds ^ news)

    def run(self, modes: list[str]) -> int:
        total = sum(self.mode(mode) for mode in modes)
        print('ИТОГ: %s' % ('отличий нет' if not total else 'снимков с отличиями — %d' % total))
        return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('before', help='папка прежнего прогона (--out)')
    parser.add_argument('after', help='папка нового прогона (--out)')
    parser.add_argument('--modes', default='', help='режимы через запятую (по умолчанию — все, что есть в обоих)')
    parser.add_argument('--lines', type=int, default=12, help='сколько строк отличий показывать на снимок')
    args = parser.parse_args()
    compare = DomCompare(args.before, args.after, args.lines)
    modes = [mode for mode in args.modes.split(',') if mode] or compare.modes()
    if not modes:
        sys.exit('нет общих режимов: в папках прогонов нет shots/<режим>')
    sys.exit(1 if compare.run(modes) else 0)


if __name__ == '__main__':
    main()
