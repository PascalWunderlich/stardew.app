[CmdletBinding()]
param(
	[switch]$Once,
	[switch]$PrepareDb
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Join-Path $repoRoot "apps\stardew.app"
$logDir = Join-Path $repoRoot ".logs"
$devOutLog = Join-Path $logDir "startup-dev.out.log"
$devErrLog = Join-Path $logDir "startup-dev.err.log"
$syncLog = Join-Path $logDir "startup-sync.log"
$baseUrl = "http://localhost:3000"
$syncHost = "http://127.0.0.1:3000"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Resolve-Executable {
	param(
		[string]$Name,
		[string[]]$Patterns
	)

	$command = Get-Command $Name -ErrorAction SilentlyContinue |
		Where-Object { $_.Source -notmatch "WindowsApps" } |
		Select-Object -First 1
	if ($command) {
		return $command.Source
	}

	foreach ($pattern in $Patterns) {
		$match = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue |
			Select-Object -First 1
		if ($match) {
			return $match.FullName
		}
	}

	return $null
}

function Resolve-Bun {
	$patterns = @(
		(Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Oven-sh.Bun_*\bun-windows-x64\bun.exe"),
		"C:\Program Files\Bun\bun.exe",
		"C:\Program Files (x86)\Bun\bun.exe"
	)

	return Resolve-Executable -Name "bun" -Patterns $patterns
}

function Resolve-Python {
	$patterns = @(
		(Join-Path $env:LOCALAPPDATA "Programs\Python\Python*\python.exe"),
		"C:\Program Files\Python*\python.exe",
		"C:\Program Files (x86)\Python*\python.exe"
	)

	$command = Get-Command python -ErrorAction SilentlyContinue |
		Where-Object { $_.Source -notmatch "WindowsApps" } |
		Select-Object -First 1
	if ($command) {
		return $command.Source
	}

	$command = Get-Command py -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($command) {
		return $command.Source
	}

	return Resolve-Executable -Name "python" -Patterns $patterns
}

function Test-AppReady {
	param(
		[string]$Url
	)

	try {
		$response = Invoke-WebRequest -Uri "$Url/api" -UseBasicParsing -TimeoutSec 2
		return $response.StatusCode -lt 500
	} catch {
		return $false
	}
}

function Wait-AppReady {
	param(
		[string]$Url,
		[int]$TimeoutSeconds = 180
	)

	$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
	while ([DateTime]::UtcNow -lt $deadline) {
		if (Test-AppReady -Url $Url) {
			return
		}
		Start-Sleep -Seconds 2
	}

	throw "stardew.app did not become ready at $Url within $TimeoutSeconds seconds."
}

function Resolve-DefaultSaveName {
	$configPath = Join-Path $env:USERPROFILE ".config\stardew-app-sync\config.json"
	if (Test-Path $configPath) {
		try {
			$config = Get-Content $configPath -Raw | ConvertFrom-Json
			if ($config.save_name) {
				return [string]$config.save_name
			}
		} catch {
			# Fall back to filesystem discovery.
		}
	}

	$savesRoot = Join-Path $env:APPDATA "StardewValley\Saves"
	if (-not (Test-Path $savesRoot)) {
		throw "Could not find Stardew Valley saves at $savesRoot."
	}

	$save = Get-ChildItem -Path $savesRoot -Directory -ErrorAction SilentlyContinue |
		Where-Object { Test-Path (Join-Path $_.FullName $_.Name) } |
		Sort-Object Name |
		Select-Object -First 1

	if (-not $save) {
		throw "No Stardew Valley save files found in $savesRoot."
	}

	return [string]$save.Name
}

$bunExe = Resolve-Bun
if (-not $bunExe) {
	throw "Could not find Bun. Install Bun or add it to PATH."
}

$pythonExe = Resolve-Python
if (-not $pythonExe) {
	throw "Could not find Python. Install Python 3.12+ or add it to PATH."
}

if ($PrepareDb) {
	$prepLog = Join-Path $logDir "startup-prep.log"
	Write-Host "Preparing local database and schema..."
	Write-Output "" | & $pythonExe (Join-Path $repoRoot "scripts\prep-local-env.py") 2>&1 | Tee-Object -FilePath $prepLog
	if ($LASTEXITCODE -ne 0) {
		throw "Local environment prep failed with exit code $LASTEXITCODE. See $prepLog."
	}
}

if (-not (Test-AppReady -Url $baseUrl)) {
	Write-Host "Starting stardew.app dev server..."
	Start-Process -FilePath $bunExe -ArgumentList @("run", "dev") -WorkingDirectory $repoRoot -RedirectStandardOutput $devOutLog -RedirectStandardError $devErrLog | Out-Null
	Wait-AppReady -Url $baseUrl
} else {
	Write-Host "stardew.app is already running."
}

Write-Host "Syncing local save..."
$syncScript = Join-Path $repoRoot "scripts\sync-save.py"
$syncArgs = @($syncScript)
if ($syncHost) {
	$syncArgs += @("--host", $syncHost)
}
$syncArgs += @("--save-name", (Resolve-DefaultSaveName))
if ($Once) {
	$syncArgs += "--once"
}


$originalPath = $env:PATH
$bunDir = Split-Path $bunExe
if ($env:PATH -notlike "*$bunDir*") {
	$env:PATH = "$bunDir;$env:PATH"
}

try {
	& $pythonExe @syncArgs 2>&1 | Tee-Object -FilePath $syncLog
	if ($LASTEXITCODE -ne 0) {
		throw "Sync helper failed with exit code $LASTEXITCODE. See $syncLog."
	}
} finally {
	$env:PATH = $originalPath
}

Write-Host "Startup complete."