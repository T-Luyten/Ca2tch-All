@echo off
setlocal
set "BUNDLE_DIR=%~dp0"
set "PYTHON_DIR=%BUNDLE_DIR%python"
set "PYTHON_EXE=%PYTHON_DIR%\python.exe"
set "PYTHON_ZIP=%BUNDLE_DIR%python-embed.zip"
set "PYTHON_URL=https://www.python.org/ftp/python/3.12.9/python-3.12.9-embed-amd64.zip"
set "GETPIP_URL=https://bootstrap.pypa.io/get-pip.py"
set "GETPIP=%BUNDLE_DIR%get-pip.py"
set "REQ_FILE=%BUNDLE_DIR%backend\requirements.txt"
set "STAMP=%BUNDLE_DIR%python\.deps_installed"

echo.
echo   Ca2+tchAll -- First-time setup
echo   This runs once and may take a few minutes.
echo.

:: ── Step 1: Download embedded Python ────────────────────────────────────────
if exist "%PYTHON_EXE%" goto python_ok

echo [1/4] Downloading embedded Python 3.12...
powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%PYTHON_ZIP%'" >nul 2>&1
if errorlevel 1 (
  echo   ERROR: Could not download Python. Check your internet connection.
  pause & exit /b 1
)

echo [2/4] Extracting Python...
powershell -Command "Expand-Archive -Path '%PYTHON_ZIP%' -DestinationPath '%PYTHON_DIR%' -Force" >nul 2>&1
del "%PYTHON_ZIP%" >nul 2>&1

:: Enable site-packages in embedded Python (required for pip)
for %%f in ("%PYTHON_DIR%\python3*._pth") do (
  powershell -Command "(Get-Content '%%f') -replace '#import site','import site' | Set-Content '%%f'"
)
goto get_pip

:python_ok
echo [1/4] Python already installed, skipping.
echo [2/4] Skipping extraction.

:: ── Step 2: Install pip ──────────────────────────────────────────────────────
:get_pip
if exist "%PYTHON_DIR%\Lib\site-packages\pip" goto pip_ok

echo [3/4] Installing pip...
powershell -Command "Invoke-WebRequest -Uri '%GETPIP_URL%' -OutFile '%GETPIP%'" >nul 2>&1
if errorlevel 1 (
  echo   ERROR: Could not download pip installer. Check your internet connection.
  pause & exit /b 1
)
"%PYTHON_EXE%" "%GETPIP%" --no-warn-script-location >nul 2>&1
del "%GETPIP%" >nul 2>&1
goto install_deps

:pip_ok
echo [3/4] pip already installed, skipping.

:: ── Step 3: Install dependencies ────────────────────────────────────────────
:install_deps
if exist "%STAMP%" goto deps_ok

echo [4/4] Installing dependencies (fastapi, uvicorn, pandas...)
"%PYTHON_EXE%" -m pip install -q --no-warn-script-location -r "%REQ_FILE%"
if errorlevel 1 (
  echo   ERROR: Failed to install dependencies.
  pause & exit /b 1
)
echo. > "%STAMP%"
goto done

:deps_ok
echo [4/4] Dependencies already installed, skipping.

:done
echo.
echo   Setup complete! Run launch.bat to start the app.
echo.
pause
