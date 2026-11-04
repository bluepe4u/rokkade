@echo off
setlocal
cd /d "%~dp0"
title Rokade
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js %*
  goto :end
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py %*
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py %*
  goto :end
)
echo.
echo  Neither Node.js nor Python was found.
echo  Install one of them (https://nodejs.org or https://python.org) and run this file again.
echo.
:end
pause
