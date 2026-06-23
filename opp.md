Тип навчального закладу*

Університет
Повна назва навчального закладу *
Національний університет "Львівська Політехніка"
Місто навчального закладу *
Львів
Клас або курс навчання *
3
Спеціальність / Напрям підготовки

Комп'ютерні науки / CS
Факультет / Кафедра
Системи Штучного Інтелекту
Який AI-інструмент використовувався? *

Інший (вкажи нижче)
Надішли текст реального діалогу з AI-інструментом за останній місяць або посилання на shared chat.*
використовувався codex; даю лінк на експорт чату: 

Історія діалогу з Codex
Сесія розробки програми opps-monitor
——————————————————————————————
Джерело логу: rollout-2026-06-18T00-17-20-019ed772-1d2b-7693-a89e-6c559399b9f6.jsonl
Дата сесії: 17 червня 2026 року
Кількість раундів: 10 діалогів
Форматування: Конвертовано з Markdown у Word (.docx) | Шрифт Inter

Раунд 1 | Користувач
напиши скрипт, що 
1.	відкриває сайт https://dou.ua/calendar/tags/AI/ через браузер за допомогою playwright
2.	зберігає весь видимий текст з сайту в .txt файл в папку materials; список всіх посилань з текстом до якого вони підв'язані в json
3.	після збереження прочитай ці файли та створюєш .json з описом подій, знайдених на сторінці (назва, посилання, дата, опис, локація, оплата, теги)
Раунд 1 | Codex
Готово. Додав Playwright-скрипт scripts/scrape-dou-ai.mjs, package.json, package-lock.json і .gitignore.
Скрипт запускається так:
npm run scrape:dou-ai


Він відкриває https://dou.ua/calendar/tags/AI/ через Playwright і створює:
•	materials/dou-ai-visible-text.txt — весь видимий текст сторінки
•	materials/dou-ai-links.json — усі посилання з текстом anchor
•	materials/dou-ai-events.json — структурований список подій: назва, посилання, дата, опис, локація, оплата, теги
Перевірив запуск: скрипт успішно зібрав 20 подій.


Раунд 2 | Користувач
1.	переглянув файл. все правильно. чудово що додаєш метадані. додай ще дві сторінки (запусти для них повний pipeline):
а. https://dou.ua/calendar/tags/%D0%B7%D0%BC%D0%B0%D0%B3%D0%B0%D0%BD%D0%BD%D1%8F/
б. https://dou.ua/calendar/tags/%D1%85%D0%B0%D0%BA%D0%B0%D1%82%D0%BE%D0%BD/
далі. 
2.	створи один json файл що буде путівником, реєстром джерел: в ньому будуть назви всіх сайтів та посилання на сторіки, а також назви файлів, де зберігаєтся повний список про них + кількість івентів
3.	додай сайт https://university.kse.ua/university-news аналогічно до попередніх
Раунд 2 | Codex
Готово.
Переробив збирач у scripts/scrape-sources.mjs: тепер npm run scrape проходить повний pipeline для 4 джерел:
•	DOU AI: 20 подій
•	DOU змагання: 3 події
•	DOU хакатон: 1 подія
•	KSE University News: 21 запис
Створено реєстр джерел: materials/sources-registry.json. У ньому є назви джерел, URL сторінок, назви файлів з текстом/лінками/подіями, кількість івентів, кількість лінків і метадані збору.
Для нових сторінок створено повний набір файлів у materials/, наприклад:
•	dou-competitions-visible-text.txt, dou-competitions-links.json, dou-competitions-events.json
•	dou-hackathons-visible-text.txt, dou-hackathons-links.json, dou-hackathons-events.json
•	kse-university-news-visible-text.txt, kse-university-news-links.json, kse-university-news-events.json
Перевірив: JSON валідний, скрипти проходять node --check, повний запуск завершився успішно. Стару команду npm run scrape:dou-ai залишив сумісною для запуску тільки DOU AI.


Раунд 3 | Користувач
правильно. мені сподобалось, що поля "location" та "payment" записані як null. якщо в назві або короткому опису події зустрічається ШІ, AI, NLP, internship, інтернатура, олімпіада - додавай їх як теги.  йдемо далі. 
наступний сайт - https://ain.ua/search/?q=%22%D0%BC%D0%BE%D0%B6%D0%BB%D0%B8%D0%B2%D0%BE%D1%81%D1%82%D1%96+%D1%82%D0%B8%D0%B6%D0%BD%D1%8F%22
для нього сценарій такий:
1.	відкриваємо зазначене посилання
2.	шукаємо заголовки та зберігаємо посилання куди вони ведуть, наприклад "Навчання у Берклі, OSINT-інтенсив та грант на €75 тис. Можливості тижня" або "Безоплатне навчання для ШІ-архітекторів, міжнародний хакатон та гранти до €200 000. Можливості тижня"
3.	відкриваємо кожне посилання окремо та знову шукаємо заголовки, наприклад "Практичний інтенсив «Agent in a Day» про впровадження ШІ для компаній" або "OSINT-інтенсив від Molfar Intelligence Institute" та опис події.
4.	зберігаємо всю інформацію текстово та стоврюємо json файл.
для запезпечення уніфікованості з іншими подіями, використовуємо такі правила:
1.	в поле link ставимо посилання, що буде в кінці опису події. в кожній події, в кінці, є запис (або його варіація) "Детальніше — за посиланням.". за відсутності посилання або поля - вказуємо посилання на саму новину, де зустріли цю подію
2.	payment залишаємо null
3.	location - якщо зустрічається назва міста або країни - додаємо
4.	tags - news + аналогічно до kse з пошуком по тексту
створи відповідні файли, з ключовими словами, що використовуються для пошуку тегів або країни/міст
Раунд 3 | Codex
Готово.
Додав AIN pipeline у scripts/scrape-sources.mjs:
•	відкриває AIN search page;
•	знаходить дайджести “Можливості тижня”;
•	відкриває кожен дайджест окремо;
•	витягує вкладені можливості з h2-секцій;
•	бере кінцевий link з “Деталі/Детальніше — за посиланням”, інакше fallback на саму AIN-новину;
•	payment для AIN лишає null;
•	location бере зі словника міст/країн;
•	tags додає news + keyword-теги з назви/опису.
Додав конфіги:
•	data/tag-keywords.json
•	data/location-keywords.json
Створені AIN-файли:
•	materials/ain-opportunities-week-visible-text.txt
•	materials/ain-opportunities-week-links.json
•	materials/ain-opportunities-week-events.json
Оновив реєстр materials/sources-registry.json: зараз 5 джерел, 74 події, 693 посилання. AIN дав 29 подій з 6 відкритих дайджестів.
Додав команду:
npm run scrape:ain


Перевірив: повний npm run scrape працює, точковий scrape:ain більше не стирає інші джерела з реєстру.


Раунд 4 | Користувач
є проблема. 
зараз пошук тегів відбувається звичайним substring пошуком, що призводить до ситуацій, коли запис "Поїздка на виставку CES 2027 від Ajax Systems" отримує тег "AI" через слово "вишів", що означає ВНЗ, а не ШІ
1.	пропоную зробити пошук по регулярному виразу з negative lookaround
2.	також давай додамо фразу "artificial intelligence"
3.	додамо основи "штучн" та "інтелект", які мають зустрічатися в такому порядку, допускаючи закінчення слів і пробіли між ними (тут пошук за основою, тому що в укр. мові є відмінювання слів). тут не будемо оверінженерити, тому що розділення по тегам не є критичним функціоналом. negative lookaround не потрібен. negative lookaround для довгих слів не потрібен
4.	перевір, що запис «Поїздка на виставку CES 2027 від Ajax Systems» більше не має тегу AI
Раунд 4 | Codex
Виправив.
Тепер data/tag-keywords.json використовує regex patterns, а не substring-пошук. Для коротких токенів AI, ШІ, NLP, internship, olympiad стоять negative lookaround з Unicode-класами:
(?<![\p{L}\p{N}_])AI(?![\p{L}\p{N}_])
(?<![\p{L}\p{N}_])ШІ(?![\p{L}\p{N}_])


Також додано:
artificial\s+intelligence
штучн\p{L}*\s+інтелект\p{L}*


У scripts/scrape-sources.mjs тегові правила тепер компілюються як regex-и з прапорами iu.
Перезапустив повний pipeline:
npm run scrape


Перевірка конкретного запису пройшла: Поїздка на виставку CES 2027 від Ajax Systems тепер має тільки:
"tags": ["news"]


Позитивні випадки типу AI/GovTech Hackathon, Agent in a Day ... ШІ і KSE Agentic AI Summer School все ще отримують AI.


Раунд 5 | Користувач
добре, рухаємось далі. 
додаємо ще один лінк: https://www.kaggle.com/competitions?listOption=active%5C&participationFilter=open&hostSegmentIdFilter=1
1.	є проблема з датою: на самій сторінці пише "days to go", або "month to go". але, якщо вказівником навести на це місце на сторінці - то можна побачити дедлайн.
наприклад, для першого запису на сторінці "The Pokémon Company - PTCG AI Battle Challenge Strategy" буде показуватись "Deadline: 9/14/2026, 2:59:00 AM GMT+3". тобто задача тут - зберігати повну дату. 
а для п'ятого запису "5-Day AI Agents: Intensive Vibe Coding Course With Google" - "Deadline: 6/19/2026, 10:00:00 AM GMT+3"
інформацію про часовий пояс можна упустити, для нас це не важливо
2.	валідною оплатою вважати значення з числом і валютою, наприклад "$240,000". текстові нагороди на кшталт Knowledge, Kudos — null
Раунд 5 | Codex
Додав Kaggle як нове джерело в scripts/scrape-sources.mjs.
Створені файли:
•	materials/kaggle-competitions-visible-text.txt
•	materials/kaggle-competitions-links.json
•	materials/kaggle-competitions-events.json
Додав команду:
npm run scrape:kaggle


Для дедлайнів скрипт реально робить hover на to go/ago і читає tooltip Deadline: ...; timezone прибирається. Перевірені приклади:
•	The Pokémon Company - PTCG AI Battle Challenge Strategy: 9/14/2026, 2:59:00 AM, payment $240,000
•	5-Day AI Agents: Intensive Vibe Coding Course With Google: 6/19/2026, 10:00:00 AM, payment null
•	Knowledge / Kudos не записуються як payment і більше не потрапляють в description
Оновив повний pipeline: npm run scrape зараз збирає 6 джерел, у реєстрі materials/sources-registry.json тепер 94 події.


Раунд 6 | Користувач
Я б залишив поточне date як сирий текст із сайту, а поруч додав машинні поля: dateNormalized у форматі YYYY-MM-DD або YYYY-MM-DDTHH:mm:ss, dateEndNormalized для діапазонів і datePrecision (date, datetime, date_range, unknown). Так ми не втрачаємо оригінал, але отримуємо нормальне поле для сортування, фільтрації й дедлайнів. Для DOU-дати типу 18 червня можна брати рік зі scrapedAt; для Kaggle брати повний tooltip-дедлайн; для KSE англомовні дати парсити напряму; для AIN з діапазонів типу 16-18 червня робити start/end. Якщо щось не розпарсилось, залишаємо dateNormalized: null, але date все одно зберігає джерельне значення.
Раунд 6 | Codex
Готово. Додав у кожну подію три поля поруч із сирим date:
"dateNormalized": "2026-06-18",
"dateEndNormalized": null,
"datePrecision": "date"


Підтримано:
•	DOU 18 червня → рік береться зі scrapedAt
•	KSE 16 Jun 2026 → 2026-06-16
•	AIN 16-18 червня → dateNormalized: 2026-06-16, dateEndNormalized: 2026-06-18, datePrecision: date_range
•	Kaggle tooltip 9/14/2026, 2:59:00 AM → 2026-09-14T02:59:00
•	якщо не парситься → dateNormalized: null, dateEndNormalized: null, datePrecision: "unknown"
Перезапустив повний pipeline:
npm run scrape


Перевірив усі *-events.json: у всіх 94 подіях нові поля присутні. JSON валідний, mojibake не знайшов.


Раунд 7 | Користувач
•	Ідея така: те, що ми зараз збираємо з сайтів, варто залишити як “сирий шар”. Тобто всі materials/*-visible-text.txt,
  -links.json, -events.json і sources-registry.json не треба викидати чи замінювати. Вони корисні як доказ того, що
  саме ми побачили на сторінці, і як матеріал для дебагу, якщо якийсь парсер почне працювати неправильно.
  Поверх цього треба зробити другий шар - нормалізовану стрічку. У ньому всі записи з усіх джерел приводяться до однієї
  схеми: назва, посилання, дата або дедлайн, опис, локація, оплата, теги, джерело, час першого виявлення і час
  останнього виявлення. Це вже буде не “файл Kaggle” чи “файл AIN”, а єдиний список можливостей з усіх сайтів.
  Основним сховищем я б зробив data/events.jsonl, де кожен рядок - один запис. Це краще, ніж один великий JSON, бо такий
  файл простіше поповнювати, простіше читати частинами, легше фільтрувати, і менше шансів пошкодити весь файл при
  записі. Для зручності можна додатково генерувати data/events.current.json як читабельний snapshot поточного стану, але
  головним джерелом правди має бути JSONL.
  Ключова частина - стабільний id для кожної події. Його можна робити як hash від джерела, посилання і назви. Це
  дозволить зрозуміти, чи запис вже був раніше, чи це справді нова можливість. Для AIN це особливо важливо, бо кілька
  подій можуть бути знайдені в одній статті, тому одного посилання на статтю недостатньо.
  Окремо потрібен файл стану, наприклад data/state.json. У ньому можна зберігати, коли був останній запуск, які записи
  вже були надіслані в Telegram, коли пішов останній дайджест, і коротку статистику по джерелах. Це потрібно, щоб
  щоденне повідомлення не дублювало старі записи.
  Тоді pipeline виглядатиме просто: спочатку запускаємо scraping усіх сайтів, потім нормалізуємо всі materials/
  *-events.json в єдину стрічку, порівнюємо з попереднім станом, визначаємо нові або оновлені записи, формуємо дайджест
  і надсилаємо його в Telegram. Після успішної відправки оновлюємо state.json.
  Для перегляду локально база даних поки не потрібна. Можна зробити простий CLI, який читає events.jsonl і дозволяє
  фільтрувати записи по джерелу, тегу або пошуковому слову. Наприклад: показати всі Kaggle-змагання, всі записи з тегом
  AI, або все, де згадується internship.
  Тобто загальна структура така: materials/ залишається архівом і debug-шаром, data/events.jsonl стає єдиною нормальною
  стрічкою, data/state.json відповідає за історію запусків і Telegram, а окремі команди дозволяють або переглянути
  записи локально, або зібрати і надіслати щоденний дайджест.
Раунд 7 | Codex
Зробив другий шар поверх materials/, не чіпаючи сирий/debug-шар.
Додав:
•	scripts/normalize-events.mjs — збирає всі materials/*-events.json в єдину стрічку.
•	scripts/events-cli.mjs — локальний перегляд/фільтрація.
•	data/events.jsonl — основне нормалізоване сховище, 1 рядок = 1 подія.
•	data/events.current.json — читабельний snapshot.
•	data/state.json — стан запусків, статистика, new/updated/disappeared ids, Telegram-поля на майбутнє.
Додав npm-команди:
npm run normalize
npm run pipeline
npm run events -- --source kaggle-competitions
npm run events -- --tag AI
npm run events -- --search internship --limit 10


Стабільний id рахується як hash від sourceId + link + title, тому для AIN кілька подій з однієї статті не злипаються. firstSeenAt зберігається при повторних нормалізаціях, lastSeenAt оновлюється.
Перевірив: events.jsonl має 94 записи, повторний npm run normalize дає New: 0, updated: 0, disappeared: 0, CLI-фільтри працюють, JSON валідний.


Раунд 8 | Користувач
Поточний етап потрібно зафіксувати як завершений milestone перед переходом до Telegram.
Спочатку перевір поточний стан репозиторію, подивись git status і зроби акуратний commit з уже реалізованим scraping + normalization шаром.
Перед комітом:
1.	Додай materials/ у .gitignore, тому що це generated/debug output після запуску scraper-ів, а не source of truth для коду.
2.	Перевір, чи не треба також ігнорувати інші очевидні generated artifacts. Але не ігноруй:
•	data/tag-keywords.json
•	data/location-keywords.json
•	scripts/
•	package.json
•	package-lock.json
3.	Подумай щодо:
•	data/events.jsonl
•	data/events.current.json
•	data/state.json
   Якщо це локальний runtime state, краще не комітити їх як стабільні source-файли. Якщо потрібен приклад формату, додай невеликий example/template окремо, а runtime-файли залиш generated. Прийми прагматичне рішення і коротко поясни його.
4.	Не видаляй materials/ фізично, якщо це не потрібно. Достатньо додати його в .gitignore.
5.	Перевір, що коміт не включає node_modules/.
6.	Я вже створив .env. Перевір його наявність і структуру, але не показуй і не виводь значення секретів у логах або відповіді. Переконайся, що .env доданий у .gitignore.
Після цього зроби commit з повідомленням на кшталт:
Add scraping and normalized events pipeline
Після фіксації поточного етапу переходь до Telegram MVP.
Telegram MVP має бути push-only. Це не інтерактивний бот, не webhook і не long polling. Скрипт запускається локально на моєму ПК, читає нормалізовану стрічку, формує дайджест і надсилає повідомлення в мій Telegram chat.
Потрібна логіка:
1.	Конфіг через env vars:
•	TELEGRAM_BOT_TOKEN
•	TELEGRAM_CHAT_ID
   .env уже створений, тому спочатку переглянь його структуру й перевір, чи є там ці змінні. Не змінюй і не коміть реальні секрети. За потреби додай .env.example без значень.
2.	Додай скрипт, наприклад:
   scripts/send-telegram-digest.mjs
3.	Скрипт читає:
•	data/events.jsonl
•	data/state.json
4.	Надсилати тільки нові події:
•	брати newEventIds з state.lastChanges.newEventIds;
•	додатково перевіряти, що id ще немає в state.sentTelegramEventIds;
•	якщо нових подій немає, нічого не надсилати й вивести короткий лог у консоль.
5.	Сортування:
•	спочатку події з тегом AI;
•	потім усі інші нові;
•	всередині груп сортувати за dateNormalized;
•	записи без dateNormalized ставити нижче.
6.	Формат повідомлення:
•	компактний дайджест;
•	назва;
•	дата або дедлайн;
•	джерело;
•	теги;
•	оплата, якщо є;
•	короткий опис, обрізаний приблизно до 200–300 символів;
•	посилання.
   Враховуй ліміт Telegram на довжину повідомлення й розбивай дайджест на кілька повідомлень, якщо потрібно.
7.	Додай dry-run режим:
•	команда показує, що буде надіслано;
•	нічого не відправляє;
•	не оновлює data/state.json;
•	має працювати без TELEGRAM_BOT_TOKEN.
8.	Після успішної реальної відправки оновити data/state.json:
•	додати відправлені id у sentTelegramEventIds.
   Не позначай події як надіслані до успішної відправки всіх відповідних повідомлень.
9.	Додай npm-команди:
•	digest:dry
•	digest
•	daily
   daily має запускати:
   npm run scrape && npm run normalize && npm run digest
10.	Перевір:
•	dry-run працює без TELEGRAM_BOT_TOKEN;
•	реальний digest без потрібних env vars дає зрозумілу помилку;
•	значення секретів не потрапляють у консольні логи;
•	повторний digest не дублює вже надіслані події;
•	AI-події йдуть першими;
•	state.json оновлюється тільки після успішної відправки;
•	.env не потрапляє в git.
Наприкінці коротко опиши:
•	що потрапило в commit;
•	які файли додані або змінені для Telegram;
•	які npm-команди доступні;
•	результати dry-run і реальної перевірки, не показуючи секретів.
Раунд 8 | Codex
Milestone зафіксовано.
Commit:
ea7653e Add scraping and normalized events pipeline


У commit потрапили scraping + normalization source-файли, npm-конфіг, keyword-конфіги й example-файли форматів. Не потрапили: .env, materials/, node_modules/, data/events.jsonl, data/events.current.json, data/state.json.
Рішення по runtime-файлах: data/events.jsonl, data/events.current.json, data/state.json залишив generated/local state, бо там живуть локальні timestamps, Telegram sent-state і поточний runtime snapshot. Для формату додав:
•	data/events.example.jsonl
•	data/events.current.example.json
•	data/state.example.json
Telegram MVP додано після commit як uncommitted changes:
•	.env.example
•	scripts/send-telegram-digest.mjs
•	package.json scripts
Доступні команди:
npm run digest:dry
npm run digest
npm run daily


daily запускає:
npm run scrape && npm run normalize && npm run digest


Перевірки:
•	.env існує, має TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID; значення не виводив.
•	.env у .gitignore.
•	materials/, node_modules/, runtime data/events*.json* і data/state.json ignored.
•	digest:dry працює без token.
•	missing env на example input дає помилку: Missing Telegram env var(s): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
•	failure не змінює state.
•	AI-події сортуються першими.
•	поточний npm run digest нічого не відправив, бо state.lastChanges.newEventIds зараз порожній: No new Telegram digest events to send.


Раунд 9 | Користувач
Додай режим ручного тестового відправлення Telegram digest для перевірки останніх N подій.
Потрібна команда з параметром, наприклад --last N, яка бере останні N записів із нормалізованих подій та відправляє їх у Telegram незалежно від поточного state.
За замовчуванням такий запуск вважається тестовим: він не повинен змінювати state, не повинен позначати події як надіслані та не має впливати на подальшу роботу звичайного digest.
Додай окремий прапорець для протилежної поведінки — коли записи після такого запуску все ж позначаються як надіслані та записуються в state. Сам обери назву прапорця, якщо вона добре вписується в поточний CLI.
Спочатку подивись на поточну реалізацію digest і state management та вибери найбільш логічний інтерфейс параметрів.
Після реалізації покажи зміни, наведи приклади команд і перевір такі сценарії:
•	--last N не змінює state;
•	--last N із прапорцем оновлює state;
•	звичайний запуск без параметрів працює як раніше;
•	відсутність нових подій;
•	помилка відправлення не пошкоджує state.
Після перевірок коротко відзвітуй про результати.
Раунд 9 | Codex
Додав ручний режим --last N у scripts/send-telegram-digest.mjs.
Інтерфейс:
npm run digest:dry -- --last 5
npm run digest -- --last 5
npm run digest -- --last 5 --mark-sent


Поведінка:
•	--last N бере останні N записів із data/events.jsonl.
•	За замовчуванням це manual test digest: state не змінюється, id не додаються в sentTelegramEventIds.
•	--mark-sent вмикає протилежну поведінку: після успішної відправки id додаються в state.
•	Якщо Telegram send падає, state не оновлюється.
•	Звичайний npm run digest без параметрів працює як раніше через state.lastChanges.newEventIds.
Приклади:
npm run digest:dry -- --last 3
npm run digest -- --last 1
npm run digest -- --last 1 --mark-sent


Перевірив сценарії:
•	--last 3 dry-run показує digest і не потребує token.
•	--last 1 реально відправив тестове повідомлення з temp state, state лишився unchanged.
•	--last 1 --mark-sent реально відправив тестове повідомлення з temp state і додав id у temp state.
•	Помилка відправлення з fake env не змінила temp state.
•	npm run digest без параметрів зараз показує No new Telegram digest events to send.
•	Реальний data/state.json не змінений: sentTelegramEventIds досі порожній, lastTelegramDigestAt досі null.
•	.env залишається ignored, секрети не виводились.


Раунд 10 | Користувач
•	Потрібно налаштувати щоденний запуск локального pipeline на Windows через Task Scheduler. Репозиторій знаходиться тут:
  C:\Users\mykyta\Desktop\code2\git\opps-monitor. Запуск має виконувати команду npm run daily, яка вже запускає
  scraping, normalization і Telegram digest.
  Зроби це через Windows Task Scheduler так, щоб задача запускалась раз на день ввечері, наприклад о 20:00. Не критично,
  якщо точний час буде інший, головне щоб запуск був один раз на день. Якщо ноутбук у цей момент вимкнений або спить,
  задача має запуститися пізніше, коли це буде можливо, якщо Windows це дозволяє.
  Задача має запускати PowerShell з командою:
  -NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\Users\mykyta\Desktop\code2\git\opps-monitor'; npm run daily"
  Важливо: не змінюй код pipeline без потреби. Не коміть .env, materials/, node_modules/, data/events.jsonl, data/
  events.current.json або data/state.json. Перед налаштуванням перевір, що npm run daily існує в package.json, і що .env
  є локально та містить потрібні Telegram-змінні, але не виводь значення секретів у логах або відповіді.
  Після налаштування коротко повідом, як називається створена задача, коли вона запускається, і якою командою її можна
  вручну запустити або перевірити.
Раунд 10 | Codex
Налаштував Windows Task Scheduler.
Задача:
OppsMonitorDaily


Розклад:
Daily at 20:00
Next run: 2026-06-18 20:00:00
Status: Ready
StartWhenAvailable: true


Команда задачі:
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\Users\mykyta\Desktop\code2\git\opps-monitor'; npm run daily"


Перевірив перед налаштуванням:
•	npm run daily існує і запускає scrape && normalize && digest
•	.env локально є
•	.env має TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID
•	значення секретів не виводив
•	.env, materials/, node_modules/, data/events.jsonl, data/events.current.json, data/state.json залишаються ignored
•	код pipeline не змінював
Ручний запуск:
Start-ScheduledTask -TaskName OppsMonitorDaily


Або через schtasks:
schtasks /Run /TN OppsMonitorDaily


Перевірити стан:
Get-ScheduledTaskInfo -TaskName OppsMonitorDaily
schtasks /Query /TN OppsMonitorDaily /FO LIST /V





Додай есе до 250 слів англійською мовою: що ти робив, де модель помилилась, як ти змінив підхід і що забрав із цього досвіду.*
My artifact demonstrates how I used Codex to build a tool that solves a real problem for me. I wanted a Telegram bot that would send me a daily digest of new IT events, hackathons, competitions, and educational opportunities collected from different websites.  I started with simple tasks that were easy to verify: opening a page with Playwright, saving its text and links, and converting the extracted information into structured JSON records. Gradually, I added more sources, normalization rules, state management, and Telegram delivery.  While reviewing the results, I noticed that an article unrelated to artificial intelligence had received the AI tag. The Ukrainian abbreviation “ШІ” had been matched inside the word “вишів” because Codex used simple substring matching. The code worked technically, but the result was semantically incorrect.  I analyzed the cause and changed the approach: we replaced substring matching with Unicode-aware regular expressions using negative lookarounds and tested both false positives and valid matches.  I learned that a technically successful result is not always a correct one, so I now try to define edge cases and validation checks before accepting a solution. I also learned to treat AI as a collaborator that needs clear constraints, testing, and review rather than as a system whose output can be trusted automatically.  The final pipeline collects events, identifies new records, prioritizes AI-related opportunities, avoids duplicates, and supports dry-run and manual testing modes.
Чому ти хочеш потрапити на цю програму? *
тому що я горю ідеєю створенням та використанням агентів! 
на мою думку це буквально майбутнє програмування. у нас будуть великі моделі для автоматичного виконання великих задач, локальні маленькі моделі що більшого контролю - і для кожного з випадків потрібне розуміння їхньої поведінки, можливостей та, найголовніше, сильних сторін!

я вже використовую ші агентів у власних проєктах і хочу краще розуміти як будувати сильні та надійні agentic системи. Мене цікавить декомпозиція складних задач, контроль якості результатів і робота з помилками моделей. Отримані знання хочу застосувати у власних проєктах і розвиватися в цьому напрямі далі.
Як ти дізнався про програму KSE AI Agentic Summer School? *

Telegram-канал або спільнота
Чи є у тебе досвід участі в олімпіадах, хакатонах або IT-конкурсах?*

Так, є досвід (вкажи нижче)
Релевантний досвід*
1 місце в KSE - hack the classroom
участь в lapathon, handwritten to data.

всі вони мають спільну доменну область - ШІ
