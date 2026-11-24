<#
  Pansari Express - one-command deploy (Windows PowerShell 5.1+).

  Run from the folder that contains this file:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1
  or double-click deploy.cmd.

  It is safe to run again: finished steps are remembered in deploy-state.json
  (keep that file private - it holds this project's generated secrets).

  You will be asked to:
    1. sign in to Google (Firebase) in your browser,
    2. put the Firebase project on the Blaze plan (needs a billing card),
    3. sign in to Cloudflare in your browser,
    4. press Enter at a few pauses.
#>
param(
  [string]$ProjectId = '',
  [string]$OwnerPhone = '+918696131859',
  [string]$Region = 'asia-south1'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$StatePath = Join-Path $Root 'deploy-state.json'
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Say($text, $color = 'Cyan') { Write-Host ''; Write-Host "==> $text" -ForegroundColor $color }
function Pause-For($text) { Write-Host ''; Write-Host $text -ForegroundColor Yellow; [void](Read-Host 'Press Enter to continue') }
function Write-NoBom($path, $text) { [IO.File]::WriteAllText($path, $text, $Utf8) }
function New-Secret {
  $b = New-Object byte[] 36
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ([Convert]::ToBase64String($b)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}
function Load-State { if (Test-Path $StatePath) { Get-Content $StatePath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} } }
function Save-State($s) { Write-NoBom $StatePath ($s | ConvertTo-Json -Depth 6) }
function Set-Prop($obj, $name, $value) { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
# Non-interactive helper (output may be captured). Interactive commands are called
# directly at script level so they keep the console for their prompts.
function Run($exe, [string[]]$argsList) {
  & $exe @argsList
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $exe $($argsList -join ' ')" }
}

$state = Load-State

# ------------------------------------------------------------------ 0. tools
Say 'Checking Node.js'
try { $nodeVer = (& node -v).Trim() } catch { $nodeVer = '' }
if (-not $nodeVer -or [int]($nodeVer.TrimStart('v').Split('.')[0]) -lt 22) {
  Write-Host 'Node.js 22 or newer is required. Install the LTS version from https://nodejs.org and run this script again.' -ForegroundColor Red
  exit 1
}
Write-Host "Node $nodeVer OK"

Say 'Installing project packages (first run takes a few minutes)'
Run 'npm' @('install', '--no-audit', '--no-fund')
$Bin = Join-Path $Root 'node_modules\.bin'
$Firebase = Join-Path $Bin 'firebase.cmd'
$Wrangler = Join-Path $Bin 'wrangler.cmd'

# ------------------------------------------------------------------ 1. Firebase sign-in + project
Say 'Signing in to Firebase (a browser window opens)'
& $Firebase login

if (-not $ProjectId) { $ProjectId = $state.projectId }
if (-not $ProjectId) { $ProjectId = 'pansari-express-' + (Get-Random -Minimum 1000 -Maximum 9999) }
Set-Prop $state 'projectId' $ProjectId; Save-State $state

if (-not $state.projectCreated) {
  Say "Creating Firebase project $ProjectId"
  & $Firebase projects:create $ProjectId --display-name 'Pansari Express'
  if ($LASTEXITCODE -ne 0) {
    Pause-For "Could not create '$ProjectId' automatically. Create a project in https://console.firebase.google.com (or accept the Firebase terms there), then run: .\deploy.cmd -ProjectId <your-project-id>"
    exit 1
  }
  Set-Prop $state 'projectCreated' $true; Save-State $state
}
Write-NoBom (Join-Path $Root '.firebaserc') ("{`n  `"projects`": { `"default`": `"$ProjectId`" }`n}`n")

if (-not $state.blaze) {
  Start-Process "https://console.firebase.google.com/project/$ProjectId/usage/details"
  Pause-For "In the browser tab that opened: click 'Modify plan' -> choose Blaze (pay as you go) and add your billing card. Cloud Functions need it. Set a budget alert (e.g. Rs 500) while you are there."
  Set-Prop $state 'blaze' $true; Save-State $state
}

if (-not $state.firestore) {
  Say "Creating the Firestore database in $Region"
  & $Firebase firestore:databases:create '(default)' --location $Region --project $ProjectId
  Set-Prop $state 'firestore' $true; Save-State $state
}

if (-not $state.consoleSteps) {
  Start-Process "https://console.firebase.google.com/project/$ProjectId/authentication/providers"
  Pause-For @"
Two settings in the Firebase console (Claude can do these for you in the browser):
  a) Authentication -> Get started -> Sign-in method: enable 'Phone' and 'Anonymous'.
  b) Storage -> Get started -> production mode, location $Region.
"@
  Set-Prop $state 'consoleSteps' $true; Save-State $state
}

# ------------------------------------------------------------------ 2. secrets
if (-not $state.secrets) {
  $s = [pscustomobject]@{ qrKey = (New-Secret); edge = (New-Secret); irp = (New-Secret) }
  Set-Prop $state 'secrets' $s; Save-State $state
}
$qrJson = '{"k1":"' + $state.secrets.qrKey + '"}'

if (-not $state.firebaseSecrets) {
  Say 'Saving secrets in Google Secret Manager'
  $tmp = Join-Path $env:TEMP ('px-' + [guid]::NewGuid().ToString('N'))
  Write-NoBom $tmp $qrJson
  Run $Firebase @('functions:secrets:set', 'QR_HMAC_KEYS', '--data-file', $tmp, '--project', $ProjectId)
  Write-NoBom $tmp $state.secrets.edge
  Run $Firebase @('functions:secrets:set', 'EDGE_SHARED_SECRET', '--data-file', $tmp, '--project', $ProjectId)
  Remove-Item $tmp -Force
  Set-Prop $state 'firebaseSecrets' $true; Save-State $state
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'functions\deploy') | Out-Null
Write-NoBom (Join-Path $Root 'functions\deploy\.env') @"
BOOTSTRAP_PHONE=$OwnerPhone
PAYMENTS_MODE=mock
MOCK_IRP_KEY=$($state.secrets.irp)
ENFORCE_APP_CHECK=false
"@

# ------------------------------------------------------------------ 3. web app config
if (-not $state.web) {
  Say 'Registering the web app with Firebase'
  $created = (& $Firebase apps:create WEB 'Pansari Web' --project $ProjectId --json) -join "`n" | ConvertFrom-Json
  $appId = $created.result.appId
  $cfg = ((& $Firebase apps:sdkconfig WEB $appId --project $ProjectId --json) -join "`n" | ConvertFrom-Json).result.sdkConfig
  if (-not $cfg.apiKey) { throw 'Could not read the web app config from Firebase' }
  Set-Prop $state 'web' $cfg; Save-State $state
}
$web = $state.web
$projectNumber = $web.messagingSenderId

# ------------------------------------------------------------------ 4. Cloudflare edge worker
Push-Location (Join-Path $Root 'edge\worker')
try {
  Say 'Signing in to Cloudflare (a browser window opens)'
  & $Wrangler login

  $toml = Get-Content 'wrangler.toml' -Raw
  if (-not $state.kvId) {
    Say 'Creating the KV namespace'
    $out = (& $Wrangler kv namespace create EPHEMERAL) -join "`n"
    $m = [regex]::Match($out, '[0-9a-f]{32}')
    if (-not $m.Success) { throw "Could not read the KV namespace id from: $out" }
    Set-Prop $state 'kvId' $m.Value; Save-State $state
  }
  $set = {
    param($t, $key, $val)
    [regex]::Replace($t, "(?m)^$key = .*$", "$key = `"$val`"")
  }
  $toml = [regex]::Replace($toml, '(?m)^id = .*$', "id = `"$($state.kvId)`"")
  $toml = [regex]::Replace($toml, '(?m)^preview_id = .*$', "preview_id = `"$($state.kvId)`"")
  $toml = & $set $toml 'FIREBASE_PROJECT_ID' $ProjectId
  $toml = & $set $toml 'FIREBASE_PROJECT_NUMBER' $projectNumber
  $toml = & $set $toml 'PUBLIC_WEB_BASE_URL' "https://$ProjectId.web.app"
  $toml = & $set $toml 'FUNCTIONS_BASE_URL' "https://$Region-$ProjectId.cloudfunctions.net"
  $toml = & $set $toml 'FIRESTORE_REST_BASE' 'https://firestore.googleapis.com/v1'
  $toml = & $set $toml 'ALLOWED_ORIGINS' "https://$ProjectId.web.app,https://$ProjectId.firebaseapp.com"
  $toml = & $set $toml 'AUTH_EMULATOR' 'false'
  Write-NoBom (Join-Path (Get-Location) 'wrangler.toml') $toml

  Say 'Building @pansari/shared for the worker'
  Push-Location $Root; Run 'npm' @('run', 'build', '-w', '@pansari/shared'); Pop-Location

  Say 'Deploying the edge worker'
  $deployOut = (& $Wrangler deploy) -join "`n"
  Write-Host $deployOut
  if ($LASTEXITCODE -ne 0) {
    # Usually a first-time Cloudflare account that still has to pick a workers.dev name.
    Write-Host 'Retrying interactively - answer any Cloudflare question below.' -ForegroundColor Yellow
    & $Wrangler deploy
    if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }
  }
  $u = [regex]::Match($deployOut, 'https://[a-z0-9.-]+\.workers\.dev')
  if ($u.Success) { Set-Prop $state 'edgeUrl' $u.Value; Save-State $state }
  if (-not $state.edgeUrl) { Set-Prop $state 'edgeUrl' ((Read-Host 'Paste the https://...workers.dev URL printed above').Trim().TrimEnd('/')); Save-State $state }

  Say 'Saving worker secrets'
  $secretFile = Join-Path $env:TEMP ('px-' + [guid]::NewGuid().ToString('N') + '.json')
  Write-NoBom $secretFile (([pscustomobject]@{ QR_HMAC_KEYS = $qrJson; EDGE_SHARED_SECRET = $state.secrets.edge }) | ConvertTo-Json -Compress)
  Run $Wrangler @('secret', 'bulk', $secretFile)
  Remove-Item $secretFile -Force
}
finally { Pop-Location }

# ------------------------------------------------------------------ 5. build web app
Say 'Building the web app'
Write-NoBom (Join-Path $Root 'apps\web\.env.production') @"
NEXT_PUBLIC_DATA_MODE=firebase
NEXT_PUBLIC_FIREBASE_API_KEY=$($web.apiKey)
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$($web.authDomain)
NEXT_PUBLIC_FIREBASE_PROJECT_ID=$($web.projectId)
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$($web.storageBucket)
NEXT_PUBLIC_FIREBASE_APP_ID=$($web.appId)
NEXT_PUBLIC_FUNCTIONS_REGION=$Region
NEXT_PUBLIC_USE_EMULATORS=false
NEXT_PUBLIC_EDGE_URL=$($state.edgeUrl)
"@
Run 'npm' @('run', 'build', '-w', '@pansari/adapters')
Run 'npm' @('run', 'build', '-w', '@pansari/web')

# ------------------------------------------------------------------ 6. deploy Firebase
Say 'Deploying Firestore rules + indexes, Storage rules, Cloud Functions and the website'
Run $Firebase @('deploy', '--only', 'firestore,storage,functions,hosting', '--project', $ProjectId, '--force')

Say 'Done!' 'Green'
Write-Host "Website     : https://$ProjectId.web.app" -ForegroundColor Green
Write-Host "Edge API    : $($state.edgeUrl)/health" -ForegroundColor Green
Write-Host ''
Write-Host "Next: open https://$ProjectId.web.app/login, sign in with $OwnerPhone, then press" -ForegroundColor Green
Write-Host "'First-time setup: make me the shop owner'. It loads the sample shop and opens the seller portal." -ForegroundColor Green
