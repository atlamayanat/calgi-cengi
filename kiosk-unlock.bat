@echo off
REM ============================================================
REM  KIOSK KILIDI AC - kiosk-lock.bat ile yapilan degisiklikleri geri alir
REM  Normal kullanim / bakim icin calistir (yonetici).
REM ============================================================

REM --- Yonetici degilsek kendimizi yukselt ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yonetici izni isteniyor...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo === Kenar kaydirma jestleri geri aciliyor ===
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe"    /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "DisableCharmsHint" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "DisableTLcorner"   /f >nul 2>&1

echo === Pencere Snap geri aciliyor ===
reg add "HKCU\Control Panel\Desktop" /v "WindowArrangementActive" /t REG_SZ /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "SnapAssist"            /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "EnableSnapAssistFlyout" /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v "JointResize"           /t REG_DWORD /d 1 /f

REM Kabuk kapaliysa (kiosk yarida kesildiyse) geri baslat
tasklist /fi "imagename eq explorer.exe" 2>nul | find /i "explorer.exe" >nul
if errorlevel 1 start explorer.exe

echo.
echo === TAMAM === Kilit kaldirildi. Yeniden baslatmak iyi olur.
echo.
pause
