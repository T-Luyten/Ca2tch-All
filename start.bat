@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "APP_URL=http://localhost:8002"

cd /d "%BACKEND_DIR%"

if not exist "venv" (
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
  echo Failed to activate virtual environment.
  exit /b 1
)

echo Installing dependencies...
python -m pip install -q --upgrade pip
if errorlevel 1 exit /b 1
python -m pip install -q -r requirements.txt
if errorlevel 1 exit /b 1

echo.
echo   Starting Multi-Experiment Calcium Analyzer
echo   Opening %APP_URL% in your browser...
echo.

start "" "%APP_URL%"
python -m uvicorn main:app --host 0.0.0.0 --port 8002
