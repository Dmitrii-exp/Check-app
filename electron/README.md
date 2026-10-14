# Check App для Windows

Electron-оболочка открывает https://app-check.ru/app/ и использует существующий Supabase. Интернет обязателен.

Локально: `npm install`, `npm start`.

Установщик: GitHub Actions → **Build Check App Windows** → Run workflow → скачать artifact **Check-App-Windows-Setup**.

Установщик пока не подписан сертификатом, Windows SmartScreen может предупреждать. Автообновление самой оболочки ещё не реализовано. До публикации протестировать авторизацию, загрузку фотографий и оплату.
