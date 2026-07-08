@echo off
rem ============================================================
rem  Kickoff Oracle - JUROR launcher (a second laptop that JUDGES)
rem  Double-click this file. Same as the viewer, but it also runs
rem  the on-device AI so this laptop can cast its own juror verdict
rem  (the two-device, different-model jury). It still JOINS the
rem  host's room by invite key - it just brings its own brain.
rem  First run downloads the model (needs internet once), then
rem  judges fully offline. Requires Smart App Control to be OFF.
rem ============================================================
cd /d "%~dp0"
git pull

cd frontend\sidecar
rem A half-finished install leaves node_modules without the native AI
rem runtime; check for the actual binary, not just the folder.
if not exist node_modules\bare-runtime-win32-x64\bin\bare.exe (
  if exist node_modules rmdir /s /q node_modules
  call npm install
)

rem Verify Windows actually lets the AI runtime execute. Smart App Control
rem or antivirus kills it silently, which later surfaces as the
rem "RPC initialization timed out" error on model download.
node_modules\bare-runtime-win32-x64\bin\bare.exe --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo  ============================================================
  echo   WARNING: Windows is blocking the on-device AI runtime.
  echo   Usual cause: Smart App Control. Turn it off under
  echo   Windows Security ^> App ^& browser control ^> Smart App
  echo   Control ^> Off, REBOOT, and run this file again.
  echo   Continuing anyway - joining and betting still work,
  echo   but this laptop cannot judge until this is fixed.
  echo  ============================================================
  echo.
  pause
)
start "Kickoff Helper (AI + P2P)" cmd /k "npm start"

cd ..
if not exist node_modules call npx pnpm@11 install
start "" cmd /c "timeout /t 20 >nul && start http://localhost:5173"
call npx pnpm@11 dev
