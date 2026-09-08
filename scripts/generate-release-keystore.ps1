$ErrorActionPreference = 'Stop'

# Check App / RuStore release signing key generator
# IMPORTANT: the generated keystore is intentionally excluded from Git.
# Store it in a secure backup and never commit it to GitHub.

$KeyDir = Join-Path $PSScriptRoot '..\keys'
New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null

$Keystore = Join-Path $KeyDir 'checkapp-release.jks'

if (Test-Path $Keystore) {
  Write-Host "Keystore already exists: $Keystore"
  Write-Host "Do not overwrite it if this key has already been used for a published version."
  exit 1
}

$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool) {
  throw 'keytool не найден. Установите JDK и добавьте его bin в PATH.'
}

Write-Host 'Создание release keystore для Check App.'
Write-Host 'Придумайте надежный пароль. Пароль не записывается в GitHub.'

& $keytool.Source -genkeypair `
  -v `
  -keystore $Keystore `
  -alias checkapp `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -sigalg SHA256withRSA

if ($LASTEXITCODE -ne 0) {
  throw 'Не удалось создать keystore.'
}

Write-Host ''
Write-Host "Готово: $Keystore"
Write-Host 'Сделайте резервную копию keystore и пароля в безопасном месте.'
Write-Host 'Один и тот же ключ нужно использовать для последующих обновлений.'
Write-Host 'После сборки проверьте SHA-256 сертификата через apksigner или keytool.'
