"""«Настройки» → фиды поставщиков: загрузка, проверка, «Обновить цены и остатки»."""

import re
from typing import Any

from admin_access import actor
from admin_base import AdminBase
from server_log import ErrorText


class AdminFeedsApi(AdminBase):
    """«Настройки» → фиды поставщиков: загрузка, проверка, «Обновить цены и остатки»."""

    PERCENT_MAX = 100

    def feed_update(self, method, fid: str, act: str, query, actor_login) -> None:
        """«Обновить цены» / «Обновить остатки» фида из файлов: черновик → список изменений → применение отмеченного."""
        import feeds
        from features import FEATURES, FeatureAccess
        from feed_update import FeedDraft, FeedUpdate, Scope

        if not FeatureAccess(self.store).is_on('feedUpdate'):
            return self.err(403, 'Функция «{}» выключена администратором'.format(FEATURES['feedUpdate'][1]))
        if method != 'POST':
            return self.err(405, 'Нужен POST')
        feed = feeds.feed_get(self.store, fid)
        if not feed or feed.get('kind') != 'files':
            return self.err(404, 'Фид из файлов не найден')
        if feeds.busy(fid):
            return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
        data_dir = feeds.DATA_DIR  # там же, где файлы фида
        try:
            if act == 'start':
                scope = Scope.of(self.data().get('scope'))
                draft = FeedDraft.start(data_dir, feed, scope)
                return self.ok({'token': draft.token, 'scope': scope.value})
            if act == 'file':  # тело — сам файл: ?token=…&name=…&slot=…
                draft = FeedDraft(data_dir, str(query.get('token') or ''))
                return self.ok(
                    draft.put(feed, str(query.get('name') or '')[:120], self.handler.body(), query.get('slot') or None)
                )
            data = self.data()
            draft = FeedDraft(data_dir, str(data.get('token') or ''))
            if act == 'cancel':
                draft.drop()
                return self.ok()
            if act == 'cur':
                draft.set_cur(feed, str(data.get('slot') or ''), str(data.get('cur') or ''))
                return self.ok()
            if act == 'move':
                return self.ok(draft.move(feed, str(data.get('slot') or ''), str(data.get('into') or '')))
            if not draft.info(feed)['files']:
                return self.err(400, 'Сначала выберите новый файл')
            if act == 'preview':
                return self.ok(FeedUpdate(self.store, feed, draft).preview())
            skip = [str(x)[:64] for x in data.get('skip') or [] if isinstance(x, str)]
            res = FeedUpdate(self.store, feed, draft).apply(skip, actor_login or 'администратор')
        except ValueError as exc:
            return self.err(400, str(exc))
        self.log(
            'check_feed',
            'catalog',
            'feed:' + fid,
            None,
            {
                'scope': res['scope'],
                'files': [rec['name'] for rec in res['files']],
                'applied': len(res['rows']),
                'skipped': res['skipped'],
            },
        )
        return self.ok(res)

    def feeds(self, method, sub, query, actor_login) -> None:
        import feeds
        from equipment_types import load_types

        store = self.store
        types = load_types()['types']
        if sub == 'feeds' and method == 'GET':
            return self.ok(
                {
                    'items': feeds.status(store),
                    'types': [
                        {'id': tdef.get('id'), 'name': tdef.get('name'), 'group': tdef.get('group')}
                        for tdef in types
                        if not tdef.get('hidden')
                    ],
                }
            )
        if sub == 'feeds' and method == 'POST':
            feed: Any = feeds.feed_save(store, self.data())
            self.log(
                'edit_settings',
                'settings',
                'feed:' + feed['id'],
                None,
                {'url': feed['url'] or feed.get('kind'), 'name': feed['name']},
            )
            return self.ok(feed)
        upd = re.match(r'^feeds/([a-z0-9-]{1,40})/update/(start|file|cur|move|preview|apply|cancel)$', sub)
        if upd:
            return self.feed_update(method, upd.group(1), upd.group(2), query, actor_login)
        match: Any = re.match(
            r'^feeds/([a-z0-9-]{1,40})/(preview|import|check|delete|log|status|upload|file|discounts|plan|loadplan|rebuild|purge|unblock)$',
            sub,
        )
        if not match:
            return self.err(404, 'Нет такого запроса')
        fid, act = match.group(1), match.group(2)
        feed = feeds.feed_get(store, fid)
        if not feed:
            return self.err(404, 'Фид не найден')
        if act == 'log':
            return self.ok({'items': feeds.log_of(store, fid)})
        if act == 'status':
            return self.ok({'job': feeds.JOBS.get(fid)})
        if (
            act == 'discounts'
        ):  # как сетка скидок разложится по позициям; в теле можно прислать ещё не сохранённую сетку
            data = self.data() if method == 'POST' else {}
            feed_copy = dict(feed)
            if isinstance(data.get('discounts'), list):
                feed_copy['discounts'] = feeds.discount_rules(data['discounts'])
            if isinstance(data.get('driveHints'), dict):
                feed_copy['driveHints'] = {k: str(data['driveHints'].get(k) or '')[:400] for k in ('belt', 'direct')}
            if 'discount' in data:
                x: Any = feeds.parse_number(data.get('discount'))
                feed_copy['discount'] = x if x and 0 < x < self.PERCENT_MAX else None
            return self.ok(feeds.discount_plan(store, feed_copy))
        if method != 'POST':
            return self.err(405, 'Нужен POST')
        if (
            act == 'loadplan'
        ):  # «Что загружать»: план «добавится / изменится / пропущено»; в теле — ещё не сохранённые настройки
            data = self.data()
            feed_copy = dict(feed)
            if isinstance(data.get('filter'), dict):
                feed_copy['filter'] = feeds.FeedRules.clean_filter(data['filter'])
            if isinstance(data.get('fields'), dict):
                feed_copy['fields'] = feeds.FeedRules.clean_fields(data['fields'])
            if isinstance(data.get('cats'), dict):
                feed_copy['cats'] = feeds._cats_ok(data['cats'])
            try:
                return self.ok(feeds.FeedRules.plan(store, feed_copy, types))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {ErrorText.of(exc)}')
        if act == 'upload':  # файл фида из файлов: ?kind=pages|price&name=имя, тело — сам файл
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            meta = feeds.feed_file_put(
                store, fid, query.get('kind', ''), self.handler.body(), query.get('name', ''), query.get('slot') or None
            )
            self.log(
                'edit_settings',
                'settings',
                'feed:' + fid,
                None,
                {'file': query.get('kind'), 'name': meta['name'], 'rows': meta.get('rows')},
            )
            return self.ok(meta)
        if act == 'file':  # файл фида из файлов: {kind, slot, act: drop | cur, cur, sheet}
            if feeds.busy(fid):
                return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
            data = self.data()
            x = feeds.feed_file_set(
                store,
                fid,
                str(data.get('kind') or ''),
                str(data.get('slot') or ''),
                str(data.get('act') or ''),
                str(data.get('cur') or ''),
                str(data.get('sheet') or ''),
            )
            self.log(
                'edit_settings',
                'settings',
                'feed:' + fid,
                None,
                {'file': data.get('kind'), 'slot': data.get('slot'), 'act': data.get('act'), 'cur': data.get('cur')},
            )
            return self.ok(x.get('files') or {})
        if act == 'delete':
            feeds.feed_delete(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'url': feed['url']}, None)
            return self.ok()
        if feeds.busy(fid):
            return self.err(409, 'Фид уже обрабатывается — дождитесь окончания')
        if act == 'purge':  # удалить позиции фида в корзину: {cat, preview, block}
            data = self.data()
            cat = str(data.get('cat') or '')[:80]
            if data.get('preview') is True:
                return self.ok(feeds.FeedPurge.preview(store, feed, cat))
            purge = feeds.FeedPurge.run_and_block if data.get('block') is not False else feeds.FeedPurge.run
            match = purge(store, feed, cat, actor(self.handler, True)[1])
            self.log(
                'delete_catalog', 'catalog', 'feed:' + fid, None, dict(match, feed=feed.get('name'), cat=cat or 'все')
            )
            return self.ok(match)
        if act == 'unblock':  # вернуть удалённые позиции фида в загрузку
            count = feeds.FeedPurge.unblock(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'excluded': count}, {'excluded': 0})
            return self.ok({'unblocked': count})
        if act == 'plan':  # фид из файлов: что сделает сборка каталога (без записи)
            try:
                return self.ok(feeds.plan_summary(store, feed))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {ErrorText.of(exc)}')
        if act == 'rebuild':  # разрешить сборку каталога заново (парс снова перестроит позиции производителя)
            feeds.feed_unbuild(store, fid)
            self.log('edit_settings', 'settings', 'feed:' + fid, {'built': True}, {'built': False})
            return self.ok()
        if act == 'preview':
            try:
                return self.ok(feeds.preview(store, feed, types))
            except Exception as exc:
                return self.err(422, f'Фид не загрузился: {ErrorText.of(exc)}')
        who = actor_login or 'администратор'
        if act == 'import':
            data = self.data()
            only = set(data.get('only') or []) or None
            feeds.run_bg(
                feeds.import_feed,
                store,
                feed,
                types,
                feeds.IMAGE_STORE,
                who,
                only,
                missing=feeds.Missing.TRASH if data.get('trashMissing') is True else feeds.Missing.KEEP,
            )
            self.log(
                'import_feed',
                'catalog',
                'feed:' + fid,
                None,
                {'url': feed['url'], 'only': len(only) if only else 'все'},
            )
        else:
            feeds.run_bg(feeds.check_feed, store, feed, who, types=types)
            self.log('check_feed', 'catalog', 'feed:' + fid, None, {'url': feed['url']})
        return self.ok({'job': feeds.JOBS.get(fid) or {'state': 'run', 'kind': act}})
