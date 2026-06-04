@echo off
title DEX Scanner - Simulação paper Base
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  ". '%~dp0scripts\load-dotenv.ps1'; node '%~dp0scripts\executor-simulate.js' --chain=base"
pause
