# E2E test script - run after start-dev.ps1
$ErrorActionPreference = "Continue"
$BaseUrl = "http://localhost:8000"
$FrontendUrl = "http://localhost:3000"

Write-Host "`n=== E2E Test ===" -ForegroundColor Cyan

# 1. Backend health
try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 5
    Write-Host "[OK] Backend /health - $($r.status)" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Backend not ready" -ForegroundColor Red
    exit 1
}

# 2. Frontend
try {
    $r = Invoke-WebRequest -Uri "$FrontendUrl/en" -UseBasicParsing -TimeoutSec 10
    Write-Host "[OK] Frontend /en - Status $($r.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Frontend not ready" -ForegroundColor Red
}

# 3. Documents list
try {
    $docs = Invoke-RestMethod -Uri "$BaseUrl/api/documents" -TimeoutSec 5
    Write-Host "[OK] GET /api/documents - $($docs.Count) docs" -ForegroundColor Green
    $docId = if ($docs.Count -gt 0) { $docs[0].id } else { $null }
} catch {
    Write-Host "[FAIL] /api/documents" -ForegroundColor Red
    $docId = $null
}

# 4. Upload (if test PDF exists)
$testPdf = "$PSScriptRoot\tmp\test-sample.pdf"
if (Test-Path $testPdf) {
    try {
        $form = @{ file = Get-Item $testPdf }
        $r = Invoke-RestMethod -Uri "$BaseUrl/api/upload/direct" -Method Post -Form $form -TimeoutSec 30
        $docId = $r.document_id
        Write-Host "[OK] POST /api/upload/direct - doc_id: $docId" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] /api/upload/direct" -ForegroundColor Red
    }
}

# 5. Translate (need valid doc_id)
if ($docId) {
    try {
        $body = '{"document_id":"' + $docId + '","source_lang":"zh","target_lang":"en"}'
        $r = Invoke-RestMethod -Uri "$BaseUrl/api/translate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
        Write-Host "[OK] POST /api/translate - task_id: $($r.task_id)" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] /api/translate - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# 6. Tasks list
try {
    $tasks = Invoke-RestMethod -Uri "$BaseUrl/api/tasks" -TimeoutSec 5
    Write-Host "[OK] GET /api/tasks - $($tasks.Count) tasks" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] /api/tasks" -ForegroundColor Red
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
