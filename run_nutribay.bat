@echo off
echo ======================================================
echo   Nutribay Manufacturing ERP - starting
echo   (independent of ModernBazaarHO: own database nutribay_erp, ports 8100 / 5174)
echo ======================================================
start "NUTRIBAY-BACKEND" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn app.main:app --host 127.0.0.1 --port 8100"
start "NUTRIBAY-FRONTEND" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo   App:      http://localhost:5174
echo   API docs: http://localhost:8100/docs
timeout /t 6 /nobreak >nul
start http://localhost:5174
