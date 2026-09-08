# Check App — публикация в RuStore

## Подпись приложения

RuStore требует цифровую подпись для APK. Подпись нужно хранить так же надежно, как пароль. Для последующих версий APK должна использоваться та же подпись, иначе Android не позволит пользователям нормально обновлять приложение.

Официальная инструкция RuStore:
https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/apk-signature

## 1. Создать release keystore

На Windows с установленным JDK:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-release-keystore.ps1
```

Скрипт создаст:

```text
keys/checkapp-release.jks
```

Файл `*.jks` и пароли не должны попадать в GitHub. Это уже защищено `.gitignore`.

## 2. Подключить подпись к Android-сборке

После выполнения `npx cap add android` настройте release signing в Android-проекте.

Рекомендуемый файл:

```text
android/keystore.properties
```

Пример структуры (не коммитить реальные значения):

```properties
storeFile=../keys/checkapp-release.jks
storePassword=CHANGE_ME
keyAlias=checkapp
keyPassword=CHANGE_ME
```

Затем release build должен использовать этот keystore.

## 3. Проверить SHA-256

После сборки APK:

```powershell
apksigner verify --print-certs -v .\android\app\build\outputs\apk\release\app-release.apk
```

Нужное значение — `Signer #1 certificate SHA-256 digest`.

Также можно использовать:

```powershell
keytool -printcert -jarfile .\android\app\build\outputs\apk\release\app-release.apk
```

RuStore рекомендует сравнить отпечаток подписи приложения с отпечатком в RuStore Консоли.

## 4. APK или AAB

RuStore принимает APK и AAB.

Для APK релизный файл должен быть подписан цифровым сертификатом.

Для AAB схема отличается: AAB подписывается ключом загрузки, а в RuStore отдельно загружаются сертификат ключа загрузки и данные подписи приложения.

## 5. Главное правило ключа

**Не создавать новый keystore для каждой версии.**

Для Check App необходимо сохранить один release keystore и использовать его для последующих обновлений. Если ключ потерять, публикация обновлений может потребовать отдельной процедуры восстановления/смены подписи через поддержку RuStore.

Если приложение будет публиковаться также в Google Play, до первой публикации нужно определить стратегию единого ключа/подписей для всех магазинов.

## 6. Текущие параметры Check App

- App name: `Check App`
- Package ID: `ru.checkapp.mobile`
- Android target: API 36+
- Release signing: отдельный локальный keystore

## Безопасность

Никогда не добавлять в GitHub:

- `*.jks`
- `*.keystore`
- `keystore.properties`
- пароли keystore/key
- release APK/AAB с приватными ключами внутри проекта

Резервную копию keystore и пароля хранить отдельно от исходного кода.
