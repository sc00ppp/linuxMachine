# Console project — enable OpenSSH Server on the media PC and authorize the
# desktop's key. Run in an ADMIN PowerShell:  irm 192.168.1.155:5620/setup-ssh.ps1 | iex

$ErrorActionPreference = 'Stop'

Write-Host "Installing OpenSSH Server (this can take a minute)..."
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null

Set-Service sshd -StartupType Automatic
Start-Service sshd
Write-Host "sshd running and set to start on boot."

$keys = 'C:\ProgramData\ssh\administrators_authorized_keys'
$pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKD8xecciOrLXjZ8LKj5ILJoziPXby4emXe/8cdxjAek david-desktop-assetfarm'
if (-not (Test-Path $keys) -or -not (Select-String -Path $keys -SimpleMatch $pub -Quiet)) {
  Add-Content -Path $keys -Value $pub
}
icacls $keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
Write-Host "Desktop key authorized."

Write-Host ""
Write-Host ("Done. This machine: {0} ({1})" -f $env:COMPUTERNAME, ((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress))
Write-Host "You can close this window."
