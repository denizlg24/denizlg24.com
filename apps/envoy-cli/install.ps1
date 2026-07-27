$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- CONFIGURATION ---
$repoOwner = "denizlg24"
$repoName = "envoy"
$binaryName = "envy.exe"
$forceTag = "" 
# ---------------------

$installDir = "$env:LOCALAPPDATA\envoy"
$binaryPath = "$installDir\$binaryName"
$zipPath = "$installDir\temp_install.zip"
$zipName = "envoy-x86_64-pc-windows-msvc.zip"

Write-Host "Installing Envoy CLI..." -ForegroundColor Cyan

if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$downloadUrl = ""

try {
    if ($forceTag) {
        Write-Host "Using manual tag: $forceTag" -ForegroundColor Yellow
        $downloadUrl = "https://github.com/$repoOwner/$repoName/releases/download/$forceTag/$zipName"
    }
    else {
        Write-Host "Attempting to auto-detect latest release..." -ForegroundColor Yellow
        
        # 1. Try to get all releases (including pre-releases)
        $releasesUrl = "https://api.github.com/repos/$repoOwner/$repoName/releases"
        try {
            $allReleases = Invoke-RestMethod -Uri $releasesUrl -ErrorAction Stop
        } catch {
            Write-Host "Could not query GitHub API (Repo might be private or rate limited)." -ForegroundColor Red
            Write-Host "Please edit the script and set `$forceTag = 'YOUR_TAG_NAME'" -ForegroundColor Red
            exit 1
        }

        # 2. Pick the very first one (most recent), regardless of stability
        $latestRelease = $allReleases | Select-Object -First 1

        if (!$latestRelease) {
            throw "API worked but returned 0 releases. Did you click 'Publish' on GitHub?"
        }

        Write-Host "Found Release: $($latestRelease.name) (Tag: $($latestRelease.tag_name))" -ForegroundColor Cyan
        
        # 3. Construct URL from the specific asset
        $asset = $latestRelease.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
        
        if ($asset) {
            $downloadUrl = $asset.browser_download_url
        } else {
            # Fallback if asset listing fails but we have the tag
            Write-Host "Could not find asset in API list, trying direct link..." -ForegroundColor DarkGray
            $downloadUrl = "https://github.com/$repoOwner/$repoName/releases/download/$($latestRelease.tag_name)/$zipName"
        }
    }
} catch {
    Write-Host "Error resolving release: $_" -ForegroundColor Red
    exit 1
}

try {
    Write-Host "Downloading from: $downloadUrl" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
} catch {
    Write-Host "Download failed! (404 Not Found)" -ForegroundColor Red
    Write-Host "Double check that '$zipName' exists in the release assets." -ForegroundColor Gray
    exit 1
}

try {
    Write-Host "Extracting..." -ForegroundColor Yellow
    $tempExtractPath = "$installDir\temp_extract"
    if (Test-Path $tempExtractPath) { Remove-Item $tempExtractPath -Recurse -Force }
    
    Expand-Archive -Path $zipPath -DestinationPath $tempExtractPath -Force
    
    # Search for the binary inside the extracted folder (handles subfolders)
    $extractedExe = Get-ChildItem -Path $tempExtractPath -Recurse -Filter "*.exe" | Select-Object -First 1
    
    if (!$extractedExe) {
        throw "No .exe file found inside the downloaded zip."
    }

    Write-Host "Found binary: $($extractedExe.Name)" -ForegroundColor Cyan
    
    # Rename and Move
    Move-Item -Path $extractedExe.FullName -Destination $binaryPath -Force
    
    # Cleanup
    Remove-Item $zipPath -Force
    Remove-Item $tempExtractPath -Recurse -Force
    
    Write-Host "Installed to: $binaryPath" -ForegroundColor Green
} catch {
    Write-Host "Error installing: $_" -ForegroundColor Red
    exit 1
}

# PATH Setup
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    Write-Host "Adding to PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    $env:Path = "$env:Path;$installDir"
    Write-Host "Added to PATH" -ForegroundColor Green
} else {
    Write-Host "Already in PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "Success! Type 'envy --help' to start." -ForegroundColor Green
