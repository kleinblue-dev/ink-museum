# 墨馆 · 一键发布到 GitHub Pages（kleinblue-dev/ink-museum，main 分支 / 根目录）
# 用法：powershell -ExecutionPolicy Bypass -File scripts/deploy-pages.ps1
param(
  [string]$Repo = 'kleinblue-dev/ink-museum',
  [string]$Message = '',
  [string]$Proxy = 'http://127.0.0.1:7897',
  [switch]$SkipPush
)
$ErrorActionPreference = 'Continue'  # 原生命令 stderr 在 PS5.1 会被当 error record；改用显式 exit code 判断
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$git = 'C:\Users\samcz\AppData\Local\Programs\Git\cmd\git.exe'
$gh = 'E:\AI\gh\bin\gh.exe'
if (-not (Test-Path $gh)) { $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source }
if (-not (Test-Path $git)) { $git = (Get-Command git -ErrorAction Stop).Source }
$url = "https://kleinblue-dev.github.io/ink-museum/"
if (-not $Message) { $Message = 'publish: ink-museum ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

Write-Host '== 0. 预检 =='
if (-not (Test-Path 'index.html')) { throw 'index.html 不存在，先做完前台再发布' }
foreach ($f in @('.nojekyll', 'robots.txt')) { if (-not (Test-Path $f)) { New-Item -ItemType File -Force $f | Out-Null } }
foreach ($dir in @('assets', 'content', 'css', 'js', 'data')) { if (-not (Test-Path $dir)) { throw "缺少目录 $dir" } }
$missing = @()
foreach ($f in (Get-ChildItem assets\bg -Filter '*.webp' -ErrorAction SilentlyContinue)) { if ($f.Length -lt 4096) { $missing += $f.Name } }
if ($missing.Count) { throw ('背景资产异常：' + ($missing -join ', ')) }
Write-Host '预检通过'

Write-Host '== 1. git 提交 =='
if (-not (Test-Path '.git')) {
  & $git init -b main | Out-Null
  & $git config user.name 'kleinblue-dev'
  & $git config user.email 'kleinblue-dev@users.noreply.github.com'
}
& $git add -A
$status = & $git status --porcelain
if ($status) {
  & $git commit -m $Message | Out-Null
  Write-Host "已提交：$Message"
} else { Write-Host '没有改动，继续发布当前提交' }
$branch = (& $git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { & $git branch -M main | Out-Null }

if ($SkipPush) { Write-Host 'SkipPush：不推送'; exit 0 }

Write-Host '== 2. 远程仓库 =='
$env:HTTPS_PROXY = $Proxy; $env:HTTP_PROXY = $Proxy
$remotes = & $git remote
if ($remotes -notcontains 'origin') { & $git remote add origin "https://github.com/$Repo.git" }
$exists = $false
try { & $gh repo view $Repo --json name 2>$null | Out-Null; $exists = ($LASTEXITCODE -eq 0) } catch { $exists = $false }
if (-not $exists) {
  Write-Host "创建仓库 $Repo"
  & $gh repo create $Repo --public --description '墨馆 · 一座可以走进的水墨小馆（墨间 × 墨心 融合版）' 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '创建仓库失败（检查 gh 登录态/网络）' }
} else { Write-Host "仓库已存在：$Repo" }

Write-Host '== 3. 推送 main =='
& $git -c http.proxy=$Proxy -c https.proxy=$Proxy push -u origin main 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host '第一次推送失败，尝试 pull --rebase 后再推'
  & $git -c http.proxy=$Proxy -c https.proxy=$Proxy pull --rebase origin main 2>&1 | Out-Host
  & $git -c http.proxy=$Proxy -c https.proxy=$Proxy push -u origin main 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '推送失败' }
}

Write-Host '== 4. 开启/确认 GitHub Pages =='
$pageInfo = $null
try { $pageInfo = & $gh api "repos/$Repo/pages" 2>$null | ConvertFrom-Json } catch { $pageInfo = $null }
if (-not $pageInfo -or -not $pageInfo.html_url) {
  $body = '{"source":{"branch":"main","path":"/"}}'
  $body | & $gh api -X POST "repos/$Repo/pages" --input - | Out-Host
  if ($LASTEXITCODE -ne 0) { throw '开启 Pages 失败（可能需要在仓库 Settings 里手动选 main / root）' }
} else { Write-Host ("Pages 已开启：" + $pageInfo.html_url) }

Write-Host '== 5. 等待线上生效（最多 5 分钟）=='
$ProgressPreference = 'SilentlyContinue'
$ok = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 10
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -eq 200 -and $r.Content -match '墨馆') { $ok = $true; break }
    Write-Host ("[{0}/30] HTTP {1}，继续等" -f $i, $r.StatusCode)
  } catch { Write-Host ("[{0}/30] 尚未就绪：{1}" -f $i, $_.Exception.Message) }
}
if ($ok) { Write-Host "`n发布成功：$url" } else { Write-Warning "推送完成但线上还没验证到（$url），GitHub Pages 首次部署可能要几分钟，稍后手动打开确认。" }
