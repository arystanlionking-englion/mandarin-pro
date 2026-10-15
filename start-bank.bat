@echo off
chcp 65001 > nul

REM === Вкладка 1: Запуск локального сервера ===
start cmd /k "Set-ExecutionPolicy RemoteSigned -Scope Process -Force & cd /d D:\qwerty\personal-bank & npm start"

REM Пауза в 3 секунды, чтобы сервер успел инициализироваться
timeout /t 3 > nul

REM === Вкладка 2: Запуск ngrok туннеля ===
start cmd /k "ngrok http --domain=darkness-grip-audible.ngrok-free.dev 3000"

