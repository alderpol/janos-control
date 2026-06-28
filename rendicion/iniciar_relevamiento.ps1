$ErrorActionPreference = "Stop"

$script = Join-Path $PSScriptRoot "inspeccionar_sitio.js"
& node $script
exit $LASTEXITCODE
