"""Нейросеть в программе (DeepSeek или совместимый API): настройка администратора, запрос, учёт расхода."""

import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime

from defaults import SrvVal
from net import Net

DEFAULT_BASE = 'https://api.deepseek.com'
MODELS = [
    ('deepseek-chat', 'DeepSeek-V3 (deepseek-chat) — быстро, рекомендуется'),
    ('deepseek-reasoner', 'DeepSeek-R1 (deepseek-reasoner) — рассуждает дольше, дороже'),
]
MAX_PROMPT = 60000
TIMEOUT = 180
SYSTEM = (
    'Ты — инженер компании-поставщика промышленного оборудования, готовишь технико-коммерческие предложения на русском языке. '
    'Отвечай строго одним JSON-объектом без пояснений и без markdown. Используй только факты из исходных данных и '
    'опубликованные данные производителя именно этой модели, в которых ты уверен. Не выводи значения по аналогии с другими '
    'моделями, не рассчитывай и не округляй; если данных нет или ты не уверен — оставляй пустую строку или пустой массив.'
)
LOCK = threading.Lock()
_RECENT: list[float] = []


def _now() -> str:
    return datetime.now().isoformat(timespec='seconds')


def settings(store) -> dict:
    conf = (store.kv_get('settings') or {}).get('ai') or {}
    return {
        'enabled': bool(conf.get('enabled')),
        'model': conf.get('model') or MODELS[0][0],
        'base': (conf.get('base') or DEFAULT_BASE).rstrip('/'),
        'updatedAt': conf.get('updatedAt') or '',
        'updatedBy': conf.get('updatedBy') or '',
    }


def api_key(store) -> str:
    return str(((store.kv_get('integrations') or {}).get('deepseekKey')) or '').strip()


def status(store) -> dict:
    """Для менеджеров: включено ли и есть ли ключ — без ключа и адреса."""
    conf = settings(store)
    prov = 'DeepSeek' if 'deepseek' in conf['base'] else 'OpenRouter' if 'openrouter' in conf['base'] else 'нейросеть'
    return {'enabled': conf['enabled'] and bool(api_key(store)), 'provider': prov, 'model': conf['model']}


def admin_view(store) -> dict:
    conf, k = settings(store), api_key(store)
    use = store.kv_get('aiUsage') or {}
    month = datetime.now().strftime('%Y-%m')
    return dict(
        conf,
        hasKey=bool(k),
        keyMask=(k[:4] + '…' + k[-4:]) if len(k) > 10 else ('задан' if k else ''),
        models=[{'id': i, 'name': name} for i, name in MODELS],
        usage=use.get(month) or {},
        usageMonth=month,
        usageAll=sorted(({'month': key, **v} for key, v in use.items()), key=lambda x: x['month'], reverse=True)[:12],
    )


def save(store, data: dict, author: str) -> dict:
    """Включение, модель, адрес; ключ — в kv «integrations»."""
    settings = store.kv_get('settings') or {}
    conf = dict(settings.get('ai') or {})
    if 'enabled' in data:
        if data['enabled'] and not (api_key(store) or data.get('key')):
            raise ValueError('Сначала укажите ключ API DeepSeek')
        conf['enabled'] = bool(data['enabled'])
    if data.get('model'):
        conf['model'] = str(data['model']).strip()[:80]
    if 'base' in data:
        base_url = str(data.get('base') or '').strip().rstrip('/')
        if base_url and not base_url.startswith('https://'):
            raise ValueError('Адрес API должен начинаться с https://')
        conf['base'] = base_url or DEFAULT_BASE
    if 'key' in data:
        keys = store.kv_get('integrations') or {}
        k = str(data.get('key') or '').strip()
        if k:
            keys['deepseekKey'] = k
        else:
            keys.pop('deepseekKey', None)
            conf['enabled'] = False
        store.kv_set('integrations', keys)
    conf['updatedAt'], conf['updatedBy'] = _now(), author
    settings['ai'] = conf
    store.kv_set('settings', settings)
    return admin_view(store)


def _count(store, usage: dict | None) -> None:
    with LOCK:
        use = store.kv_get('aiUsage') or {}
        month = datetime.now().strftime('%Y-%m')
        month_use = use.get(month) or {'requests': 0, 'tokensIn': 0, 'tokensOut': 0}
        month_use['requests'] += 1
        month_use['tokensIn'] += int((usage or {}).get('prompt_tokens') or 0)
        month_use['tokensOut'] += int((usage or {}).get('completion_tokens') or 0)
        use[month] = month_use
        store.kv_set('aiUsage', use)


def ask(store, prompt: str, force: bool = False) -> dict:
    """{text, usage, model}; RuntimeError — текст для пользователя."""
    conf, key = settings(store), api_key(store)
    if not force and not conf['enabled']:
        raise RuntimeError(
            'Нейросеть в программе выключена администратором — заполните через любой ИИ-чат (кнопки ниже)'
        )
    if not key:
        raise RuntimeError('Не задан ключ API DeepSeek — администратор указывает его в «Настройки → Нейросеть»')
    prompt = str(prompt or '').strip()
    if not prompt:
        raise RuntimeError('Пустой запрос')
    now = time.time()
    with LOCK:
        _RECENT[:] = [stamp for stamp in _RECENT if now - stamp < 60]
        if len(_RECENT) >= SrvVal.get(store, 'ai.rateMin'):
            raise RuntimeError('Слишком много запросов к нейросети за минуту — подождите немного и повторите')
        _RECENT.append(now)
    body = {
        'model': conf['model'],
        'temperature': SrvVal.get(store, 'ai.temperature'),
        'max_tokens': SrvVal.get(store, 'ai.maxTokens'),
        'stream': False,
        'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt[:MAX_PROMPT]}],
    }
    if 'reasoner' not in conf['model']:
        body['response_format'] = {'type': 'json_object'}
    try:
        j = json.loads(
            Net.request(
                conf['base'] + '/chat/completions',
                data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                method='POST',
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': 'Bearer ' + key,
                },
                timeout=TIMEOUT,
                limit=Net.LIMIT,
            ).decode('utf-8')
        )
    except urllib.error.HTTPError as exc:
        try:
            msg = (json.loads(exc.read().decode('utf-8', 'replace')).get('error') or {}).get('message') or ''
        except Exception:
            msg = ''
        known = {
            401: 'неверный ключ API — проверьте его в «Настройки → Нейросеть»',
            402: 'на балансе DeepSeek закончились деньги — пополните счёт на platform.deepseek.com',
            429: 'слишком много запросов — подождите минуту и повторите',
            503: 'сервис перегружен — повторите через минуту',
        }
        tail = f' — {msg[:200]}' if msg else ''
        raise RuntimeError('Нейросеть: ' + known.get(exc.code, f'ошибка {exc.code}{tail}')) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        why = str(getattr(exc, 'reason', exc))[:160]
        raise RuntimeError(
            f'Нейросеть недоступна: {why}. Проверьте интернет на компьютере-сервере или заполните через ИИ-чат'
        ) from exc
    except ValueError:
        raise RuntimeError(
            'Нейросеть ответила не данными, а страницей — сервис или адрес API недоступен, повторите позже'
        ) from None
    try:
        text = j['choices'][0]['message']['content'] or ''
    except (KeyError, IndexError, TypeError):
        raise RuntimeError('Нейросеть вернула пустой ответ — повторите') from None
    _count(store, j.get('usage'))
    return {'text': text, 'usage': j.get('usage') or {}, 'model': j.get('model') or conf['model']}
