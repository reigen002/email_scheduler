$ErrorActionPreference = 'Stop'
$projectNodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($projectNodeCommand) {
    $projectNodePath = $projectNodeCommand.Source
} else {
    $projectNodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (-not (Test-Path -LiteralPath $projectNodePath)) {
        throw 'Node.js 20.9+ is required. Install Node.js and run this command again.'
    }
}

& $projectNodePath (Join-Path $PSScriptRoot 'scripts/dev.cjs')
exit $LASTEXITCODE
