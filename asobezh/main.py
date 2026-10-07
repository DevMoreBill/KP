#!/usr/bin/env python3
"""Парсер каталога asobezh.ru.

Обходит 5 стартовых каталогов (каталог → подкаталоги → списки товаров с пагинацией →
карточки) и сохраняет товары в CSV (UTF-8, разделитель «;»).

Зависимости: pip install requests beautifulsoup4 lxml   (lxml необязателен)
Запуск:      python main.py [-o asobezh.csv] [--delay 1.0 2.5] [--limit N] [-v]
"""

import argparse
import csv
import logging
import random
import re
import sys
import time
from collections import deque
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://asobezh.ru"
START_URLS = [
    "https://asobezh.ru/catalog/porshnevye_kompressory/",
    "https://asobezh.ru/catalog/vintovye_kompressory/",
    "https://asobezh.ru/catalog/vozdushnye_resivery/",
    "https://asobezh.ru/catalog/podgotovka_vozdukha/",
    "https://asobezh.ru/catalog/apparaty_struynoy_ochistki/",
]
FIELDS = ["name", "url", "images", "schemes", "price", "description", "specs"]

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}
TIMEOUT = 30

IMAGE_RE = re.compile(r"\.(jpe?g|png|webp|gif|bmp|svg)(\?.*)?$", re.I)
FILE_RE = re.compile(r"\.(jpe?g|png|webp|gif|bmp|svg|pdf|dwg|dxf)(\?.*)?$", re.I)
SCHEME_WORDS = re.compile(r"схем|чертеж|чертёж|габарит|размер|scheme|drawing|dimension", re.I)
SKIP_IMG_WORDS = re.compile(r"logo|icon|sprite|placeholder|no[-_]?photo|noimage|banner|/bitrix/", re.I)
# Служебные части ссылок, по которым не ходим (фильтры, сортировки, корзина и т. п.)
SKIP_URL_WORDS = re.compile(r"/filter/|/compare|/basket|/order|/personal|/auth|/search|"
                            r"add2basket|action=|sort=|order=|display=|view=|/clear/", re.I)
# Параметры запроса, которые оставляем (пагинация Битрикс)
KEEP_QUERY = re.compile(r"^PAGEN_\d+$|^page$", re.I)

# Признаки карточки товара (разные шаблоны Битрикс/Аспро)
DETAIL_SELECTORS = [
    ".catalog_detail", ".product-detail", ".product-item-detail", ".bx-catalog-element",
    ".catalog-element", ".element-detail", ".product_detail", ".detail-product",
    "[id*='catalog_element']", "[class*='catalog-element-']", ".item_main_info",
    ".product-card-detail", ".product-container",
]
# Ссылки на товары в списке
ITEM_LINK_SELECTORS = [
    ".catalog_block .item-title a", ".catalog_item .item-title a", ".catalog_item a.thumb",
    ".product-item-title a", ".product-item a", ".catalog-section .item a",
    ".item_block .item-title a", "[itemtype*='schema.org/Product'] a[href]",
    ".catalog_list .item-title a", ".product-card a", ".products a", ".item-title a",
]
# Ссылки на подразделы
SECTION_LINK_SELECTORS = [
    ".catalog_section_list a", ".section_item a", ".sections_wrapper a",
    ".catalog-section-list a", ".bx_catalog_tile a", ".subsections a", ".item_block.lg a",
    ".section-list a", ".catalog-sections a",
]
PAGINATION_SELECTORS = [
    ".module-pagination a", ".bx-pagination a", ".pagination a", ".nums a", ".navigation a",
    "a[href*='PAGEN_']", ".ajax_load_btn", "[data-url*='PAGEN_']",
]

log = logging.getLogger("asobezh")


# ---------------------------------------------------------------- сеть

class Fetcher:
    """HTTP-сессия с повторами и вежливыми паузами между запросами."""

    def __init__(self, delay_min, delay_max):
        self.delay_min = delay_min
        self.delay_max = delay_max
        self._last = 0.0
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        retry = Retry(total=4, connect=4, read=4, status=4, backoff_factor=2,
                      status_forcelist=(429, 500, 502, 503, 504),
                      allowed_methods=("GET", "HEAD"), respect_retry_after_header=True)
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    def _pause(self):
        wait = random.uniform(self.delay_min, self.delay_max) - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def get_soup(self, url):
        """Загружает страницу; при ошибке пишет в журнал и возвращает (None, None)."""
        self._pause()
        try:
            resp = self.session.get(url, timeout=TIMEOUT)
        except requests.RequestException as exc:
            log.error("Ошибка запроса %s: %s", url, exc)
            return None, None
        if resp.status_code != 200:
            log.warning("HTTP %s: %s", resp.status_code, url)
            return None, None
        if "html" not in resp.headers.get("Content-Type", "html"):
            log.debug("Не HTML, пропуск: %s", url)
            return None, None
        if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
            resp.encoding = resp.apparent_encoding
        try:
            soup = BeautifulSoup(resp.text, "lxml")
        except Exception:  # lxml не установлен
            soup = BeautifulSoup(resp.text, "html.parser")
        return soup, resp.url


# ---------------------------------------------------------------- утилиты

def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_url(href, base):
    """Абсолютная ссылка без якоря и лишних параметров; None — если ссылка не наша."""
    if not href:
        return None
    href = href.strip()
    if href.startswith(("javascript:", "mailto:", "tel:", "#")):
        return None
    parts = urlsplit(urljoin(base, href))
    if parts.scheme not in ("http", "https"):
        return None
    base_parts = urlsplit(BASE_URL)
    if parts.netloc.lower().removeprefix("www.") != base_parts.netloc:
        return None
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if KEEP_QUERY.match(k)])
    return urlunsplit((base_parts.scheme, base_parts.netloc, parts.path or "/", query, ""))


def file_url(href, base):
    """Абсолютная ссылка на файл (картинку/PDF) — с любого домена, без якоря."""
    if not href or href.startswith(("data:", "javascript:")):
        return None
    url = urljoin(base, href.strip())
    return url.split("#")[0] if url.startswith("http") else None


def unique(seq):
    seen, out = set(), []
    for item in seq:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def element_text(el):
    """Текст блока с сохранением абзацев."""
    for br in el.find_all("br"):
        br.replace_with("\n")
    lines = []
    for chunk in el.get_text("\n").split("\n"):
        chunk = clean(chunk)
        if chunk:
            lines.append(chunk)
    return "\n".join(lines)


def find_tab(soup, words, scope=None):
    """Ищет содержимое вкладки/раздела, чей заголовок содержит одно из слов."""
    scope = scope or soup
    pattern = re.compile(words, re.I)
    for tag in scope.find_all(["a", "li", "span", "button", "div", "h2", "h3", "h4"], string=pattern):
        label = tag if tag.name in ("a", "button", "li") else (tag.find_parent(["a", "li", "button"]) or tag)
        for attr in ("href", "data-target", "data-href", "aria-controls", "data-tab", "data-value", "data-code"):
            val = label.get(attr) if hasattr(label, "get") else None
            if not val:
                continue
            target_id = val.split("#")[-1]
            if not target_id:
                continue
            target = soup.find(id=target_id) or soup.find(attrs={"data-value": target_id}) \
                or soup.find(attrs={"data-tab-content": target_id})
            if target and target is not label:
                return target
        # Заголовок раздела без вкладок: берём следующий за ним блок
        if tag.name in ("h2", "h3", "h4", "div", "span"):
            head = tag if tag.name.startswith("h") else tag.find_parent(["h2", "h3", "h4"])
            if head:
                sib = head.find_next_sibling()
                if sib:
                    return sib
    return None


# ---------------------------------------------------------------- классификация страниц

def detail_root(soup):
    for sel in DETAIL_SELECTORS:
        el = soup.select_one(sel)
        if el:
            return el
    return None


def is_product_page(soup):
    og = soup.find("meta", attrs={"property": "og:type"})
    if og and "product" in (og.get("content") or "").lower():
        return True
    if detail_root(soup) is not None:
        return True
    # Ровно одна разметка Product с ценой/характеристиками и без списка товаров
    products = soup.select("[itemtype*='schema.org/Product']")
    return len(products) == 1 and bool(products[0].select_one("[itemprop='offers'], [itemprop='additionalProperty']"))


def collect_links(soup, page_url, prefix):
    """Ссылки со страницы списка: подразделы, товары, пагинация (в пределах раздела)."""
    links = []
    selectors = SECTION_LINK_SELECTORS + ITEM_LINK_SELECTORS + PAGINATION_SELECTORS
    for sel in selectors:
        for a in soup.select(sel):
            links.append(a.get("href") or a.get("data-url") or a.get("data-href"))
    # Запасной вариант: все ссылки из основной части страницы
    main = soup.select_one("#content, .content, main, .main, .wrapper_inner") or soup
    for a in main.find_all("a", href=True):
        links.append(a["href"])
    out = []
    for href in links:
        url = normalize_url(href, page_url)
        if not url or SKIP_URL_WORDS.search(url) or FILE_RE.search(urlsplit(url).path):
            continue
        if urlsplit(url).path.startswith(prefix):
            out.append(url)
    return unique(out)


# ---------------------------------------------------------------- разбор карточки

def parse_name(soup, root):
    for el in (root.select_one("h1") if root else None, soup.select_one("h1"),
               soup.select_one("[itemprop='name']")):
        if el and clean(el.get_text()):
            return clean(el.get_text())
    og = soup.find("meta", attrs={"property": "og:title"})
    return clean(og.get("content")) if og else ""


def price_from_text(text):
    text = clean(text)
    if not text or re.search(r"запрос|уточн|звон|договор", text, re.I):
        return ""
    m = re.search(r"\d[\d\s  ]*(?:[.,]\d{1,2})?", text)
    if not m:
        return ""
    value = re.sub(r"[\s  ]", "", m.group(0)).replace(",", ".")
    try:
        number = float(value)
    except ValueError:
        return ""
    if number <= 0:
        return ""
    return str(int(number)) if number.is_integer() else f"{number:.2f}"


def parse_price(soup, root):
    scope = root or soup
    # 1) Явная подпись «Розничная цена»
    label = scope.find(string=re.compile(r"розничн", re.I))
    if label:
        block = label.find_parent(["tr", "div", "li", "p"])
        if block:
            price = price_from_text(block.get_text(" ").split(label.strip())[-1])
            if price:
                return price
    # 2) Микроразметка
    for el in scope.select("[itemprop='offers'] [itemprop='price'], [itemprop='price']"):
        price = price_from_text(el.get("content") or el.get_text())
        if price:
            return price
    # 3) Типовые классы цены
    for sel in (".price_value", ".price .price_val", ".product-item-detail-price-current",
                ".prices_block .price", ".cost .price", ".price-current", ".price"):
        el = scope.select_one(sel)
        if el:
            return price_from_text(el.get("data-value") or el.get_text(" "))
    return ""


def media_candidates(root, base):
    """Пары (url, подпись/контекст) для всех картинок и файлов в блоке."""
    out = []
    for a in root.find_all("a", href=True):
        url = file_url(a["href"], base)
        if url and FILE_RE.search(url):
            ctx = " ".join(filter(None, [a.get("title"), a.get("data-caption"), a.get_text(" ")]))
            out.append((url, ctx, a))
    for img in root.find_all("img"):
        src = (img.get("data-src") or img.get("data-lazy") or img.get("data-original")
               or img.get("data-big") or img.get("src"))
        url = file_url(src, base)
        if url and IMAGE_RE.search(url):
            ctx = " ".join(filter(None, [img.get("alt"), img.get("title")]))
            out.append((url, ctx, img))
    for el in root.select("[data-big], [data-zoom-image], [data-large], [data-fancybox][href]"):
        for attr in ("data-big", "data-zoom-image", "data-large"):
            url = file_url(el.get(attr), base)
            if url and IMAGE_RE.search(url):
                out.append((url, el.get("title") or "", el))
    return out


def in_scheme_context(el):
    """Лежит ли элемент во вкладке/блоке со схемами или чертежами."""
    for parent in el.parents:
        if parent.name in ("body", "html"):
            break
        attrs = " ".join([parent.get("id") or ""] + (parent.get("class") or []))
        if SCHEME_WORDS.search(attrs):
            return True
    return False


def parse_media(soup, root, base):
    scope = root or soup
    images, schemes = [], []
    scheme_tab = find_tab(soup, r"схем|чертеж|чертёж|габарит", scope)
    if scheme_tab:
        for url, _ctx, _el in media_candidates(scheme_tab, base):
            schemes.append(url)
    for url, ctx, el in media_candidates(scope, base):
        if SKIP_IMG_WORDS.search(url):
            continue
        if SCHEME_WORDS.search(ctx) or SCHEME_WORDS.search(url.rsplit("/", 1)[-1]) or in_scheme_context(el):
            schemes.append(url)
        elif IMAGE_RE.search(url) and "/upload/" in url:
            images.append(url)
    if not images:
        for meta in soup.find_all("meta", attrs={"property": "og:image"}):
            url = file_url(meta.get("content"), base)
            if url:
                images.append(url)
    schemes = unique(schemes)
    # Превью из resize_cache дублируют оригиналы — оставляем их, только если оригинала нет
    originals = {u.rsplit("/", 1)[-1] for u in images if "resize_cache" not in u}
    images = [u for u in unique(images)
              if u not in schemes and not ("resize_cache" in u and u.rsplit("/", 1)[-1] in originals)]
    return images, schemes


def parse_description(soup, root):
    scope = root or soup
    for sel in ("[itemprop='description']", ".detail_text", ".detail-text", "#desc",
                ".product-item-detail-tab-content[data-value='description']",
                ".tab-pane.desc", ".description", ".content-description"):
        el = scope.select_one(sel) or soup.select_one(sel)
        if el and clean(el.get_text()):
            return element_text(el)
    tab = find_tab(soup, r"^\s*описание", scope)
    if tab and clean(tab.get_text()):
        return element_text(tab)
    meta = soup.find("meta", attrs={"name": "description"})
    return clean(meta.get("content")) if meta else ""


def specs_from_block(block):
    pairs = []
    for prop in block.select("[itemprop='additionalProperty']"):
        name, value = prop.select_one("[itemprop='name']"), prop.select_one("[itemprop='value']")
        if name and value:
            pairs.append((clean(name.get_text()), clean(value.get("content") or value.get_text(" "))))
    if pairs:
        return pairs
    for tr in block.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) >= 2:
            pairs.append((clean(cells[0].get_text(" ")), clean(" ".join(c.get_text(" ") for c in cells[1:]))))
    for dl in block.find_all("dl"):
        for dt in dl.find_all("dt"):
            dd = dt.find_next_sibling("dd")
            if dd:
                pairs.append((clean(dt.get_text(" ")), clean(dd.get_text(" "))))
    if not pairs:
        for row in block.select("li, .prop, .char, .props_item, [class*='prop']"):
            name = row.select_one("[class*='name'], [class*='title'], .char_name")
            value = row.select_one("[class*='value'], [class*='val'], .char_value")
            if name and value and name is not value:
                pairs.append((clean(name.get_text(" ")), clean(value.get_text(" "))))
    return [(k.rstrip(":").strip(), v) for k, v in pairs if k and v]


def parse_specs(soup, root):
    scope = root or soup
    blocks = []
    for sel in ("#props", ".props_list", ".props_table", ".char_block", ".product-item-detail-properties",
                ".characteristics", ".char", ".specifications", "[class*='props']"):
        blocks.extend(scope.select(sel) or soup.select(sel))
    tab = find_tab(soup, r"характеристик", scope)
    if tab:
        blocks.insert(0, tab)
    for block in blocks:
        pairs = specs_from_block(block)
        if pairs:
            seen, out = set(), []
            for k, v in pairs:
                item = f"{k}: {v}".replace(";", ",")
                if item not in seen:
                    seen.add(item)
                    out.append(item)
            return "; ".join(out)
    return ""


def parse_product(soup, url):
    root = detail_root(soup)
    images, schemes = parse_media(soup, root, url)
    return {
        "name": parse_name(soup, root),
        "url": url,
        "images": ";".join(images),
        "schemes": ";".join(schemes),
        "price": parse_price(soup, root),
        "description": parse_description(soup, root),
        "specs": parse_specs(soup, root),
    }


# ---------------------------------------------------------------- обход

def crawl(fetcher, writer, out_file, limit=None):
    visited, saved = set(), set()
    count = 0
    for start in START_URLS:
        prefix = urlsplit(start).path
        queue = deque([normalize_url(start, BASE_URL)])
        log.info("Каталог: %s", start)
        while queue:
            url = queue.popleft()
            if url in visited:
                continue
            visited.add(url)
            soup, final_url = fetcher.get_soup(url)
            if soup is None:
                continue
            final_url = normalize_url(final_url, BASE_URL) or url
            visited.add(final_url)
            if final_url != normalize_url(start, BASE_URL) and is_product_page(soup):
                if final_url in saved:
                    continue
                try:
                    row = parse_product(soup, final_url)
                except Exception:
                    log.exception("Ошибка разбора карточки %s", final_url)
                    continue
                writer.writerow(row)
                out_file.flush()
                saved.add(final_url)
                count += 1
                log.info("[%d] %s | %s", count, row["name"] or "?", row["price"] or "без цены")
                if limit and count >= limit:
                    return count
                continue
            for link in collect_links(soup, final_url, prefix):
                if link not in visited:
                    queue.append(link)
            log.debug("Список %s, в очереди %d", final_url, len(queue))
    return count


def main():
    parser = argparse.ArgumentParser(description="Парсер каталога asobezh.ru → CSV")
    parser.add_argument("-o", "--output", default="asobezh.csv", help="файл результата (по умолчанию asobezh.csv)")
    parser.add_argument("--delay", nargs=2, type=float, default=(1.0, 2.5), metavar=("MIN", "MAX"),
                        help="пауза между запросами, сек (по умолчанию 1.0 2.5)")
    parser.add_argument("--limit", type=int, default=None, help="остановиться после N товаров (для проверки)")
    parser.add_argument("-v", "--verbose", action="store_true", help="подробный журнал")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    fetcher = Fetcher(*sorted(args.delay))
    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        try:
            total = crawl(fetcher, writer, f, args.limit)
        except KeyboardInterrupt:
            log.warning("Остановлено пользователем, собранное сохранено в %s", args.output)
            return 130
    log.info("Готово: %d товаров → %s", total, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
