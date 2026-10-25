@echo off
rem Opens ValMap in its own window using Microsoft Edge (comes with Windows).
set "PAGE=%~dp0index.html"
set "PAGE=%PAGE:\=/%"
start "" msedge --app="file:///%PAGE%" --window-size=1500,950
