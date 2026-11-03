@echo off
setlocal
cd /d "%~dp0"
set PORT=8766

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python tidak ditemukan di komputer ini.
  echo Install Python dari https://www.python.org/downloads/ lalu jalankan file ini lagi.
  echo.
  pause
  exit /b 1
)

echo ============================================
echo   FlowSpace
echo   Alamat : http://localhost:%PORT%
echo   Hentikan: tutup jendela ini atau Ctrl+C
echo ============================================
echo.

rem Buka browser setelah server siap (jeda ~2 detik).
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & explorer http://localhost:%PORT%"

python -m http.server %PORT% --bind 127.0.0.1

echo.
echo Server FlowSpace sudah berhenti.
pause
