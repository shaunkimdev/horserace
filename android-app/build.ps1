param(
    [string]$JavaHome,
    [string]$SdkRoot,
    [string]$GradleHome,
    [switch]$Offline,
    [switch]$IncludeDeviceTests
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

if (-not $JavaHome) { $JavaHome = [Environment]::GetEnvironmentVariable('JAVA_HOME') }
if (-not $JavaHome) {
    $javaCandidates = @(Get-ChildItem (Join-Path $projectRoot '.tools') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $javaCandidates += @('C:\Program Files\Android\Android Studio\jbr')
    $javaCandidates += @(Get-ChildItem 'C:\Program Files\JetBrains' -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'jbr' })
    $JavaHome = $javaCandidates | Where-Object { (Test-Path (Join-Path $_ 'bin\javac.exe')) -and (Test-Path (Join-Path $_ 'bin\jlink.exe')) } | Select-Object -First 1
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin\jlink.exe'))) {
    throw 'JDK 21이 필요합니다. -JavaHome 인수 또는 JAVA_HOME을 설정해 주세요.'
}
if (-not $SdkRoot) { $SdkRoot = [Environment]::GetEnvironmentVariable('ANDROID_HOME') }
if (-not $SdkRoot) { $SdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path (Join-Path $SdkRoot 'platform-tools'))) { throw 'Android SDK 경로를 -SdkRoot로 지정해 주세요.' }

$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.android'
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.gradle-user'
$sharedCache = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.gradle\caches'
if (-not $env:GRADLE_RO_DEP_CACHE -and (Test-Path (Join-Path $sharedCache 'modules-2'))) {
    $env:GRADLE_RO_DEP_CACHE = $sharedCache
}
$env:PATH = (Join-Path $JavaHome 'bin') + ';' + $env:PATH

$sdkProperty = 'sdk.dir=' + $SdkRoot.Replace('\', '/').Replace(':', '\:')
[IO.File]::WriteAllText((Join-Path $projectRoot 'local.properties'), $sdkProperty + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
if (-not (Test-Path (Join-Path $projectRoot '..\game\node_modules\vite'))) {
    throw '먼저 game 폴더에서 npm.cmd ci를 실행해 주세요.'
}

if ($GradleHome) { $gradleCommand = Join-Path $GradleHome 'bin\gradle.bat' }
else {
    $cachedDistribution = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.gradle\wrapper\dists\gradle-9.5.0-bin'
    $cachedGradle = Get-ChildItem $cachedDistribution -Filter gradle.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    $gradleCommand = if ($cachedGradle) { $cachedGradle.FullName } else { Join-Path $projectRoot 'gradlew.bat' }
}
$gradleArguments = @('--no-daemon', '--console=plain', 'wrapper', ':app:assembleDebug', ':app:testDebugUnitTest', ':app:lintDebug')
if ($IncludeDeviceTests) { $gradleArguments += ':app:assembleDebugAndroidTest' }
if ($Offline) { $gradleArguments = @('--offline') + $gradleArguments }
Push-Location $projectRoot
try {
    & $gradleCommand @gradleArguments
    if ($LASTEXITCODE -ne 0) { throw "Android 빌드 또는 검사 실패 (exit $LASTEXITCODE)" }
    $releaseDirectory = Join-Path $projectRoot 'releases'
    New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
    $apk = Join-Path $releaseDirectory 'DrawDerby-debug.apk'
    Copy-Item -LiteralPath (Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk') -Destination $apk -Force
    $apkHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($apk + '.sha256'), $apkHash + '  DrawDerby-debug.apk' + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Write-Host "APK: $apk"
    Get-FileHash -LiteralPath $apk -Algorithm SHA256
} finally { Pop-Location }
