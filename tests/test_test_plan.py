# -*- coding: utf-8 -*-
"""Распределение проверок: части CI (run_all --shard) покрывают каждый набор ровно один раз и примерно равны по времени;
прогон по изменённому (progon --changed) берёт этапы раздела, вёрстка — и телефон, общее и неизвестное — все этапы."""
import glob
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'ui'))
import progon  # noqa: E402
import run_all  # noqa: E402


class ShardTest(unittest.TestCase):
    PARTS = 3
    SPREAD = 1.3  # самая долгая часть — не больше чем на 30 % дольше средней

    def test_every_suite_once_and_balanced(self):
        names = sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(HERE, 'test_*.py')))
        parts = [run_all.Shard('%d/%d' % (k, self.PARTS)).pick(names) for k in range(1, self.PARTS + 1)]
        self.assertEqual(sorted(sum(parts, [])), names)
        with open(run_all.Shard.TIMES, encoding='utf-8') as f:
            times = json.load(f)
        loads = [sum(times.get(n, run_all.Shard.DEFAULT) for n in part) for part in parts]
        self.assertLessEqual(max(loads), sum(loads) / self.PARTS * self.SPREAD, loads)

    def test_bad_spec(self):
        with self.assertRaises(SystemExit):
            run_all.Shard('4/3')


class PlanTest(unittest.TestCase):
    @staticmethod
    def plan(files):
        plan = progon.ProgonPlan.__new__(progon.ProgonPlan)
        plan.since, plan.files = 'v0', files
        return plan

    def test_section_js(self):
        plan = self.plan(['app/web/js/features/crm/cabinet.js'])
        self.assertEqual((plan.modes(), plan.stages()), (['pc'], ['cabinet', 'mirror', 'regs']))

    def test_section_css_adds_phone(self):
        plan = self.plan(['app/web/css/catalog.css'])
        self.assertEqual((plan.modes(), plan.stages()), (['pc', 'ph'], ['cat', 'editor', 'dbl']))

    def test_theme_and_common(self):
        plan = self.plan(['app/web/css/base.css'])
        self.assertEqual(plan.modes(), ['pc', 'ph', 'pcd', 'phd'])
        self.assertEqual(plan.stages(), list(progon.Modes.STAGES))

    def test_unknown_file_runs_all(self):
        self.assertEqual(self.plan(['app/web/js/features/new-section/x.js']).stages(), list(progon.Modes.STAGES))

    def test_nothing_changed(self):
        plan = self.plan([])
        self.assertEqual(plan.modes(), [])
        self.assertIn('не нужен', plan.text())


if __name__ == '__main__':
    unittest.main()
