$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$smokeRoot = Join-Path $workspace ".tmp\ops-smoke"
$ssdPath = Join-Path $smokeRoot "ssd"
$hddPath = Join-Path $smokeRoot "hdd"
$backupPath = Join-Path $smokeRoot "backups"
New-Item -ItemType Directory -Force -Path $ssdPath, $hddPath, $backupPath |
  Out-Null

$config = @{}
foreach (
  $line in Get-Content -LiteralPath (
    Join-Path $workspace "infra\compose\.env.dev"
  )
) {
  if ($line -match "^([^#=]+)=(.*)$") {
    $config[$matches[1]] = $matches[2]
  }
}

$postgresUser = [Uri]::EscapeDataString($config.POSTGRES_USER)
$postgresPassword = [Uri]::EscapeDataString($config.POSTGRES_PASSWORD)
$postgresDatabase = [Uri]::EscapeDataString($config.POSTGRES_DB)
$mongoUser = [Uri]::EscapeDataString($config.MONGO_INITDB_ROOT_USERNAME)
$mongoPassword = [Uri]::EscapeDataString($config.MONGO_INITDB_ROOT_PASSWORD)
$redisPassword = [Uri]::EscapeDataString($config.REDIS_PASSWORD)
$databaseUrl =
  "postgresql://${postgresUser}:${postgresPassword}@127.0.0.1:5433/${postgresDatabase}"
$mongoUrl =
  "mongodb://${mongoUser}:${mongoPassword}@127.0.0.1:27018/?authSource=admin&directConnection=true"
$redisUrl = "redis://default:${redisPassword}@127.0.0.1:6380"
$smokePassword = "ops-smoke-password-006"

$env:OPS_SMOKE_DATABASE_URL = $databaseUrl
$env:OPS_SMOKE_PASSWORD = $smokePassword

function Invoke-SmokeRequest {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [string]$Method = "GET",
    [Parameter(Mandatory = $true)]
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [string]$Body
  )

  $request = @{
    Uri = $Uri
    Method = $Method
    WebSession = $Session
    Headers = @{ Origin = "http://localhost:3000" }
    TimeoutSec = 30
  }
  if ($PSBoundParameters.ContainsKey("Body")) {
    $request.Body = $Body
    $request.ContentType = "application/json"
  }
  $response = Invoke-WebRequest @request
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "$Method $Uri failed with HTTP $($response.StatusCode)"
  }
  return $response
}

$process = $null
try {
  & bun apps/api/scripts/ops-smoke-user.ts setup
  if ($LASTEXITCODE -ne 0) {
    throw "ops-smoke-user.ts setup failed"
  }

  $env:DATABASE_URL = $databaseUrl
  $env:REDIS_ADMIN_URL = $redisUrl
  $env:MONGODB_URI = $mongoUrl
  $env:MONGODB_ADMIN_URI = $mongoUrl
  $env:BETTER_AUTH_SECRET = "ops-smoke-better-auth-secret-000000000006"
  $env:BETTER_AUTH_URL = "http://127.0.0.1:13010"
  Remove-Item Env:COOKIE_DOMAIN -ErrorAction SilentlyContinue
  $env:MEILISEARCH_URL = "http://127.0.0.1:7700"
  $env:MEILISEARCH_ADMIN_KEY = $config.MEILI_MASTER_KEY
  $env:SSD_STORAGE_PATH = $ssdPath
  $env:HDD_STORAGE_PATH = $hddPath
  $env:BACKUP_DIR = $backupPath
  $env:JWT_SECRET = "ops-smoke-jwt-secret-000000000000000006"
  $env:DATABASE_CREDENTIAL_ENCRYPTION_KEY =
    "ops-smoke-database-key-000000000000006"
  $env:S3_CREDENTIAL_ENCRYPTION_KEY =
    "ops-smoke-s3-key-000000000000000000006"
  $env:DOCKER_HOST = "http://127.0.0.1:23750"
  $env:PORT = "13010"
  $env:NODE_ENV = "development"
  $env:MONGOT_HEALTH_URL = "http://127.0.0.1:18080"

  $stdout = Join-Path $smokeRoot "api.stdout.log"
  $stderr = Join-Path $smokeRoot "api.stderr.log"
  $bunCommand = (Get-Command bun.cmd).Source
  $bunExecutable = Join-Path (Split-Path $bunCommand) `
    "node_modules\bun\bin\bun.exe"
  if (-not (Test-Path -LiteralPath $bunExecutable -PathType Leaf)) {
    throw "Unable to resolve the Bun executable from $bunCommand"
  }
  $process = Start-Process `
    -FilePath $bunExecutable `
    -ArgumentList @("apps/api/src/index.ts") `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $healthResponse = Invoke-WebRequest `
        -Uri "http://127.0.0.1:13010/healthz" `
        -Method Get `
        -TimeoutSec 2
      if ($healthResponse.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      # The API may not have bound its port yet.
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    throw "API failed to start: $(Get-Content -Raw $stderr)"
  }

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $signIn = @{
    username = "ops-smoke"
    password = $smokePassword
  } | ConvertTo-Json -Compress
  Invoke-SmokeRequest `
    -Uri "http://127.0.0.1:13010/api/auth/sign-in/username" `
    -Method Post `
    -Session $session `
    -Body $signIn |
    Out-Null

  & bun apps/api/scripts/ops-smoke-user.ts activate
  if ($LASTEXITCODE -ne 0) {
    throw "ops-smoke-user.ts activate failed"
  }

  $scheduledAt = (Get-Date).ToUniversalTime().AddHours(1).ToString("o")
  $taskBody = @{
    name = "Ops smoke PostgreSQL backup"
    type = "backup_postgres"
    scheduledAt = $scheduledAt
    config = @{ retentionCount = 1 }
  } | ConvertTo-Json -Compress
  $taskResponse = Invoke-SmokeRequest `
    -Uri "http://127.0.0.1:13010/api/ops/tasks" `
    -Method Post `
    -Session $session `
    -Body $taskBody
  $task = $taskResponse.Content | ConvertFrom-Json
  if (-not $task.data.id) {
    throw "Task creation failed: $($taskResponse.Content)"
  }

  $triggerResponse = Invoke-SmokeRequest `
    -Uri "http://127.0.0.1:13010/api/ops/tasks/$($task.data.id)/run" `
    -Method Post `
    -Session $session
  $trigger = $triggerResponse.Content | ConvertFrom-Json
  if (-not $trigger.data.id) {
    throw "Task trigger failed: $($triggerResponse.Content)"
  }

  $completed = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    $runsResponse = Invoke-SmokeRequest `
      -Uri "http://127.0.0.1:13010/api/ops/tasks/$($task.data.id)/runs" `
      -Session $session
    $runs = $runsResponse.Content | ConvertFrom-Json
    $status = $runs.data[0].status
    if ($status -eq "completed") {
      $completed = $true
      break
    }
    if ($status -eq "failed") {
      throw "Backup run failed: $($runs.data[0].error)"
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $completed) {
    throw "Backup run did not complete"
  }

  $artifact = Get-ChildItem -File -Recurse (
    Join-Path $backupPath "postgres"
  ) | Select-Object -First 1
  if (-not $artifact) {
    throw "Backup artifact was not created"
  }

  $metricsResponse = Invoke-SmokeRequest `
    -Uri (
      "http://127.0.0.1:13010/api/ops/metrics" +
      "?series=host:cpu.usage_percent&step=30"
    ) `
    -Session $session
  $metrics = $metricsResponse.Content | ConvertFrom-Json
  if ($null -eq $metrics.data.series) {
    throw "Metrics query failed: $($metricsResponse.Content)"
  }
  $overviewResponse = Invoke-SmokeRequest `
    -Uri "http://127.0.0.1:13010/api/ops/overview" `
    -Session $session

  Write-Output (
    "task=$($task.data.id) run=$($trigger.data.id) status=completed " +
    "artifact=$($artifact.Name) metricsPoints=" +
    "$($metrics.data.series[0].points.Count) " +
    "overviewHttp=$($overviewResponse.StatusCode)"
  )
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  & bun apps/api/scripts/ops-smoke-user.ts cleanup
  $cleanupExitCode = $LASTEXITCODE

  if (Test-Path $smokeRoot) {
    $resolvedSmoke = (Resolve-Path $smokeRoot).Path
    $expectedPrefix = $workspace + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedSmoke.StartsWith($expectedPrefix)) {
      throw "Refusing to remove smoke directory outside workspace"
    }
    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force
  }
  if ($cleanupExitCode -ne 0) {
    throw "ops-smoke-user.ts cleanup failed"
  }
}
