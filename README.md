# Check App

Система контроля технического обслуживания оборудования.

## Структура

- `index.html` — основной интерфейс.
- `css/styles.css` — стили.
- `js/app.js` — основная логика приложения.
- `assets/` — графические ресурсы.
- `public/manifest.webmanifest` — PWA-манифест.
- `capacitor.config.ts` — конфигурация для упаковки в Android/iOS.
- `docs/ARCHITECTURE.md` — описание архитектуры.

## Supabase

Приложение использует Supabase для:

- Authentication;
- PostgreSQL;
- Storage;
- RPC;
- хранения данных оборудования, действий обслуживания, задач, завершений и подписок.

Не добавляйте `service_role` ключ в клиентский код.

## Локальный запуск

Для простого просмотра:

```bash
npx serve .
```

Для мобильной сборки после установки зависимостей:

```bash
npm install
npx cap add android
npx cap add ios
npx cap sync
```

Android открывается через:

```bash
npm run android
```

iOS:

```bash
npm run ios
```

Перед публикацией необходимо отдельно проверить RLS, авторизацию внутри WebView, реальные платежи, иконки/сплэш и store requirements.

## Важно

Основная логика текущей версии не переписана. Структура подготовлена так, чтобы продолжить развитие проекта без ломки существующей Supabase-логики.
