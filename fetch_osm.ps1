$body = '[out:json][timeout:30];node["amenity"="vending_machine"]["vending"="drinks"](35.65,139.69,35.71,139.72);out body;'
try {
    $headers = @{ 'Accept' = 'application/json'; 'User-Agent' = 'VendiMap/1.0' }
    $r = Invoke-RestMethod -Uri "https://overpass-api.de/api/interpreter?data=$([Uri]::EscapeDataString($body))" -Method Get -Headers $headers -TimeoutSec 35
    Write-Host "Count: $($r.elements.Count)"
    $r.elements | Select-Object -First 5 | ConvertTo-Json -Depth 4
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
