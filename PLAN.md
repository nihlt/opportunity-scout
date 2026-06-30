# Opps Monitor — план змін

План поетапної перебудови проєкту під пітчинг. Кожен крок — окремий коміт.

Прийняті рішення:
- Усі користувачі дивляться на одну базу (`data/events.jsonl`) і бачать одне й те саме.
- Кожен користувач бачить тільки результати своїх команд — бот не розсилає нічого без причини.
- Push-дайджест (cron) існує паралельно, але на пітчингу демо йде на pre-scraped даних + кнопки.
- Інтерфейс бота без емодзі.
- Today = результати останнього запуску програми (`state.lastChanges.newEventIds`).
- Newest 10 = сортування за `firstSeenAt` DESC.
- Push-дайджест на пітчі = pre-scraped дані + кнопки (live scrape не потрібен).

---

## Крок 1 — Cleanup + lookaround-рефакторинг

**Мета:** прибрати мертвий код, спростити модель фільтрації під єдиний глобальний каталог, прибрати дублювання lookaround у `tag-keywords.json`.

### Що видалити
- `scripts/scrape-dou-ai.mjs` — legacy-обгортка, не імпортується ніде. npm-скрипт `scrape:dou-ai` вже вказує на `scripts/scrape-sources.mjs dou-ai`, тому файл нічого не робить.

### Спростити digest-фільтрацію
Зараз `config/user-template.json` містить `includeTags: ["AI", "NLP", "internship", "олімпіада"]`, що відсікає більшість подій (бо не всі мають ці теги). Для пітчу це погано — глядач має бачити весь каталог.

- У `config/user-template.json`:
  - `enabledSources` — порожній масив `[]` ( означає «всі дозволені»)
  - `includeTags` — порожній масив `[]` (показувати всі)
  - `excludeTags` — `[]`
  - `paymentMode` — `"free-or-free-tier"` (продуктова логіка: безкоштовні можливості для студентів; лишаємо як основну)
- Логіка `lib/digest-filters.mjs` вже коректно обробляє порожні множини (порожній `enabledSources`/`includeTags` = пропустити все) — змінювати код не треба, тільки конфіг.

### Рефакторинг lookaround у `tag-keywords.json`
Зараз одна й та сама обгортка `(?<![\p{L}\p{N}_])...(?![\p{L}\p{N}_])` дублюється для кожного короткого токена.

Новий формат — розділяємо `tokens` і `patterns`:

```json
[
  {
    "tag": "AI",
    "tokens": ["AI", "ШІ"],
    "patterns": [
      "artificial\\s+intelligence",
      "штучн\\p{L}*\\s+інтелект\\p{L}*"
    ]
  },
  {
    "tag": "NLP",
    "tokens": ["NLP"],
    "patterns": ["natural\\s+language\\s+processing"]
  },
  {
    "tag": "internship",
    "tokens": ["internship"],
    "patterns": ["стажуван\\p{L}*", "інтернатур\\p{L}*", "інтерншип\\p{L}*"]
  },
  {
    "tag": "олімпіада",
    "tokens": ["olympiad"],
    "patterns": ["олімпіад\\p{L}*"]
  }
]
```

Семантика:
- `tokens` — короткі слова/абревіатури, які треба шукати як окремі слова. Обгортку lookaround додає код автоматично: `(?<![\p{L}\p{N}_])${escape(token)}(?![\p{L}\p{N}_])` з прапором `iu`.
- `patterns` — довільні regex (фрази, морфологія), компілюються як є.

Зміни в `lib/scraper-runtime.mjs` (`compileRulePatterns`):
- якщо є `tokens` — згенерувати lookaround-патерни для кожного токена
- якщо є `patterns` — додати їх як є
- backward compat: якщо правило має тільки `patterns` (старий формат) — працює як раніше
- якщо має тільки `keywords` — лишаємо стару гілку `keywordRegex`

### Критерії прийняття
- `scripts/scrape-dou-ai.mjs` видалено, `npm run scrape:dou-ai` працює.
- `npm run collect` проходить, теги проставляються коректно (AI/NLP/internship/олімпіада знаходяться на тих самих подіях, що й раніше).
- `npm run digest:dry` показує всі події, а не лише з тегами AI/NLP.
- `tag-keywords.json` не містить дубльованого lookaround.

---

## Крок 2 — Завершити reframe scrapers

**Мета:** зробити так, щоб новий скрейпер додавався створенням одного файлу в `scrapers/` + рядка в `config/sources.json`, без правок оркестратора чи загальної ліби.

### Поточний стан
`lib/scraper-runtime.mjs` (1133 рядки) містить і спільні утиліти, і всю логіку парсингу конкретних сайтів:
- `scrapeDouCalendar()` (пагінація, деталі, кеш)
- `scrapeAinOpportunities()`
- `scrapeKaggleCompetitions()`
- `scrapeKseNews()`

Файли в `scrapers/*.mjs` — 10-рядкові адаптери, що делегують у цю лібу. Це напівфабрикат.

### Цільова архітектура

```
lib/scraper-runtime.mjs     ← тільки спільне: cleanText, дати, теги, keyword rules, helpers
scrapers/dou-calendar.mjs   ← повна логіка DOU (пагінація, деталі, кеш)
scrapers/ain-opportunities.mjs ← повна логіка AIN
scrapers/kaggle-competitions.mjs ← повна логіка Kaggle
scrapers/kse-news.mjs       ← повна логіка KSE
```

Що лишається в `lib/scraper-runtime.mjs` (спільне, експортується):
- `cleanText`, `uniqueStrings`, `hashText`
- `loadKeywordRules`, `tagsFromKeywords`, `locationsFromKeywords`
- `keywordRegex`, `compileRulePatterns` (після Кроку 1)
- утиліти дат: `parseNormalizedDate`, місяці (укр/ен), нормалізація дат
- `normalizeEvent()` — первинна нормалізація однієї події (дата, теги, локація, оплата, calendar link)
- `scrapeVisibleTextAndLinks()` — загальний збір тексту/посилань (використовується кількома scrapers)

Що переїжджає у відповідні `scrapers/*.mjs`:
- `scrapeDouCalendar()` + хелпери пагінації + кеш деталей DOU
- `scrapeAinOpportunities()` + хелпери AIN
- `scrapeKaggleCompetitions()` + `parseKagglePayment`, `cleanKaggleDeadline`, `isKaggleNonCashAwardLine`
- `scrapeKseNews()` + хелпери KSE

Кеш деталей DOU (`dou-event-details-cache.json`) — локальний стан scraper-модуля DOU, тому логіка кешу переїжджає в `scrapers/dou-calendar.mjs` (пути до `materials/` можна передавати через параметри або залишити як константу в модулі).

### Інтерфейс scraper-модуля (без змін)
```js
export async function scrape({ browser, page, source, helpers }) {
  return { visibleText, links, rawEvents, metadata };
}
```

`scrape-sources.mjs` не змінюється — він уже працює через `scraperModules[source.scraper]`.

### Додавання нового джерела (цитата з метою)
1. Створити `scrapers/<name>.mjs` з `export async function scrape(...)`.
2. Додати рядок у `config/sources.json` з `"scraper": "<name>"`.
3. Додати одну лінію в `scraperModules` у `scripts/scrape-sources.mjs` (єдине місце реєстрації — можна залишити і це, або зробити авто-імпорт за `source.scraper`, але авто-імпорт опціональний).

### Критерії прийняття
- `npm run collect` дає тотожно ті самі `events.jsonl`, що й до рефакторингу (порівняти `contentHash` подій).
- `lib/scraper-runtime.mjs` не містить функцій `scrape<Site>` — лише спільні утиліти.
- Кожен `scrapers/*.mjs` — самодостатній, імпортує тільки спільне з `lib/`.

---

## Крок 3 — Telegram-бот: polling + /start + 3 кнопки

**Мета:** long-running бот, який демо-глядачі можуть тикати на пітчі. Pre-scraped дані, без live scrape.

### Нові файли
```
scripts/telegram-bot.mjs       ← long-running polling бот
lib/telegram-queries.mjs       ← читання events.jsonl + state, фільтрація/сортування під кнопки
lib/telegram-format.mjs        ← formatters: compact і full
lib/telegram-keyboard.mjs      ← inline keyboard definitions
```

### Режим запуску
- `npm run bot` → `node scripts/telegram-bot.mjs`
- Один процес, long-running, polling через Telegram Bot API `getUpdates` (long polling).
- Без webhook, без HTTPS-сервера — достатньо для демо на ноуті.

### /start
Текст без емодзі:
```
Opps Monitor
Зібрано 117 можливостей з 6 джерел.
Останнє оновлення: 29 червня, 17:13

Кнопки:
[Today]  [Nearest 10]  [Newest 10]
```
(числа й дата беруться з `state.json`: `totalEvents`, кількість джерел, `lastNormalizeAt`.)

### Кнопки — точна семантика

| Кнопка | Логіка | Формат |
|--------|--------|--------|
| Today | Події з `state.lastChanges.newEventIds` (результати останнього запуску). Якщо порожньо — коротке повідомлення «Немає нових подій у останньому запуску. Спробуй Nearest 10.» | Full: title, date, source, link, calendar, опис |
| Nearest 10 | `dateNormalized >= today`, sort ASC by date, limit 10 | Compact: `N. Title` + link + calendar |
| Newest 10 | sort by `firstSeenAt` DESC, limit 10 | Compact: `N. Title` + link + calendar |

### Формати

**Full (Today):**
```
N. <a href="...">Title</a> | <a href="...">calendar</a>
Date: 2026-07-01
Source: DOU Calendar: AI
Tags: AI, хакатон
Short description (truncated)
```

**Compact (Nearest / Newest):**
```
N. <a href="...">Title</a> | <a href="...">calendar</a>
Date: 2026-07-01
```
Без опису, без тегів, без source-блоку — щоб влізло й читалось швидко.

### Розбиття на повідомлення
Робиться через існуючу логіку `splitMessages` (ліміт ~3600 символів, Telegram hard limit 4096). Для compact-формату 10 подій влізе в одне повідомлення з запасом. Для Today (full) — може бути кілька повідомлень.

### Дані
- Бот читає `data/events.jsonl` і `data/state.json` при кожному натисканні (117 рядків — миттєво).
- In-memory кеш не потрібен на MVP.

### Критерії прийняття
- `npm run bot` стартує, логує «Bot started, polling…».
- `/start` показує стартовий екран з 3 кнопками.
- Кожна кнопка повертає коректний список за своєю логікою.
- Бот реагує тільки на команди конкретного chat — іншим нічого не приходить.

---

## Крок 4 — UX: видалення минулих повідомлень бота

**Мета:** чат з ботом залишається чистим — при новій команді бот видаляє свої минулі повідомлення цьому користувачу, потім шле нові.

### Логіка
При кожному `/start` або натисканні кнопки:
1. Прочитати збережені message IDs бота для цього `chatId`.
2. Викликати `deleteMessage(chatId, messageId)` для кожного (ігнорувати помилки, якщо повідомлення вже видалене/старіше 48 годин).
3. Надіслати нові повідомлення-відповіді.
4. Зберегти нові message IDs для цього `chatId`.

### Зберігання
- In-memory `Map<chatId, number[]>` у процесі бота — достатньо для single-process демо.
- Опціонально (TODO post-pitch): файл `data/users/{chatId}/bot-messages.json` для персистентності між рестартами.

### Обмеження Telegram
- Бот може видаляти свої повідомлення у приватному чаті (до 48 годин).
- Якщо `deleteMessage` падає (повідомлення старе) — логувати warning і продовжувати, не ламати flow.

### Константа
Видалення повідомлень — це завжди лише повідомлення бота. Повідомлення користувача (текст команди) не чіпаємо.

### Критерії прийняття
- Після `/start` → Today → Nearest 10 у чаті лишається тільки результат Nearest 10 + (опційно) останнє стартове повідомлення.
- Бот не падає, якщо повідомлення вже видалене.
- Іншим користувачам нічого не приходить.

---

## Крок 5 (опційний, post-pitch) — Cron для daily pipeline

**Мета:** автоматичний щоденний scrape + push-дайджест без ручного запуску.

- GitHub Actions schedule (1–2 рази на день) або локальний cron.
- `npm run daily` = collect + digest.
- Push-дайджест надсилає нові події списку підписників (спочатку один chat ID з `.env`, потім масив).
- Per-user `sentTelegramEventIds` для дедуплікації (можна залишити глобальний state на MVP).

**Не входить у пітч-демо** — demо йде на pre-scraped даних.

---

## TODO (post-pitch, не в ці коміти)

- Per-user фільтри через бота (теги, джерела, платні/безкоштовні) — `data/users/{chatId}/config.json`.
- Кнопка «по дням» (календарний перегляд: кількість подій на день).
- Inline налаштування через бота.
- Авто-імпорт scrapers за `source.scraper` замість явного `scraperModules`.
- `tokens`/`patterns` backward-compat прибрати після стабілізації.
- Persistence message IDs для delete-between-restarts.
- README/документація.
- Тести.

---

## Підсумок комітів

| Коміт | Що |
|-------|----|
| 1 | Cleanup + lookaround-рефакторинг |
| 2 | Завершити reframe scrapers |
| 3 | Telegram-бот: polling + /start + 3 кнопки |
| 4 | UX: видалення минулих повідомлень бота |
| 5 (опц.) | Cron для daily pipeline |
