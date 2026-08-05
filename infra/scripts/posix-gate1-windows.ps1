$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Mode = "--dry-run"
$Server = ""
$Share = ""
$SshHost = ""
$EvidencePath = ""

function Show-Usage {
    [Console]::Error.WriteLine("Usage: .\posix-gate1-windows.ps1 [--dry-run|--execute] --host HOST --share SHARE [--ssh-host USER@HOST] [--evidence PATH]")
    [Console]::Error.WriteLine("Execute tests the Windows SMB redirector, not Explorer UI or a real Office application.")
    [Console]::Error.WriteLine("--ssh-host enables bounded Personal-share API/SMB concurrency probes through the fixed peer wrapper.")
    [Console]::Error.WriteLine("It prompts only for an SMB credential and only writes inside unique disposable test folders.")
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
        "--ssh-host" {
            $Index++
            if ($Index -ge $args.Count) { Show-Usage; exit 2 }
            $SshHost = $args[$Index]
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
if (-not [string]::IsNullOrWhiteSpace($SshHost)) {
    if ($SshHost.StartsWith("-") -or $SshHost -notmatch '^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+$') {
        [Console]::Error.WriteLine("SSH HOST contains unsupported characters")
        exit 2
    }
    if ($Share -ine "Personal") {
        [Console]::Error.WriteLine("--ssh-host concurrency probes require the Personal share")
        exit 2
    }
}

$ConcurrencyEnabled = -not [string]::IsNullOrWhiteSpace($SshHost)

if ($Mode -eq "--dry-run") {
    [ordered]@{
        mode = "dry-run"
        platform = "windows"
        host = $Server
        share = $Share
        writes = $false
        credentials = "interactive PSCredential only"
        concurrencyEnabled = $ConcurrencyEnabled
        coverage = @(
            "Windows SMB redirector",
            "filesystem operations",
            "alternate-data-stream round trip",
            "disconnect/reconnect"
        ) + $(if ($ConcurrencyEnabled) { @("FileShare.None versus direct API replace/rename/unlink", "shared-delete atomic-replace lost-update behavior") } else { @() })
        excludedCoverage = @(
            "Explorer UI workflows",
            "shell thumbnails and properties",
            "real Office application saves",
            "sleep and network-loss recovery"
        ) + $(if ($ConcurrencyEnabled) { @() } else { @("direct API/SMB concurrency (requires --ssh-host on Personal)") })
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

function Get-StreamSha256 {
    param([Parameter(Mandatory = $true)][IO.Stream]$Stream)

    $OriginalPosition = $Stream.Position
    $Hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace("-", "").ToUpperInvariant()
    } finally {
        $Stream.Position = $OriginalPosition
        $Hasher.Dispose()
    }
}

function Invoke-ApiPeer {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("seed", "atomic-replace", "rename", "unlink")][string]$Action,
        [string]$Generation = "",
        [ValidateSet("payload", "renamed")][string]$Target = "payload"
    )

    if (-not $ConcurrencyEnabled) { throw "The API peer requires --ssh-host" }
    $Ssh = Get-Command ssh -ErrorAction SilentlyContinue
    if ($null -eq $Ssh) { throw "OpenSSH ssh is required for API peer probes" }

    $RemoteArguments = @(
        "sudo", "-n",
        "/tmp/posix-gate1-kit/infra/scripts/posix-gate1-peer-container.sh",
        "--execute", "--action", $Action, "--run-id", $RunId, "--target", $Target
    )
    if (-not [string]::IsNullOrWhiteSpace($Generation)) {
        $RemoteArguments += @("--generation", $Generation)
    }
    $SshArguments = @(
        "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
        "-o", "ConnectionAttempts=1", $SshHost
    ) + $RemoteArguments
    $StderrPath = Join-Path $LocalWork ("ssh-{0}-{1}.stderr" -f $Action, [Guid]::NewGuid().ToString("N"))

    try {
        $OutputLines = @(& $Ssh.Source @SshArguments 2> $StderrPath)
        $ExitCode = $LASTEXITCODE
        $PeerResult = $null
        foreach ($Line in $OutputLines) {
            if ([string]::IsNullOrWhiteSpace([string]$Line)) { continue }
            try {
                $Candidate = ([string]$Line) | ConvertFrom-Json
                if ([string]$Candidate.peer -eq "posix-gate1") { $PeerResult = $Candidate }
            } catch {}
        }
        if ($null -eq $PeerResult) { throw "The API peer did not return a valid result" }
        if ([string]$PeerResult.runId -ne $RunId -or [string]$PeerResult.action -ne $Action) {
            throw "The API peer result did not match the requested action"
        }
        $PeerOk = [bool]$PeerResult.ok
        if (($ExitCode -eq 0) -ne $PeerOk) { throw "The API peer exit status contradicted its result" }
        return [pscustomobject]@{
            Action = $Action
            Details = $PeerResult.details
            ErrorCode = if ($null -ne $PeerResult.PSObject.Properties["errorCode"]) { [string]$PeerResult.errorCode } else { "" }
            ExitCode = $ExitCode
            Ok = $PeerOk
        }
    } finally {
        Remove-Item -LiteralPath $StderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Assert-PeerSuccess {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$Event
    )

    $Status = if ($Result.Ok -and $Result.ExitCode -eq 0) { "pass" } else { "fail" }
    Write-Evidence -Event $Event -Status $Status -Details @{
        action = $Result.Action
        errorCode = $Result.ErrorCode
        exitCode = $Result.ExitCode
        sshEndpointValidated = $true
        transport = "ssh-direct-api-container"
    }
    if ($Status -ne "pass") { throw "The direct API peer action failed unexpectedly" }
}

$RemotePath = "\\{0}\{1}" -f $Server, $Share
$DriveName = $null
$RemoteRoot = $null
$PeerRoot = $null
$LocalWork = Join-Path ([IO.Path]::GetTempPath()) ("posix-gate1-windows-{0}" -f $RunId)
$Credential = $null
$RemoteCreated = $false
$PeerRootCreated = $false
$ConnectionOwned = $false

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
    $script:ConnectionOwned = $true
    $script:RemoteRoot = "{0}:\.posix-gate1-{1}" -f $DriveName, $RunId
    $script:PeerRoot = "{0}:\posix-gate1-disposable-{1}" -f $DriveName, $RunId
}

function Test-Transport {
    param([Parameter(Mandatory = $true)][string]$ObservationEvent)

    if (-not (Get-Command Get-SmbConnection -ErrorAction SilentlyContinue)) {
        throw "Get-SmbConnection is required to prove SMB encryption"
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
        throw "The SMB encryption state is not observable"
    }
    $Encrypted = [bool]$EncryptedProperty.Value
    $ObservationStatus = if ($Encrypted) { "pass" } else { "fail" }
    Write-Evidence -Event $ObservationEvent -Status $ObservationStatus -Details @{ dialect = $Dialect; encryptionObservable = $true; encrypted = $Encrypted }
    if (-not $Encrypted) {
        throw "The SMB session is observably unencrypted"
    }
}

function Get-TargetConnections {
    @(Get-SmbConnection | Where-Object {
        $_.ServerName -ieq $Server -and $_.ShareName -ieq $Share
    })
}

function Assert-NoExistingServerConnection {
    if (-not (Get-Command Get-SmbConnection -ErrorAction SilentlyContinue)) {
        throw "Get-SmbConnection is required to prove connection ownership"
    }
    $Existing = @(Get-SmbConnection | Where-Object { $_.ServerName -ieq $Server })
    if ($Existing.Count -ne 0) {
        throw "An existing SMB connection to the target server prevents an isolated probe"
    }
}

function Disconnect-ProbeShare {
    if (-not [string]::IsNullOrWhiteSpace($DriveName)) {
        $PreviousDriveName = $DriveName
        Remove-PSDrive -Name $PreviousDriveName -Force
        if (Get-PSDrive -Name $PreviousDriveName -ErrorAction SilentlyContinue) {
            throw "The disposable PSDrive remains present"
        }
        $script:DriveName = $null
        $script:RemoteRoot = $null
        $script:PeerRoot = $null
    }
    for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
        if (@(Get-TargetConnections).Count -eq 0) {
            $script:ConnectionOwned = $false
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "The disposable SMB connection remains active"
}

function Reset-PeerPayload {
    $Payload = Join-Path $PeerRoot "payload.bin"
    $Renamed = Join-Path $PeerRoot "renamed.bin"
    if ([IO.File]::Exists($Renamed)) {
        if ([IO.File]::Exists($Payload)) { throw "Both peer payload names are present" }
        [IO.File]::Move($Renamed, $Payload)
    }

    if ([IO.File]::Exists($Payload)) {
        $Reset = Invoke-ApiPeer -Action "atomic-replace" -Generation "A"
    } else {
        $Reset = Invoke-ApiPeer -Action "seed" -Generation "A"
    }
    Assert-PeerSuccess -Result $Reset -Event "api-peer-reset"
}

function Invoke-SharedDeleteLostUpdateProbe {
    $Payload = Join-Path $PeerRoot "payload.bin"
    $Handle = $null
    try {
        $Handle = [IO.File]::Open(
            $Payload,
            [IO.FileMode]::Open,
            [IO.FileAccess]::ReadWrite,
            ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        )
        $HeldHashBefore = Get-StreamSha256 -Stream $Handle
        $Replace = Invoke-ApiPeer -Action "atomic-replace" -Generation "B"
        if (-not $Replace.Ok -or $Replace.ExitCode -ne 0) {
            throw "Atomic replacement was not permitted by an SMB handle sharing delete"
        }

        $PublishedHash = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash
        $HeldHashAfter = Get-StreamSha256 -Stream $Handle
        $ExpectedPublishedHash = [string]$Replace.Details.hash
        if ($HeldHashBefore -ne $HeldHashAfter) { throw "The held pre-replacement handle changed generation" }
        if ($PublishedHash -ne $ExpectedPublishedHash -or $PublishedHash -eq $HeldHashAfter) {
            throw "The replacement path did not expose only the new generation"
        }

        $OldHandleWrite = [Text.Encoding]::ASCII.GetBytes("OLD_HANDLE_WRITE")
        $Handle.Position = 0
        $Handle.Write($OldHandleWrite, 0, $OldHandleWrite.Length)
        $Handle.Flush($true)
        $PublishedHashAfterOldWrite = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash
        if ($PublishedHashAfterOldWrite -ne $PublishedHash) {
            throw "A write through the replaced handle corrupted the published generation"
        }

        Write-Evidence -Event "shared-delete-lost-update" -Status "pass" -Details @{
            directAction = "atomic-replace"
            heldGenerationStable = $true
            oldHandleWriteChangedPublishedPath = $false
            peerExitCode = $Replace.ExitCode
            sshEndpointValidated = $true
            transport = "ssh-direct-api-container"
        }
    } catch {
        Write-Evidence -Event "shared-delete-lost-update" -Status "fail" -Details @{
            directAction = "atomic-replace"
            errorType = $_.Exception.GetType().FullName
        }
        throw
    } finally {
        if ($null -ne $Handle) { $Handle.Dispose() }
    }
}

function Invoke-ExclusivePeerAction {
    param([Parameter(Mandatory = $true)][ValidateSet("atomic-replace", "rename", "unlink")][string]$Action)

    $Payload = Join-Path $PeerRoot "payload.bin"
    $Renamed = Join-Path $PeerRoot "renamed.bin"
    $Handle = $null
    try {
        $Handle = [IO.File]::Open($Payload, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $HeldHashBefore = Get-StreamSha256 -Stream $Handle

        $SecondOpen = $null
        $SecondOpenDenied = $false
        try {
            $SecondOpen = [IO.File]::Open($Payload, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        } catch [IO.IOException] {
            $SecondOpenDenied = $true
        } finally {
            if ($null -ne $SecondOpen) { $SecondOpen.Dispose() }
        }
        if (-not $SecondOpenDenied) { throw "FileShare.None did not deny a second SMB open" }

        $Peer = if ($Action -eq "atomic-replace") {
            Invoke-ApiPeer -Action $Action -Generation "B"
        } else {
            Invoke-ApiPeer -Action $Action
        }
        $HeldHashAfter = $null
        $HeldHashObservable = $true
        try {
            $HeldHashAfter = Get-StreamSha256 -Stream $Handle
        } catch {
            $HeldHashObservable = $false
        }
        $ExpectedBlockCodes = @("EACCES", "EBUSY", "EPERM", "ETXTBSY")
        $DirectActionBlocked = (-not $Peer.Ok) -and ($ExpectedBlockCodes -contains $Peer.ErrorCode)
        $DirectActionSucceeded = $Peer.Ok -and $Peer.ExitCode -eq 0
        $Status = if ($DirectActionBlocked) { "pass" } else { "fail" }

        Write-Evidence -Event ("fileshare-none-api-{0}" -f $Action) -Status $Status -Details @{
            directActionBlocked = $DirectActionBlocked
            directActionSucceeded = $DirectActionSucceeded
            errorCode = $Peer.ErrorCode
            heldGenerationStable = if ($HeldHashObservable) { $HeldHashBefore -eq $HeldHashAfter } else { $null }
            heldHandleObservableAfterAction = $HeldHashObservable
            peerExitCode = $Peer.ExitCode
            secondSmbOpenDenied = $SecondOpenDenied
            sshEndpointValidated = $true
            transport = "ssh-direct-api-container"
            payloadPresent = [IO.File]::Exists($Payload)
            renamedPresent = [IO.File]::Exists($Renamed)
        }

        if ($DirectActionSucceeded) { return $true }
        if (-not $DirectActionBlocked) {
            throw "The API peer failed without proving an expected sharing denial"
        }
        return $false
    } catch {
        if ($_.Exception.Message -eq "FileShare.None did not deny a second SMB open") {
            Write-Evidence -Event ("fileshare-none-api-{0}" -f $Action) -Status "fail" -Details @{
                directAction = $Action
                errorType = $_.Exception.GetType().FullName
                secondSmbOpenDenied = $false
            }
        }
        throw
    } finally {
        if ($null -ne $Handle) { $Handle.Dispose() }
    }
}

try {
    [IO.Directory]::CreateDirectory($LocalWork) | Out-Null
    $ConcurrencyViolations = @()
    Write-Evidence -Event "run" -Status "start"
    Write-Evidence -Event "coverage" -Status "pass" -Details @{
        concurrencyEnabled = $ConcurrencyEnabled
        measured = @(
            "Windows SMB redirector",
            "filesystem operations",
            "alternate-data-stream round trip",
            "disconnect/reconnect"
        ) + $(if ($ConcurrencyEnabled) { @("FileShare.None versus direct API replace/rename/unlink", "shared-delete atomic-replace lost-update behavior") } else { @() })
        excluded = @(
            "Explorer UI workflows",
            "shell thumbnails and properties",
            "real Office application saves",
            "sleep and network-loss recovery"
        ) + $(if ($ConcurrencyEnabled) { @() } else { @("direct API/SMB concurrency (requires --ssh-host on Personal)") })
    }
    Invoke-Probe -Name "existing-session-preflight" -Action { Assert-NoExistingServerConnection }

    $Credential = Get-Credential -Message ("Credentials for the disposable SMB target {0}" -f $RemotePath)
    if ($null -eq $Credential) {
        throw "Credential entry was cancelled"
    }

    Invoke-Probe -Name "connect" -Action { Connect-ProbeShare }
    Invoke-Probe -Name "transport" -Action { Test-Transport -ObservationEvent "transport-observation" }

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

    Invoke-Probe -Name "temp-file-replace" -Action {
        $Target = Join-Path $RemoteRoot "replace-target.bin"
        $Temporary = Join-Path $RemoteRoot (".replace-{0}.tmp" -f $RunId)
        [IO.File]::WriteAllText($Target, "replace-old`n")
        [IO.File]::WriteAllText($Temporary, "replace-new`n")
        Move-Item -LiteralPath $Temporary -Destination $Target -Force
        if ([IO.File]::ReadAllText($Target) -ne "replace-new`n") { throw "Temporary-file replacement mismatch" }
    }

    Invoke-Probe -Name "reconnect" -Action {
        Disconnect-ProbeShare
        Connect-ProbeShare
        $RemoteUpload = Join-Path $RemoteRoot "upload.bin"
        $LocalUpload = Join-Path $LocalWork "upload.bin"
        if ((Get-FileHash -LiteralPath $RemoteUpload -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $LocalUpload -Algorithm SHA256).Hash) {
            throw "Reconnect hash mismatch"
        }
        Test-Transport -ObservationEvent "transport-after-reconnect-observation"
    }

    if ($ConcurrencyEnabled) {
        Invoke-Probe -Name "peer-root-create" -Action {
            [IO.Directory]::CreateDirectory($PeerRoot) | Out-Null
            $script:PeerRootCreated = $true
            $Marker = Join-Path $PeerRoot ".posix-gate1-disposable"
            [IO.File]::WriteAllText($Marker, "deniz-cloud-posix-gate1`n", [Text.UTF8Encoding]::new($false))
            if ([IO.File]::ReadAllText($Marker) -ne "deniz-cloud-posix-gate1`n") {
                throw "The peer root marker did not round trip exactly"
            }
        }

        $Seed = Invoke-ApiPeer -Action "seed" -Generation "A"
        Assert-PeerSuccess -Result $Seed -Event "api-peer-seed"

        Invoke-SharedDeleteLostUpdateProbe
        Reset-PeerPayload

        foreach ($Action in @("atomic-replace", "rename", "unlink")) {
            $Violation = Invoke-ExclusivePeerAction -Action $Action
            if ($Violation) { $ConcurrencyViolations += $Action }
            Reset-PeerPayload
        }

        Invoke-Probe -Name "peer-root-cleanup" -Action {
            if (-not $PeerRootCreated -or [string]::IsNullOrWhiteSpace($PeerRoot)) {
                throw "The disposable peer root is not owned by this probe"
            }
            Remove-Item -LiteralPath $PeerRoot -Recurse -Force
            if (Test-Path -LiteralPath $PeerRoot) { throw "The disposable peer root remains present" }
            $script:PeerRootCreated = $false
        }
    }

    Invoke-Probe -Name "remote-cleanup" -Action {
        if (-not $RemoteCreated -or [string]::IsNullOrWhiteSpace($RemoteRoot)) { throw "The disposable test root is not owned by this probe" }
        Remove-Item -LiteralPath $RemoteRoot -Recurse -Force
        if (Test-Path -LiteralPath $RemoteRoot) { throw "The disposable test root remains present" }
        $script:RemoteCreated = $false
    }

    Invoke-Probe -Name "disconnect" -Action { Disconnect-ProbeShare }

    if ($ConcurrencyViolations.Count -ne 0) {
        Write-Evidence -Event "fileshare-none-api-summary" -Status "fail" -Details @{
            stop = $true
            succeededWhileExclusive = $ConcurrencyViolations
        }
        throw "STOP: direct API namespace mutation succeeded while Windows held FileShare.None"
    }

    Write-Evidence -Event "run" -Status "pass"
    [ordered]@{
        mode = "execute"
        platform = "windows"
        host = $Server
        share = $Share
        status = "pass"
        concurrencyEnabled = $ConcurrencyEnabled
        coverage = if ($ConcurrencyEnabled) { "Windows SMB redirector and direct API concurrency semantics" } else { "Windows SMB redirector filesystem semantics only" }
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
        if ($PeerRootCreated -and -not [string]::IsNullOrWhiteSpace($PeerRoot) -and (Test-Path -LiteralPath $PeerRoot -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $PeerRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {}
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
        if ($ConnectionOwned -and (Get-Command Remove-SmbMapping -ErrorAction SilentlyContinue)) {
            Remove-SmbMapping -RemotePath $RemotePath -Force -UpdateProfile:$false -ErrorAction SilentlyContinue
        }
    } catch {}
    try {
        if ([IO.Directory]::Exists($LocalWork)) {
            [IO.Directory]::Delete($LocalWork, $true)
        }
    } catch {}
    $Credential = $null
}
