@echo off
chcp 65001 > nul
cd /d "%~dp0"

REM === Вкладка 1: Запуск локального сервера ===
start "Bank Server" cmd /k "npm start"

REM Пауза в 3 секунды, чтобы сервер успел инициализироваться
timeout /t 3 > nul

REM === Вкладка 2: Запуск ngrok туннеля ===
start "ngrok" cmd /k "ngrok http --domain=darkness-grip-audible.ngrok-free.dev 3000"
