# travel.motomov.ru

Статическая витрина цен Библио-Глобус.
Бот пишет `data/prices.json`, Vercel выкладывает после коммита в `main`.

Фильтр: Москва, Аэрофлот, 31.10.2026, 8 ночей, 2 взрослых, AI.

## Данные

- `data/prices.json` — текущий выпуск (цены, курс, погода «сейчас»)
- `data/history.json` — история цен по съёмкам (не стирать старые точки)
- `data/reviews.json` — отзывы Google
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

## UI

- **Цены** — сортировка «По цене» / «По имени»; клик по отелю → раздел «Отзывы» того же отеля.
- **Динамика** — клик по карточке отеля → модалка с графиком цены по датам из history.
- Исключены из UI: Limak Lara, Crystal Aura Aqua Collection, Concorde De Luxe.
