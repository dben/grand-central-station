@echo off
rem Serves the game folder over HTTP and opens it. Needs Python 3 on PATH.
rem If you do not have Python, open dist\grand-central-station.html instead.
cd /d "%~dp0"
start "" http://localhost:8080/
python -m http.server 8080
