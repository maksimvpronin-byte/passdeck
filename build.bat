@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-portable-windows.ps1" %*
set BUILD_EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %BUILD_EXIT_CODE%
