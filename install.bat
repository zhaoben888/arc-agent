@echo off
echo ================================
echo   ARC Agent - 安装依赖
echo ================================
echo.
echo 正在安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [错误] 安装失败，请确认已安装 Node.js 18+
    echo 下载地址: https://nodejs.org
    pause
    exit /b 1
)
echo.
echo [成功] 依赖安装完成！
echo.
echo 下一步:
echo   1. 编辑 .env 文件配置服务器地址
echo   2. 双击 start.bat 启动代理
echo.
pause