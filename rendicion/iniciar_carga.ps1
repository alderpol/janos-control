param(
    [Parameter(Mandatory = $true)]
    [string]$Csv,
    [switch]$Confirmar
)

$ErrorActionPreference = "Stop"
$arguments = @((Join-Path $PSScriptRoot "cargar_desde_csv.js"), (Resolve-Path $Csv).Path)
if ($Confirmar) { $arguments += "--confirmar" }
& node @arguments
exit $LASTEXITCODE
