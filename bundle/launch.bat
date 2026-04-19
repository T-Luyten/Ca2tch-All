@echo off
setlocal
set "BUNDLE_DIR=%~dp0"
set "PYTHON_EXE=%BUNDLE_DIR%python\python.exe"
set "APP_URL=http://localhost:8002"

if not exist "%PYTHON_EXE%" (
  echo.
  echo   Python not found. Please run setup.bat first.
  echo.
  pause & exit /b 1
)

if not exist "%BUNDLE_DIR%python\.deps_installed" (
  echo.
  echo   Dependencies not installed. Please run setup.bat first.
  echo.
  pause & exit /b 1
)

echo.
echo   Starting Ca2+tchAll...
echo   Opening %APP_URL% in your browser.
echo   Close this window to stop the app.
echo.

start "" "%APP_URL%"
cd /d "%BUNDLE_DIR%backend"
"%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8002
