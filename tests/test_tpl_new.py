"""Шаблон КП «ПНЕВМОТЕХ НОВЫЙ» (templates/pnevmotekh_new, node tests/js/tpl_new.js): документ по скелету (skeleton.js) на
вымышленных КП — 1, 4, 9 и 13 позиций, опции, скидка, НДС 0 %, валюта, станция, графический редактор; титул — один лист,
форма редактора (editor.json) — только существующие настройки, Golos Text встроен в base.docx."""
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
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
            self.assertNotIn(kp_templates._norm_md5(os.path.join(folder, name)),
                             kp_templates._old_factory('pnevmotekh_new', name), name)

    def test_own_factory_update(self):
        """Неизменённый заводской скелет прежней версии нового шаблона обновляется сам (прежний — в _history); копия, снятая с
        него, — нет: у копии нет своего заводского варианта, иначе она получила бы скелет основного шаблона."""
        sys.path.insert(0, os.path.join(REPO, 'app'))
        import kp_templates as kt

        def put(path, text):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(text)

        def read(path):
            with open(path, encoding='utf-8') as handle:
                return handle.read()

        with tempfile.TemporaryDirectory() as tmp:
            bundled, user = os.path.join(tmp, 'bundled'), os.path.join(tmp, 'user')
            for root, tid, skel in ((bundled, 'pnevmotekh', 'main'), (bundled, 'pnevmotekh_new', 'new-2'),
                                    (user, 'pnevmotekh', 'main'), (user, 'pnevmotekh_new', 'new-1'), (user, 'partner', 'new-1')):
                for name, text in (('skeleton.js', skel), ('editor.json', '{}'), ('template.json', '{}')):
                    put(os.path.join(root, tid, name), text)
            old = hashlib.md5(b'new-1', usedforsecurity=False).hexdigest()
            saved = kt.BUNDLED_DIR, kt.TEMPLATES_DIR, kt.OWN_FACTORY
            kt.BUNDLED_DIR, kt.TEMPLATES_DIR, kt.OWN_FACTORY = bundled, user, {'pnevmotekh_new': {'skeleton.js': (old,)}}
            try:
                kt.ensure_templates()
            finally:
                kt.BUNDLED_DIR, kt.TEMPLATES_DIR, kt.OWN_FACTORY = saved
            self.assertEqual(read(os.path.join(user, 'pnevmotekh_new', 'skeleton.js')), 'new-2')
            self.assertTrue(os.listdir(os.path.join(user, 'pnevmotekh_new', '_history')), 'прежний — в истории')
            self.assertEqual(read(os.path.join(user, 'partner', 'skeleton.js')), 'new-1', 'копия не получила чужой скелет')
            self.assertEqual(read(os.path.join(user, 'pnevmotekh', 'skeleton.js')), 'main')

    def test_released_skeleton_registered(self):
        """Скелет, выпущенный в 3.270.0, — в прежних заводских своего шаблона (у тех, кто поставил 3.270.0, обновится сам)."""
        sys.path.insert(0, os.path.join(REPO, 'app'))
        import kp_templates

        own = kp_templates.OWN_FACTORY['pnevmotekh_new']['skeleton.js']
        self.assertIn('db97a22a75af3fcebe3a8daacc0561aa', own)
        self.assertNotIn('db97a22a75af3fcebe3a8daacc0561aa', kp_templates.OLD_FACTORY['skeleton.js'], 'не в общем списке')


if __name__ == '__main__':
    unittest.main()
