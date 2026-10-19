# -*- coding: utf-8 -*-
"""Нейросеть прямо в программе (DeepSeek): автозаполнение карточки оборудования и элементов станции без чата в браузере.

• Включает и выключает администратор: «Настройки → Нейросеть» (kv «settings».ai = {enabled, model, base}).
  Выключено — в программе остаётся заполнение через любой ИИ-чат (копировать запрос / вставить ответ).
• Ключ API — kv «integrations».deepseekKey (как остальные ключи: только на сервере, в браузер не уходит,
  попадает в резервную копию ключей).
• Запрос: OpenAI-совместимый POST {base}/chat/completions, ответ — один JSON (response_format json_object).
  Подойдёт и другой сервис с таким же API (адрес и модель меняются в настройках).
• Расход — kv «aiUsage»: запросы и токены по месяцам (видно администратору).
"""
import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

from defaults import SrvVal
from net import Net

DEFAULT_BASE = 'https://api.deepseek.com'
MODELS = [('deepseek-chat', 'DeepSeek-V3 (deepseek-chat) — быстро, рекомендуется'),
          ('deepseek-reasoner', 'DeepSeek-R1 (deepseek-reasoner) — рассуждает дольше, дороже')]
MAX_PROMPT = 60000          # знаков в запросе (текст паспорта или ТЗ обрезается на клиенте до этого же предела)
TIMEOUT = 180
SYSTEM = ('Ты — инженер компании-поставщика промышленного оборудования, готовишь технико-коммерческие предложения на русском языке. '
          'Отвечай строго одним JSON-объектом без пояснений и без markdown. Используй только факты из исходных данных и '
          'опубликованные данные производителя именно этой модели, в которых ты уверен. Не выводи значения по аналогии с другими '
          'моделями, не рассчитывай и не округляй; если данных нет или ты не уверен — оставляй пустую строку или пустой массив.')
LOCK = threading.Lock()
# не больше 30 запросов в минуту на весь отдел (ai.rateMin): защита баланса от зацикливания и случайных повторов;
# «точность» (temperature, ai.temperature) и длина ответа (ai.maxTokens) — тоже «Настройки → Значения программы»
_RECENT = []


def _now():
    return datetime.now().isoformat(timespec='seconds')


def settings(store):
    a = ((store.kv_get('settings') or {}).get('ai') or {})
    return {'enabled': bool(a.get('enabled')), 'model': a.get('model') or MODELS[0][0], 'base': (a.get('base') or DEFAULT_BASE).rstrip('/'),
            'updatedAt': a.get('updatedAt') or '', 'updatedBy': a.get('updatedBy') or ''}


def api_key(store):
    return str(((store.kv_get('integrations') or {}).get('deepseekKey')) or '').strip()


def status(store):
    """Для менеджеров: можно ли заполнять напрямую (включено и есть ключ) — без ключа и адреса."""
    s = settings(store)
    prov = 'DeepSeek' if 'deepseek' in s['base'] else 'OpenRouter' if 'openrouter' in s['base'] else 'нейросеть'
    return {'enabled': s['enabled'] and bool(api_key(store)), 'provider': prov, 'model': s['model']}


def admin_view(store):
    s, k = settings(store), api_key(store)
    use = store.kv_get('aiUsage') or {}
    month = datetime.now().strftime('%Y-%m')
    return dict(s, hasKey=bool(k), keyMask=(k[:4] + '…' + k[-4:]) if len(k) > 10 else ('задан' if k else ''),
                models=[{'id': i, 'name': n} for i, n in MODELS], usage=use.get(month) or {}, usageMonth=month,
                usageAll=sorted(({'month': m, **v} for m, v in use.items()), key=lambda x: x['month'], reverse=True)[:12])


def save(store, d, by):
    """Админ: включить/выключить, модель, адрес; ключ — отдельно (в «integrations»). ValueError — понятным текстом."""
    st = store.kv_get('settings') or {}
    a = dict(st.get('ai') or {})
    if 'enabled' in d:
        if d['enabled'] and not (api_key(store) or d.get('key')):
            raise ValueError('Сначала укажите ключ API DeepSeek')
        a['enabled'] = bool(d['enabled'])
    if d.get('model'):
        a['model'] = str(d['model']).strip()[:80]
    if 'base' in d:
        b = str(d.get('base') or '').strip().rstrip('/')
        if b and not b.startswith('https://'):
            raise ValueError('Адрес API должен начинаться с https://')
        a['base'] = b or DEFAULT_BASE
    if 'key' in d:
        keys = store.kv_get('integrations') or {}
        k = str(d.get('key') or '').strip()
        if k:
            keys['deepseekKey'] = k
        else:
            keys.pop('deepseekKey', None)
            a['enabled'] = False
        store.kv_set('integrations', keys)
    a['updatedAt'], a['updatedBy'] = _now(), by
    st['ai'] = a
    store.kv_set('settings', st)
    return admin_view(store)


def _count(store, usage):
    with LOCK:
        use = store.kv_get('aiUsage') or {}
        m = datetime.now().strftime('%Y-%m')
        r = use.get(m) or {'requests': 0, 'tokensIn': 0, 'tokensOut': 0}
        r['requests'] += 1
        r['tokensIn'] += int((usage or {}).get('prompt_tokens') or 0)
        r['tokensOut'] += int((usage or {}).get('completion_tokens') or 0)
        use[m] = r
        store.kv_set('aiUsage', use)


def ask(store, prompt, force=False):
    """Запрос к нейросети: {'text': ответ (JSON строкой), 'usage': {...}, 'model': ...}. RuntimeError — текст для пользователя."""
    s, key = settings(store), api_key(store)
    if not force and not s['enabled']:
        raise RuntimeError('Нейросеть в программе выключена администратором — заполните через любой ИИ-чат (кнопки ниже)')
    if not key:
        raise RuntimeError('Не задан ключ API DeepSeek — администратор указывает его в «Настройки → Нейросеть»')
    prompt = str(prompt or '').strip()
    if not prompt:
        raise RuntimeError('Пустой запрос')
    now = time.time()
    with LOCK:
        _RECENT[:] = [t for t in _RECENT if now - t < 60]
        if len(_RECENT) >= SrvVal.get(store, 'ai.rateMin'):
            raise RuntimeError('Слишком много запросов к нейросети за минуту — подождите немного и повторите')
        _RECENT.append(now)
    body = {'model': s['model'], 'temperature': SrvVal.get(store, 'ai.temperature'), 'max_tokens': SrvVal.get(store, 'ai.maxTokens'), 'stream': False,
            'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt[:MAX_PROMPT]}]}
    if 'reasoner' not in s['model']:                 # у DeepSeek-R1 режима JSON нет — разбор ответа и так терпимый
        body['response_format'] = {'type': 'json_object'}
    try:
        j = json.loads(Net.request(s['base'] + '/chat/completions', data=json.dumps(body, ensure_ascii=False).encode('utf-8'), method='POST',
                                   headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + key},
                                   timeout=TIMEOUT, limit=Net.LIMIT).decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            msg = (json.loads(e.read().decode('utf-8', 'replace')).get('error') or {}).get('message') or ''
        except Exception:
            msg = ''
        known = {401: 'неверный ключ API — проверьте его в «Настройки → Нейросеть»', 402: 'на балансе DeepSeek закончились деньги — пополните счёт на platform.deepseek.com',
                 429: 'слишком много запросов — подождите минуту и повторите', 503: 'сервис перегружен — повторите через минуту'}
        raise RuntimeError('Нейросеть: ' + known.get(e.code, 'ошибка %s%s' % (e.code, (' — ' + msg[:200]) if msg else '')))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RuntimeError('Нейросеть недоступна: %s. Проверьте интернет на компьютере-сервере или заполните через ИИ-чат' % str(getattr(e, 'reason', e))[:160])
    except ValueError:      # вместо JSON — страница (прокси, заглушка провайдера): это ответ сервиса, а не ошибка запроса
        raise RuntimeError('Нейросеть ответила не данными, а страницей — сервис или адрес API недоступен, повторите позже')
    try:
        text = j['choices'][0]['message']['content'] or ''
    except (KeyError, IndexError, TypeError):
        raise RuntimeError('Нейросеть вернула пустой ответ — повторите')
    _count(store, j.get('usage'))
    return {'text': text, 'usage': j.get('usage') or {}, 'model': j.get('model') or s['model']}
