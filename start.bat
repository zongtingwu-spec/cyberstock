@echo off
chcp 65001 >nul
cd /d "%~dp0"
title CYBER STOCK MONITOR
color 0B
echo.
echo  ===================================================
echo   ^|=  CYBER_STOCK_MONITOR  =^|
echo   ^|=  cyberpunk stock dashboard - v1.0  =^|
echo  ===================================================
echo.
echo  [INFO] Starting local HTTP server (no-cache) on port 8090...
echo  [INFO] Opening browser to http://localhost:8090
echo  [INFO] Press Ctrl+C to stop the server.
echo.
start "CyberStock" "http://localhost:8090"
python dev-server.py 8090 2>nul
if errorlevel 1 (
  echo  [WARN] 'python' command not found, trying 'py'...
  py dev-server.py 8090
)
if errorlevel 1 (
  echo  [ERROR] Python not installed. Please install Python 3 from https://python.org/
  pause
)
