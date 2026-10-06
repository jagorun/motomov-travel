# travel.motomov.ru

Статическая витрина цен Библио-Глобус.
Бот пишет `data/prices.json`, Vercel выкладывает после коммита в `main`.

Фильтр: Москва, Аэрофлот, 31.10.2026, 8 ночей, 2 взрослых, AI.

## Канон отелей (14)

Akka Antedon Hotel 5* (`F4=102672570527`, Кемер-Белдиби-Гойнюк), Akra Antalya, Arum Barut Collection, Barut Hemera, Dobedan Exclusive, Kirman Belazur, Nirvana Dolce Vita, Voyage Sorgun, Sidemarin Kirman Premium, Bellis Deluxe, TUI Blue Sherwood Belek, Papillon Ayscha / Belvil / Zeugma.

Исключены: Limak Lara, Crystal Aura Aqua Collection, Concorde De Luxe.

MY_TOP (раздел Цены): 1 Akka Antedon, 2 Belazur, 3 Bellis, 4 Sherwood, 5 Ayscha, далее по цене.

## Данные

- `data/prices.json` — текущий выпуск (цены, курс, погода «сейчас»)
- `data/history.json` — история цен по съёмкам (не стирать старые точки)
- `data/reviews.json` — отзывы: `hotels[].reviews` (свежие ≤60 дней) и `hotels[].archive` (старше). Ничего не удалять.
- `data/weather.json` — копия блока погоды (опционально)
- `data/weather-history.json` — снимки погоды утро/вечер для графика

## Утро / вечер

При каждом выпуске:

1. Обновить `data/prices.json` (и при необходимости `data/weather.json`).
2. Дописать точку в `data/history.json` (цены канона).
3. Дописать точку в `data/weather-history.json`:
   ```json
   {
     "at": "2026-10-04T18:05:00+03:00",
     "slot": "вечер",
     "source": "Open-Meteo",
     "places": {
       "Анталия": { "tempC": 21.0, "dayMin": 19, "dayMax": 24, "text": "ясно", "code": 0 },
       "Кемер": { "tempC": 22.5, "dayMin": 20, "dayMax": 25, "text": "ясно", "code": 0 }
     }
   }
   ```

График погоды на сайте: Open-Meteo `past_days` (макс/мин) + треугольники из `weather-history.json`.

4. **Отзывы** — только добавлять, не затирать:
   - новые отзывы дописывать в `hotels[].reviews` (свежие, ≤60 дней от `updatedAt`);
   - устаревшие (>60 дней) **переносить** в `hotels[].archive`, не удалять;
   - при совпадении текста не дублировать; старые записи из архива не вычищать.

## UI

- **Цены** — «Мой топ» / «По цене» / «По имени»; спарклайн цены на карточке; клик → свежие отзывы отеля.
- **Отзывы** — вкладки «Свежие» и «Архив отзывов»; якорь `#review-…` ведёт к свежим.
- **Динамика** — клик по карточке отеля → модалка с графиком цены по датам из history.
- Исключены из UI: Limak Lara, Crystal Aura Aqua Collection, Concorde De Luxe.
