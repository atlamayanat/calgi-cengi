@echo off
REM ============================================================
REM  Perküsyon Sequencer - Sergi / Kiosk başlatıcı
REM  - Edge'i tam ekran kiosk modunda açar
REM  - Görev çubuğu + masaüstü kabuğunu (explorer.exe) kapatır
REM    => alttan yukarı kaydırınca görev çubuğu AÇILMAZ
REM  - Çıkışta (Alt+F4 / Ayarlar > Uygulamayı Kapat) kabuğu geri başlatır
REM ============================================================
setlocal

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

set "KIOSK_URL=http://127.0.0.1:4173"
set "EDGE_PROFILE=%PROJECT_DIR%edge-kiosk-profile"

REM Kabuğu (görev çubuğu/masaüstü) kapatmak istemiyorsan 0 yap (test için)
set "KILL_SHELL=1"

REM --- Seri port iznini Edge'e politikadan otomatik ver (HKCU, admin gerekmez) ---
REM SerialAllowAllPortsForUrls: bu URL açıldığında "Port seç" diyaloğu çıkmaz, navigator.serial.getPorts() COM3'u doğrudan döner
reg add "HKCU\Software\Policies\Microsoft\Edge\SerialAllowAllPortsForUrls" /v "1" /t REG_SZ /d "%KIOSK_URL%" /f >nul 2>&1
reg add "HKCU\Software\Policies\Microsoft\Edge" /v "SerialAskForUrls" /t REG_DWORD /d 0 /f >nul 2>&1

REM node_modules yoksa yükle
if not exist "node_modules" (
    call npm install
)

REM dist yoksa build al
if not exist "dist\index.html" (
    call npm run build
)

REM Vite preview sunucusunu arka planda başlat (port 4173)
start "perkusyon-server" /min cmd /c "npm run preview -- --host 127.0.0.1 --port 4173"

REM Sunucunun ayağa kalkmasını bekle
:waitloop
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -Uri '%KIOSK_URL%' -TimeoutSec 1).StatusCode } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto waitloop

REM --- Kabuğu kapat: görev çubuğu + masaüstü tamamen kaybolur ---
if "%KILL_SHELL%"=="1" (
    taskkill /f /im explorer.exe >nul 2>&1
)

REM Edge'i kiosk (tam ekran) modunda aç
REM   --disable-pinch                 : iki parmakla yakınlaştırma kapalı
REM   --overscroll-history-navigation=0 : kenardan kaydırıp geri gitme kapalı
REM   sabit user-data-dir ile izinler kalıcı kalsın
start "" "msedge.exe" --kiosk "%KIOSK_URL%" --edge-kiosk-type=fullscreen --no-first-run --disable-features=TranslateUI --disable-pinch --overscroll-history-navigation=0 --user-data-dir="%EDGE_PROFILE%"

REM --- Edge kapanana kadar bekle (Alt+F4 veya Ayarlar > Uygulamayı Kapat) ---
REM Edge'in tamamen ayağa kalkması için kısa bekleme
timeout /t 3 /nobreak >nul
:waitedge
timeout /t 2 /nobreak >nul
tasklist /fi "imagename eq msedge.exe" 2>nul | find /i "msedge.exe" >nul
if not errorlevel 1 goto waitedge

REM --- Kabuğu geri başlat: görev çubuğu + masaüstü geri gelir ---
if "%KILL_SHELL%"=="1" (
    start explorer.exe
)

endlocal
