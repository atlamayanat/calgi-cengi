@echo off
REM ============================================================
REM  KIOSK KILIT - dokunmatik kenar jestlerini ve Snap'i kapatir
REM  Bir kez calistir (yonetici). Geri almak icin: kiosk-unlock.bat
REM  Etki tam olmasi icin OTURUM KAPAT / YENIDEN BASLAT gerekir.
REM ============================================================

REM --- Yonetici degilsek kendimizi yukselt ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo === Kenar kaydirma jestleri kapatiliyor (HKLM, makine geneli) ===
REM AllowEdgeSwipe=0: alt/yan/kose kaydirma jestleri (gorev cubugu, Task View,
REM bildirim merkezi, widget) ACILMAZ.
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe"   /t REG_DWORD /d 0 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "DisableCharmsHint" /t REG_DWORD /d 1 /f
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "DisableTLcorner"   /t REG_DWORD /d 1 /f

echo.
echo === Pencere Snap / kose ile buyutme kapatiliyor (HKCU) ===
reg add "HKCU\Control Panel\Desktop" /v "WindowArrangementActive" /t REG_SZ /d 0 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "SnapAssist"            /t REG_DWORD /d 0 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "EnableSnapAssistFlyout" /t REG_DWORD /d 0 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "JointResize"           /t REG_DWORD /d 0 /f

echo.
echo === TAMAM ===
echo Degisikliklerin tam etkili olmasi icin OTURUMU KAPATIP yeniden gir
echo veya bilgisayari yeniden baslat.
echo Geri almak icin: kiosk-unlock.bat
echo.
pause
