@echo off
echo ================================
echo   ARC Agent - 启动
echo ================================
echo.
if not exist node_modules (
    echo [提示] 首次运行，正在安装依赖...
    call npm install
    echo.
)
echo 正在启动代理...
echo 按 Ctrl+C 停止
echo.
node index.js