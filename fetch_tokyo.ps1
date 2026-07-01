$q = '[out:json][timeout:60];node["amenity"="vending_machine"]["vending"="drinks"](35.62,139.69,35.73,139.82);out body;'
$headers = @{ 'User-Agent' = 'VendiMap/1.0' }
Write-Host "Fetching Tokyo vending machines..."
try {
    $r = Invoke-RestMethod -Uri ("https://overpass-api.de/api/interpreter?data=" + [Uri]::EscapeDataString($q)) -Method Get -Headers $headers -TimeoutSec 65
    Write-Host "Got: $($r.elements.Count)"
    $r.elements | ConvertTo-Json -Depth 4 | Out-File -FilePath "osm_raw.json" -Encoding utf8
    Write-Host "Saved osm_raw.json"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
