<#
.SYNOPSIS
    フォルダ内の FBX ファイルを一括で VMD に変換する。

.DESCRIPTION
    fbx2vmd.py を使って、指定した入力フォルダの .fbx をまとめて変換し、
    出力フォルダに <元ファイル名>.vmd として保存する。

.PARAMETER FbxDir
    変換元の FBX ファイルが入っているフォルダ (必須)

.PARAMETER OutDir
    変換後の VMD を出力するフォルダ (必須)

.PARAMETER Pmx
    対象 PMX モデルのパス (必須)

.PARAMETER InPlace
    水平ルート移動を除去してその場ループ化する

.PARAMETER Scale
    モーションスケール (省略時: 脚の長さ比から自動算出)

.PARAMETER TiltOffsetDeg
    体幹 (上半身/上半身2/首/頭) の前傾補正 (度)。
    元モーション自体の後ろ反りを打ち消したいときに使う。

.PARAMETER HeadTiltOffsetDeg
    首/頭 に --tilt-offset-deg に加えてさらに追加する前傾補正 (度)

.PARAMETER PmxScale
    PMX の読み込みスケール (既定: 0.08)

.PARAMETER Blender
    blender.exe のパス (既定: Blender 5.1 の標準インストール先)

.EXAMPLE
    # 基本
    tools\convert_fbx_folder.ps1 `
        -FbxDir  public\motions\fbx `
        -OutDir  public\motions\vmd\base `
        -Pmx     public\models\Alicia\Alicia_solid.pmx

.EXAMPLE
    # 前傾補正あり
    tools\convert_fbx_folder.ps1 `
        -FbxDir          public\motions\fbx `
        -OutDir          public\motions\vmd\base `
        -Pmx             public\models\Alicia\Alicia_solid.pmx `
        -TiltOffsetDeg   5 `
        -HeadTiltOffsetDeg 5

.EXAMPLE
    # その場ループ + スケール手動指定
    tools\convert_fbx_folder.ps1 `
        -FbxDir  public\motions\fbx `
        -OutDir  public\motions\vmd\loop `
        -Pmx     public\models\Alicia\Alicia_solid.pmx `
        -InPlace `
        -Scale   0.9
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory)][string] $FbxDir,
    [Parameter(Mandatory)][string] $OutDir,
    [Parameter(Mandatory)][string] $Pmx,

    [switch]  $InPlace,
    [float]   $Scale,
    [float]   $TiltOffsetDeg,
    [float]   $HeadTiltOffsetDeg,
    [float]   $PmxScale = 0.08,

    [string]  $Blender = "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- 検証 -------------------------------------------------------------------
if (-not (Test-Path $Blender)) {
    throw "blender.exe が見つかりません: $Blender`n-Blender オプションで正しいパスを指定してください。"
}
if (-not (Test-Path $FbxDir)) {
    throw "FBX フォルダが見つかりません: $FbxDir"
}
if (-not (Test-Path $Pmx)) {
    throw "PMX ファイルが見つかりません: $Pmx"
}

$script = Join-Path $PSScriptRoot "fbx2vmd.py"
if (-not (Test-Path $script)) {
    throw "fbx2vmd.py が見つかりません: $script"
}

$fbxFiles = Get-ChildItem -Path $FbxDir -Filter "*.fbx"
if ($fbxFiles.Count -eq 0) {
    Write-Warning "FBX ファイルが見つかりません: $FbxDir"
    exit 0
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# --- 共通オプション組み立て -------------------------------------------------
$commonArgs = @(
    "--pmx", (Resolve-Path $Pmx).Path,
    "--pmx-scale", $PmxScale
)
if ($InPlace)                            { $commonArgs += "--in-place" }
if ($PSBoundParameters.ContainsKey("Scale"))             { $commonArgs += "--scale", $Scale }
if ($PSBoundParameters.ContainsKey("TiltOffsetDeg"))     { $commonArgs += "--tilt-offset-deg", $TiltOffsetDeg }
if ($PSBoundParameters.ContainsKey("HeadTiltOffsetDeg")) { $commonArgs += "--head-tilt-offset-deg", $HeadTiltOffsetDeg }

# --- 変換ループ -------------------------------------------------------------
$ok    = 0
$fail  = 0
$total = $fbxFiles.Count

foreach ($fbx in $fbxFiles) {
    $outPath = Join-Path (Resolve-Path $OutDir).Path ($fbx.BaseName + ".vmd")
    Write-Host "[$($ok + $fail + 1)/$total] $($fbx.Name) -> $outPath" -ForegroundColor Cyan

    $blenderArgs = @(
        "--background",
        "--python", $script,
        "--",
        "--fbx",  $fbx.FullName,
        "--out",  $outPath
    ) + $commonArgs

    $output = & $Blender @blenderArgs 2>&1
    $wrote  = $output | Select-String "\[fbx2vmd\] wrote"
    $errors = $output | Select-String "Traceback|Error:" | Where-Object { $_ -notmatch "^\s*#" }

    if ($wrote) {
        Write-Host "  OK: $($wrote -replace '.*wrote ','')" -ForegroundColor Green
        $ok++
    } else {
        Write-Host "  FAILED" -ForegroundColor Red
        $output | Select-String "\[fbx2vmd\]|Error|Traceback" | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
        $fail++
    }
}

# --- サマリー ---------------------------------------------------------------
Write-Host ""
Write-Host "完了: $ok 件成功 / $fail 件失敗 (合計 $total 件)" -ForegroundColor ($fail -gt 0 ? "Yellow" : "Green")
if ($fail -gt 0) { exit 1 }
