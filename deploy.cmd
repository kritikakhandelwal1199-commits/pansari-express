@echo off
rem Double-click to deploy Pansari Express. Extra arguments are passed on, e.g. deploy.cmd -ProjectId my-project
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
echo.
pause
