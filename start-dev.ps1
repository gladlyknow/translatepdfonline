# 同时启动前后端开发服务（同一终端，日志同屏）
# 用法: .\start-dev.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# 清理可能占用的端口和 lock
$ports = @{ 3000 = "Next.js"; 8000 = "FastAPI" }
foreach ($port in $ports.Keys) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Write-Host "Kill port $port (PID: $($conn.OwningProcess)) ..." -ForegroundColor Yellow
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}
$lockFile = "$ProjectRoot\frontend\.next\dev\lock"
if (Test-Path $lockFile) {
    Remove-Item $lockFile -Force
    Write-Host "Removed Next.js lock" -ForegroundColor Yellow
}

Write-Host "Backend: http://localhost:8000 | Frontend: http://localhost:3000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop both`n" -ForegroundColor Yellow

Set-Location "$ProjectRoot\frontend"
npm run dev:all
