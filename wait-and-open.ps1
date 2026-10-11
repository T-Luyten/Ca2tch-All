# Waits for the Ca2tchAll server to answer, then opens it in the browser.
$Url = "http://localhost:8002"
for ($i = 0; $i -lt 90; $i++) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
Start-Process $Url
