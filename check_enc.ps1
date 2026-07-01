$raw = [System.IO.File]::ReadAllText('data_osm.js', [System.Text.Encoding]::UTF8)
Write-Host "Length: $($raw.Length)"
Write-Host $raw.Substring(0, 400)
