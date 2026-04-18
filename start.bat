@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "APP_URL=http://localhost:8002"
set "VENV_DIR=%BACKEND_DIR%\venv"
set "REQ_FILE=%BACKEND_DIR%\requirements.txt"
set "REQ_STAMP=%VENV_DIR%\requirements.installed.txt"

cd /d "%BACKEND_DIR%"

where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   ERROR: Python was not found on PATH.
    echo   Install Python 3 and re-run start.bat
    echo.
    exit /b 1
  )
)

if not exist "%VENV_DIR%" (
  echo Creating Python virtual environment...
  py -3 -m venv venv >nul 2>&1
  if errorlevel 1 (
    python -m venv venv >nul 2>&1
    if errorlevel 1 (
      echo.
      echo   ERROR: Could not create a Python virtual environment.
      echo   Install Python 3.12 and make sure ^`py^` or ^`python^` is on PATH.
      echo   Then re-run start.bat
      echo.
      exit /b 1
    )
  )
)

call "venv\Scripts\activate.bat"
if errorlevel 1 (
  echo.
  echo   ERROR: Failed to activate backend\venv.
  echo   Delete backend\venv and re-run start.bat
  echo.
  exit /b 1
)

if not exist "%REQ_STAMP%" goto install_deps
fc /b "%REQ_FILE%" "%REQ_STAMP%" >nul 2>&1
if errorlevel 1 goto install_deps
echo Dependencies already up to date.
goto deps_done

:install_deps
echo Installing dependencies...
python -m pip install -q --upgrade pip
if errorlevel 1 (
  echo.
  echo   ERROR: Failed to upgrade pip in backend\venv.
  echo.
  exit /b 1
)
python -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo.
  echo   ERROR: Failed to install backend dependencies from requirements.txt.
  echo.
  exit /b 1
)
copy /y "%REQ_FILE%" "%REQ_STAMP%" >nul

:deps_done
python -c "import uvicorn" >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ERROR: uvicorn is not available in backend\venv.
  echo   Delete backend\venv and re-run start.bat
  echo.
  exit /b 1
)

echo.
echo   Starting Multi-Experiment Calcium Analyzer
echo   Opening %APP_URL% in your browser...
echo.

start "" "%APP_URL%"
python -m uvicorn main:app --host 0.0.0.0 --port 8002
