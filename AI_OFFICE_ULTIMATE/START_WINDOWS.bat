@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 LTS from https://nodejs.org/
 pause
 exit /b 1
)
echo Open http://127.0.0.1:8787/ai-office/ in your browser.
node server/index.mjs
pause
