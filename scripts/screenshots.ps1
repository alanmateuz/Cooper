# Prints do README a partir da demonstração (pnpm dev:web rodando em http://localhost:1420).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\screenshots.ps1
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$out = Join-Path $PSScriptRoot "..\docs\assets"
$profileDir = Join-Path $env:TEMP "cooper-shots"
$shots = @(
  @{ file = "screenshot-agora.png"; size = "1012,452"; shot = "pessoas" },
  @{ file = "screenshot-equipe.png"; size = "452,432"; shot = "equipe" },
  @{ file = "screenshot-ajustes.png"; size = "392,902"; shot = "ajustes" },
  @{ file = "screenshot-compacto.png"; size = "372,76"; shot = "pilula" }
)
foreach ($s in $shots) {
  $path = [IO.Path]::GetFullPath((Join-Path $out $s.file))
  & $edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 "--user-data-dir=$profileDir" `
    --virtual-time-budget=6000 "--window-size=$($s.size)" "--screenshot=$path" "http://localhost:1420/?demo&shot=$($s.shot)" | Out-Null
  Write-Output "$($s.file): $((Get-Item $path).Length) bytes"
}
