@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  FBO License - issue key nhanh
rem  Cach dung:
rem    1) Double-click: nhap ID va Name
rem    2) CMD: issue-license.bat LIC-001 "Cong ty ABC"
rem  Han dung mac dinh = 1 thang, max = 1 may.
rem  File nay ASCII (khong dau) de cmd.exe chay duoc.
rem ============================================================

cd /d "%~dp0"

set "CLI=%~dp0cli\fbo-license.mjs"
set "PRIV=%~dp0keys\private.pem"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Khong tim thay Node.js trong PATH.
  echo     Cai Node.js roi mo lai CMD / double-click file nay.
  pause
  exit /b 1
)

if not exist "%CLI%" (
  echo [x] Khong tim thay CLI:
  echo     %CLI%
  pause
  exit /b 1
)

if not exist "%PRIV%" (
  echo [!] Chua co private key. Dang tao keypair...
  node "%CLI%" keypair
  if errorlevel 1 (
    echo [x] Tao keypair that bai.
    pause
    exit /b 1
  )
  echo.
  echo [!] Da tao keys.
  echo     Hay nhung public.pem vao extension\src\license\public-key.js neu chua.
  echo.
)

echo ========================================
echo   FBO Designer - Issue License Key
echo   Han dung mac dinh: 1 thang
echo   So may mac dinh: 1
echo ========================================
echo.

set "LIC_ID=%~1"
set "LIC_NAME=%~2"

if not defined LIC_ID (
  set /p "LIC_ID=License ID (vd LIC-2026-001): "
)
if not defined LIC_NAME (
  set /p "LIC_NAME=Ten cong ty / Name: "
)

rem trim spaces
for /f "tokens=* delims= " %%A in ("!LIC_ID!") do set "LIC_ID=%%A"
for /f "tokens=* delims= " %%A in ("!LIC_NAME!") do set "LIC_NAME=%%A"

if "!LIC_ID!"=="" (
  echo [x] Bat buoc nhap ID.
  pause
  exit /b 1
)
if "!LIC_NAME!"=="" (
  echo [x] Bat buoc nhap Name.
  pause
  exit /b 1
)

set "LIC_EXP="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "(Get-Date).AddMonths(1).ToString('yyyy-MM-dd')"`) do set "LIC_EXP=%%A"
if "!LIC_EXP!"=="" (
  echo [x] Khong tinh duoc ngay het han ^(powershell^).
  pause
  exit /b 1
)

echo.
echo --- Thong tin ---
echo ID     : !LIC_ID!
echo Name   : !LIC_NAME!
echo Expire : !LIC_EXP!  ^(1 thang^)
echo Max    : 1 may
echo.

set "LIC_KEY="
for /f "usebackq delims=" %%A in (`node "%CLI%" issue --id "!LIC_ID!" --exp "!LIC_EXP!" --max 1 --co "!LIC_NAME!" 2^>nul`) do set "LIC_KEY=%%A"
if "!LIC_KEY!"=="" (
  echo.
  echo [x] Phat hanh that bai.
  pause
  exit /b 1
)
echo !LIC_KEY! | findstr /b "FBO1." >nul
if errorlevel 1 (
  echo.
  echo [x] Phat hanh that bai:
  echo !LIC_KEY!
  pause
  exit /b 1
)

echo.
echo License Key:
echo !LIC_KEY!
echo.

rem Ghi key vao clipboard, khong them xuong dong
<nul set /p="!LIC_KEY!"| clip
if errorlevel 1 (
  echo [!] Khong ghi duoc clipboard — hay copy thu cong dong key o tren.
) else (
  echo [OK] Da copy License Key vao clipboard. Ctrl+V de dan.
)
echo.
pause
endlocal
