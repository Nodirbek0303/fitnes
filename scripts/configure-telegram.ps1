$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env"
$secureToken = Read-Host "Enter the NEW BotFather token (never reuse the revoked token)" -AsSecureString
$bstr = [IntPtr]::Zero

try {
  if ($secureToken.Length -lt 25) {
    throw "The token is too short. Check the new token in BotFather."
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ($token -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') {
    throw "The token format is invalid. No configuration was saved."
  }

  $lines = [Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $envPath) {
    foreach ($line in [IO.File]::ReadAllLines($envPath)) {
      if ($line -notmatch '^\s*TELEGRAM_BOT_TOKEN\s*=') {
        $lines.Add($line)
      }
    }
  }
  $lines.Add("TELEGRAM_BOT_TOKEN=" + $token)
  $encoding = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllLines($envPath, $lines, $encoding)
  Write-Output "New Telegram token saved in .env. The token was not printed."
  Write-Output "Restart start.bat to connect the bot."
}
finally {
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ($secureToken) {
    $secureToken.Dispose()
  }
  Remove-Variable token -ErrorAction SilentlyContinue
}
