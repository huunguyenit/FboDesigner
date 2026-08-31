@echo off
setlocal

cd /d "%~dp0.."

echo.
echo ========================================
echo       FBO DESIGNER - PACKAGE VSIX
echo ========================================
echo.

node tools/package-vsix.mjs

if errorlevel 1 (
    echo.
    echo [ERROR] Package failed.
    pause
    exit /b 1
)

echo.
echo [SUCCESS] VSIX created successfully.
echo.

pause
endlocal