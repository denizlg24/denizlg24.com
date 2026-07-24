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

$process = $null
try {
  & bun apps/api/scripts/ops-smoke-user.ts setup

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
    $code = & curl.exe -s -o NUL -w "%{http_code}" `
      "http://127.0.0.1:13010/healthz"
    if ($code -eq "200") {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    throw "API failed to start: $(Get-Content -Raw $stderr)"
  }

  $cookie = Join-Path $smokeRoot "cookies.txt"
  $signIn = @{
    username = "ops-smoke"
    password = $smokePassword
  } | ConvertTo-Json -Compress
  & curl.exe -sS -c $cookie `
    -H "Origin: http://localhost:3000" `
    -H "Content-Type: application/json" `
    --data-binary $signIn `
    "http://127.0.0.1:13010/api/auth/sign-in/username" |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Sign-in request failed"
  }

  & bun apps/api/scripts/ops-smoke-user.ts activate

  $scheduledAt = (Get-Date).ToUniversalTime().AddHours(1).ToString("o")
  $taskBody = @{
    name = "Ops smoke PostgreSQL backup"
    type = "backup_postgres"
    scheduledAt = $scheduledAt
    config = @{ retentionCount = 1 }
  } | ConvertTo-Json -Compress
  $taskJson = & curl.exe -sS -b $cookie `
    -H "Origin: http://localhost:3000" `
    -H "Content-Type: application/json" `
    --data-binary $taskBody `
    "http://127.0.0.1:13010/api/ops/tasks"
  $task = $taskJson | ConvertFrom-Json
  if (-not $task.data.id) {
    throw "Task creation failed: $taskJson"
  }

  $triggerJson = & curl.exe -sS -b $cookie `
    -H "Origin: http://localhost:3000" `
    -X POST `
    "http://127.0.0.1:13010/api/ops/tasks/$($task.data.id)/run"
  $trigger = $triggerJson | ConvertFrom-Json
  if (-not $trigger.data.id) {
    throw "Task trigger failed: $triggerJson"
  }

  $completed = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    $runsJson = & curl.exe -sS -b $cookie `
      "http://127.0.0.1:13010/api/ops/tasks/$($task.data.id)/runs"
    $runs = $runsJson | ConvertFrom-Json
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

  $metricsJson = & curl.exe -sS -b $cookie `
    "http://127.0.0.1:13010/api/ops/metrics?series=host:cpu.usage_percent&step=30"
  $metrics = $metricsJson | ConvertFrom-Json
  if ($null -eq $metrics.data.series) {
    throw "Metrics query failed: $metricsJson"
  }
  $overviewCode = & curl.exe -s -o NUL -w "%{http_code}" -b $cookie `
    "http://127.0.0.1:13010/api/ops/overview"

  Write-Output (
    "task=$($task.data.id) run=$($trigger.data.id) status=completed " +
    "artifact=$($artifact.Name) metricsPoints=" +
    "$($metrics.data.series[0].points.Count) overviewHttp=$overviewCode"
  )
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  & bun apps/api/scripts/ops-smoke-user.ts cleanup

  if (Test-Path $smokeRoot) {
    $resolvedSmoke = (Resolve-Path $smokeRoot).Path
    $expectedPrefix = $workspace + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedSmoke.StartsWith($expectedPrefix)) {
      throw "Refusing to remove smoke directory outside workspace"
    }
    Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force
  }
}
