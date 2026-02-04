@echo off
echo ========================================
echo   黄金监控系统 - 极致 Docker 部署工具
echo ========================================

echo [1/3] 正在秒级重构并替换容器...
:: --build 强制检查代码变动
:: --force-recreate 强制替换容器，确保更新 100%% 生效
docker-compose up -d --build --force-recreate

echo.
echo [2/3] 正在安全清理本项目产生的旧镜像碎片...
:: 仅清理 <none> 镜像，不带 -a 选项，不会动您的其他正式镜像
docker image prune -f

echo.
echo [3/3] 部署完成！当前服务状态：
docker ps --filter name=gold-monitor

echo.
echo ========================================
echo 更新已生效，您可以刷新浏览器查看。
echo ========================================
pause
