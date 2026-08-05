$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Mode = "--dry-run"
$Server = ""
$Share = ""
$EvidencePath = ""

function Show-Usage {
    [Console]::Error.WriteLine("Usage: .\posix-gate1-windows.ps1 [--dry-run|--execute] --host HOST --share SHARE [--evidence PATH]")
    [Console]::Error.WriteLine("Execute prompts for an SMB credential and only writes inside a unique disposable test folder.")
}

for ($Index = 0; $Index -lt $args.Count; $Index++) {
    switch ($args[$Index]) {
        "--dry-run" { $Mode = "--dry-run" }
        "--execute" { $Mode = "--execute" }
        "--host" {
            $Index++
            if ($Index -ge $args.Count) { Show-Usage; exit 2 }
            $Server = $args[$Index]
        }
        "--share" {
            $Index++
            if ($Index -ge $args.Count) { Show-Usage; exit 2 }
            $Share = $args[$Index]
        }
        "--evidence" {
            $Index++
            if ($Index -ge $args.Count) { Show-Usage; exit 2 }
            $EvidencePath = $args[$Index]
        }
        { $_ -in @("-h", "--help") } { Show-Usage; exit 0 }
        default {
            [Console]::Error.WriteLine("Unknown argument: {0}" -f $args[$Index])
            Show-Usage
            exit 2
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Server) -or [string]::IsNullOrWhiteSpace($Share)) {
    Show-Usage
    exit 2
}
if ($Server -notmatch '^[A-Za-z0-9._-]+$') {
    [Console]::Error.WriteLine("HOST contains unsupported characters")
    exit 2
}
if ($Share -notmatch '^[A-Za-z0-9._$-]+$') {
    [Console]::Error.WriteLine("SHARE contains unsupported characters")
    exit 2
}

if ($Mode -eq "--dry-run") {
    [ordered]@{
        mode = "dry-run"
        platform = "windows"
        host = $Server
        share = $Share
        writes = $false
        credentials = "interactive PSCredential only"
    } | ConvertTo-Json -Compress
    exit 0
}

$RunId = [Guid]::NewGuid().ToString("D")
$DefaultEvidence = [string]::IsNullOrWhiteSpace($EvidencePath)
if ($DefaultEvidence) {
    $EvidenceDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "deniz-cloud\posix-gate1"
    $EvidencePath = Join-Path $EvidenceDirectory ("windows-{0}.jsonl" -f $RunId)
} else {
    $EvidencePath = [IO.Path]::GetFullPath($EvidencePath)
    $EvidenceDirectory = Split-Path -Parent $EvidencePath
}
[IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null

function Set-PrivateAcl {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Directory)

    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($Directory) {
        $Security = New-Object Security.AccessControl.DirectorySecurity
        $Inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
        $Rule = New-Object Security.AccessControl.FileSystemAccessRule($Identity, "FullControl", $Inheritance, "None", "Allow")
        $Security.SetAccessRuleProtection($true, $false)
        $Security.AddAccessRule($Rule)
        Set-Acl -LiteralPath $Path -AclObject $Security
    } else {
        $Security = New-Object Security.AccessControl.FileSecurity
        $Rule = New-Object Security.AccessControl.FileSystemAccessRule($Identity, "FullControl", "Allow")
        $Security.SetAccessRuleProtection($true, $false)
        $Security.AddAccessRule($Rule)
        Set-Acl -LiteralPath $Path -AclObject $Security
    }
}

if ($DefaultEvidence) {
    Set-PrivateAcl -Path $EvidenceDirectory -Directory
}
if ([IO.File]::Exists($EvidencePath)) {
    [Console]::Error.WriteLine("Refusing to overwrite evidence: {0}" -f $EvidencePath)
    exit 1
}
[IO.File]::WriteAllText($EvidencePath, "", [Text.UTF8Encoding]::new($false))
Set-PrivateAcl -Path $EvidencePath

function Write-Evidence {
    param(
        [Parameter(Mandatory = $true)][string]$Event,
        [Parameter(Mandatory = $true)][ValidateSet("start", "pass", "fail")][string]$Status,
        [hashtable]$Details = @{}
    )

    $Entry = [ordered]@{
        schemaVersion = 1
        timestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
        runId = $RunId
        platform = "windows"
        host = $Server
        share = $Share
        event = $Event
        status = $Status
        details = $Details
    }
    $Line = $Entry | ConvertTo-Json -Compress -Depth 5
    [IO.File]::AppendAllText($EvidencePath, $Line + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Invoke-Probe {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    try {
        & $Action
        Write-Evidence -Event $Name -Status "pass"
    } catch {
        Write-Evidence -Event $Name -Status "fail" -Details @{ errorType = $_.Exception.GetType().FullName }
        throw "Probe failed: $Name. See the private evidence file."
    }
}

$RemotePath = "\\{0}\{1}" -f $Server, $Share
$DriveName = $null
$RemoteRoot = $null
$LocalWork = Join-Path ([IO.Path]::GetTempPath()) ("posix-gate1-windows-{0}" -f $RunId)
$Credential = $null
$RemoteCreated = $false

function Find-FreeDriveName {
    foreach ($Letter in [char[]](90..68)) {
        $Name = [string]$Letter
        if (-not (Get-PSDrive -Name $Name -ErrorAction SilentlyContinue)) {
            return $Name
        }
    }
    throw "No disposable drive name is available"
}

function Connect-ProbeShare {
    if ([string]::IsNullOrWhiteSpace($DriveName)) {
        $script:DriveName = Find-FreeDriveName
    }
    New-PSDrive -Name $DriveName -PSProvider FileSystem -Root $RemotePath -Credential $Credential -Scope Script | Out-Null
    $script:RemoteRoot = "{0}:\.posix-gate1-{1}" -f $DriveName, $RunId
}

function Test-Transport {
    if (-not (Get-Command Get-SmbConnection -ErrorAction SilentlyContinue)) {
        Write-Evidence -Event "transport-observation" -Status "pass" -Details @{ dialect = "unknown"; encryptionObservable = $false; encrypted = "unknown" }
        return
    }
    $Connection = Get-SmbConnection | Where-Object {
        $_.ServerName -ieq $Server -and $_.ShareName -ieq $Share
    } | Select-Object -First 1
    if ($null -eq $Connection) {
        throw "No matching SMB connection is observable"
    }
    $Dialect = [string]$Connection.Dialect
    if (-not $Dialect.StartsWith("3.")) {
        throw "The mounted connection is not SMB3"
    }
    $EncryptedProperty = $Connection.PSObject.Properties["Encrypted"]
    if ($null -eq $EncryptedProperty) {
        Write-Evidence -Event "transport-observation" -Status "pass" -Details @{ dialect = $Dialect; encryptionObservable = $false; encrypted = "unknown" }
        return
    }
    $Encrypted = [bool]$EncryptedProperty.Value
    Write-Evidence -Event "transport-observation" -Status "pass" -Details @{ dialect = $Dialect; encryptionObservable = $true; encrypted = $Encrypted }
    if (-not $Encrypted) {
        throw "The SMB session is observably unencrypted"
    }
}

try {
    [IO.Directory]::CreateDirectory($LocalWork) | Out-Null
    $Credential = Get-Credential -Message ("Credentials for the disposable SMB target {0}" -f $RemotePath)
    if ($null -eq $Credential) {
        throw "Credential entry was cancelled"
    }

    Write-Evidence -Event "run" -Status "start"
    Invoke-Probe -Name "connect" -Action { Connect-ProbeShare }
    Invoke-Probe -Name "transport" -Action { Test-Transport }

    Invoke-Probe -Name "test-root-create" -Action {
        [IO.Directory]::CreateDirectory($RemoteRoot) | Out-Null
        $script:RemoteCreated = $true
    }

    Invoke-Probe -Name "enumeration" -Action {
        $Enumeration = Join-Path $RemoteRoot "enumeration"
        [IO.Directory]::CreateDirectory($Enumeration) | Out-Null
        [IO.File]::WriteAllText((Join-Path $Enumeration "alpha.txt"), "alpha`n")
        $UnicodeName = "caf$([char]0x00E9)-$([char]0x6771)$([char]0x4EAC).txt"
        [IO.File]::WriteAllText((Join-Path $Enumeration $UnicodeName), "unicode`n")
        if (@(Get-ChildItem -LiteralPath $Enumeration -File).Count -ne 2) { throw "Enumeration count mismatch" }
    }

    Invoke-Probe -Name "upload-download-sha256" -Action {
        $Upload = Join-Path $LocalWork "upload.bin"
        $Download = Join-Path $LocalWork "download.bin"
        $Bytes = New-Object byte[] (1024 * 1024)
        $Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $Generator.GetBytes($Bytes)
        } finally {
            $Generator.Dispose()
        }
        [IO.File]::WriteAllBytes($Upload, $Bytes)
        $RemoteUpload = Join-Path $RemoteRoot "upload.bin"
        [IO.File]::Copy($Upload, $RemoteUpload)
        [IO.File]::Copy($RemoteUpload, $Download)
        $Expected = (Get-FileHash -LiteralPath $Upload -Algorithm SHA256).Hash
        if ((Get-FileHash -LiteralPath $RemoteUpload -Algorithm SHA256).Hash -ne $Expected) { throw "Upload hash mismatch" }
        if ((Get-FileHash -LiteralPath $Download -Algorithm SHA256).Hash -ne $Expected) { throw "Download hash mismatch" }
    }

    Invoke-Probe -Name "rename" -Action {
        $Source = Join-Path $RemoteRoot "rename-source.txt"
        $Destination = Join-Path $RemoteRoot "renamed.txt"
        [IO.File]::WriteAllText($Source, "rename`n")
        [IO.File]::Move($Source, $Destination)
        if ([IO.File]::Exists($Source) -or -not [IO.File]::Exists($Destination)) { throw "Rename mismatch" }
    }

    Invoke-Probe -Name "case-only-rename" -Action {
        $Source = Join-Path $RemoteRoot "CaseProbe.txt"
        [IO.File]::WriteAllText($Source, "case`n")
        Rename-Item -LiteralPath $Source -NewName "caseprobe.txt"
        $Exact = Get-ChildItem -LiteralPath $RemoteRoot -File | Where-Object { $_.Name -ceq "caseprobe.txt" }
        if (@($Exact).Count -ne 1) { throw "Case-only rename did not preserve the requested spelling" }
    }

    Invoke-Probe -Name "overwrite" -Action {
        $Target = Join-Path $RemoteRoot "overwrite.txt"
        [IO.File]::WriteAllText($Target, "old-content`n")
        [IO.File]::WriteAllText($Target, "new-content-with-different-length`n")
        if ([IO.File]::ReadAllText($Target) -ne "new-content-with-different-length`n") { throw "Overwrite mismatch" }
    }

    Invoke-Probe -Name "alternate-data-stream" -Action {
        $Target = Join-Path $RemoteRoot "ads.txt"
        $Stream = "{0}:gate1" -f $Target
        [IO.File]::WriteAllText($Target, "base`n")
        [IO.File]::WriteAllText($Stream, "gate1-ads")
        if ([IO.File]::ReadAllText($Stream) -ne "gate1-ads") { throw "ADS round trip mismatch" }
        if ([IO.File]::ReadAllText($Target) -ne "base`n") { throw "ADS changed the base stream" }
    }

    Invoke-Probe -Name "office-temp-replace" -Action {
        $Target = Join-Path $RemoteRoot "office-document.docx"
        $Temporary = Join-Path $RemoteRoot (".office-{0}.tmp" -f $RunId)
        [IO.File]::WriteAllText($Target, "office-old`n")
        [IO.File]::WriteAllText($Temporary, "office-new`n")
        Move-Item -LiteralPath $Temporary -Destination $Target -Force
        if ([IO.File]::ReadAllText($Target) -ne "office-new`n") { throw "Office-style replacement mismatch" }
    }

    Invoke-Probe -Name "reconnect" -Action {
        Remove-PSDrive -Name $DriveName -Force
        Connect-ProbeShare
        $RemoteUpload = Join-Path $RemoteRoot "upload.bin"
        $LocalUpload = Join-Path $LocalWork "upload.bin"
        if ((Get-FileHash -LiteralPath $RemoteUpload -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $LocalUpload -Algorithm SHA256).Hash) {
            throw "Reconnect hash mismatch"
        }
    }

    Write-Evidence -Event "run" -Status "pass"
    [ordered]@{
        mode = "execute"
        platform = "windows"
        host = $Server
        share = $Share
        status = "pass"
        evidence = $EvidencePath
    } | ConvertTo-Json -Compress
} catch {
    if ([IO.File]::Exists($EvidencePath)) {
        Write-Evidence -Event "run" -Status "fail" -Details @{ errorType = $_.Exception.GetType().FullName }
    }
    [Console]::Error.WriteLine("Gate-1 Windows probe failed. Evidence: {0}" -f $EvidencePath)
    exit 1
} finally {
    try {
        if ($RemoteCreated -and -not [string]::IsNullOrWhiteSpace($RemoteRoot) -and (Test-Path -LiteralPath $RemoteRoot -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $RemoteRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    try {
        if (-not [string]::IsNullOrWhiteSpace($DriveName)) {
            Remove-PSDrive -Name $DriveName -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    try {
        if ([IO.Directory]::Exists($LocalWork)) {
            [IO.Directory]::Delete($LocalWork, $true)
        }
    } catch {}
    $Credential = $null
}
