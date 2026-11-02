"""Шаблон КП «ПНЕВМОТЕХ НОВЫЙ» (templates/pnevmotekh_new, node tests/js/tpl_new.js): документ по скелету (skeleton.js) на
вымышленных КП — 1, 4, 9 и 13 позиций, опции, скидка, НДС 0 %, валюта, станция, графический редактор; титул — один лист,
форма редактора (editor.json) — только существующие настройки, Golos Text встроен в base.docx."""
import os
import shutil
import subprocess
import sys
import unittest

from kit import REPO


class TemplateNewJs(unittest.TestCase):
    def test_js(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('нет Node.js')
        r = subprocess.run([node, os.path.join(REPO, 'tests', 'js', 'tpl_new.js')], cwd=REPO, capture_output=True,
                           text=True, encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(r.returncode, 0, (r.stdout + r.stderr)[-6000:])


class TemplateNewFiles(unittest.TestCase):
    """Сервер раскладывает и отдаёт новый шаблон: картинки — допустимыми именами, свой скелет и форма — не заводские
    прежних версий (иначе программа сочла бы их своими и обновила бы)."""

    def test_served_names(self):
        sys.path.insert(0, os.path.join(REPO, 'app'))
        import kp_templates

        folder = os.path.join(REPO, 'templates', 'pnevmotekh_new')
        names = [n for n in os.listdir(folder) if n not in ('OFL-GolosText.txt',)]
        self.assertEqual([n for n in names if not kp_templates.TPL_FILES.match(n)], [])
        for name in kp_templates.SHARED_FILES:
            self.assertTrue(os.path.isfile(os.path.join(folder, name)), name)
            self.assertNotIn(kp_templates._norm_md5(os.path.join(folder, name)), kp_templates.OLD_FACTORY.get(name, ()), name)


if __name__ == '__main__':
    unittest.main()
