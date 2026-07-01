$areas = @(
    @{bbox="35.65,139.69,35.71,139.72"},
    @{bbox="35.69,139.76,35.72,139.79"},
    @{bbox="35.66,139.75,35.69,139.77"},
    @{bbox="35.70,139.79,35.73,139.82"},
    @{bbox="35.62,139.73,35.67,139.76"},
    @{bbox="34.65,135.49,34.71,135.52"},
    @{bbox="34.99,135.77,35.01,135.79"},
    @{bbox="35.68,139.76,35.70,139.78"}
)

$allElements = @()
$headers = @{ 'User-Agent' = 'VendiMap/1.0' }

foreach ($area in $areas) {
    $q = '[out:json][timeout:25];node["amenity"="vending_machine"]["vending"="drinks"](' + $area.bbox + ');out body;'
    try {
        $r = Invoke-RestMethod -Uri ("https://overpass-api.de/api/interpreter?data=" + [Uri]::EscapeDataString($q)) -Method Get -Headers $headers -TimeoutSec 30
        Write-Host "bbox $($area.bbox): $($r.elements.Count)"
        $allElements += $r.elements
        Start-Sleep -Milliseconds 1100
    } catch {
        Write-Host "Error $($area.bbox): $($_.Exception.Message)"
    }
}

$seen = @{}
$unique = @()
foreach ($el in $allElements) {
    if (-not $seen.ContainsKey($el.id)) {
        $seen[$el.id] = $true
        $unique += $el
    }
}
Write-Host "Unique: $($unique.Count)"

$id = 1
$entries = @()

foreach ($el in $unique) {
    $tags = $el.tags
    $lat = [string]$el.lat
    $lng = [string]$el.lon
    $osmId = $el.id

    # Manufacturer detection from brand:en / operator:en
    $mfg = "unknown"
    $be = if ($tags.'brand:en') { $tags.'brand:en' } else { "" }
    $oe = if ($tags.'operator:en') { $tags.'operator:en' } else { "" }
    $src = "$be $oe".ToLower()
    if ($src -match "coca") { $mfg = "coca" }
    elseif ($src -match "suntory") { $mfg = "suntory" }
    elseif ($src -match "dydo") { $mfg = "dydo" }
    elseif ($src -match "kirin") { $mfg = "kirin" }
    elseif ($src -match "asahi") { $mfg = "asahi" }
    elseif ($src -match "itoen|ito.en") { $mfg = "itoen" }
    elseif ($src -match "pokka|sapporo") { $mfg = "pokka" }

    # Map to Japanese
    $mfgJa = switch ($mfg) {
        "coca"    { [char]0x30B3 + [char]0x30AB + [char]0x30FB + [char]0x30B3 + [char]0x30FC + [char]0x30E9 }
        "suntory" { [char]0x30B5 + [char]0x30F3 + [char]0x30C8 + [char]0x30EA + [char]0x30FC }
        "dydo"    { [char]0x30C0 + [char]0x30A4 + [char]0x30C9 + [char]0x30FC }
        "kirin"   { [char]0x30AD + [char]0x30EA + [char]0x30F3 }
        "asahi"   { [char]0x30A2 + [char]0x30B5 + [char]0x30D2 }
        "itoen"   { [char]0x4F0A + [char]0x85E4 + [char]0x5712 }
        "pokka"   { [char]0x30DD + [char]0x30C3 + [char]0x30AB + [char]0x30B5 + [char]0x30C3 + [char]0x30DD + [char]0x30ED }
        default   { [char]0x4E0D + [char]0x660E }
    }

    # Build name
    $unknownStr = [char]0x4E0D + [char]0x660E
    $vendingStr = [char]0x81EA + [char]0x8CA9 + [char]0x6A5F

    $name = "$vendingStr (OSM:$osmId)"
    if ($tags.'name:ja') {
        $name = $tags.'name:ja'
    } elseif ($mfg -ne "unknown") {
        $name = "$mfgJa $vendingStr"
    }

    # Payment
    $payments = @()
    $hasCash = ($tags.'payment:coins' -ne 'no' -and $tags.'payment:notes' -ne 'no')
    if ($hasCash) { $payments += '"' + [char]0x73FE + [char]0x91D1 + '"' }
    if ($tags.'payment:suica' -eq 'yes' -or $tags.'payment:ic_card' -eq 'yes' -or $tags.'payment:contactless' -eq 'yes') {
        $payments += '"' + [char]0x4EA4 + [char]0x901A + [char]0x7CFB + [char]0x0049 + [char]0x0043 + '"'
    }
    if ($payments.Count -eq 0) { $payments = @('"' + [char]0x73FE + [char]0x91D1 + '"') }

    # Trash bin
    $trashNo  = [char]0x306A + [char]0x3057
    $trashYes = [char]0x3042 + [char]0x308A
    $trash = if ($tags.'waste_basket' -eq 'yes') { $trashYes } else { $trashNo }

    # Lineup from real tags only
    $lineup = @()
    if ($tags.'drink:cola' -eq 'yes')          { $lineup += '"' + [char]0x30B3 + [char]0x30FC + [char]0x30E9 + '"' }
    if ($tags.'drink:coffee' -eq 'yes')        { $lineup += '"' + [char]0x30B3 + [char]0x30FC + [char]0x30D2 + [char]0x30FC + '"' }
    if ($tags.'drink:tea' -eq 'yes')           { $lineup += '"' + [char]0x304A + [char]0x8336 + '"' }
    if ($tags.'drink:water' -eq 'yes')         { $lineup += '"' + [char]0x6C34 + '"' }
    if ($tags.'drink:juice' -eq 'yes')         { $lineup += '"' + [char]0x30B8 + [char]0x30E5 + [char]0x30FC + [char]0x30B9 + '"' }
    if ($tags.'drink:energy_drink' -eq 'yes')  { $lineup += '"' + [char]0x30A8 + [char]0x30CA + [char]0x30B8 + [char]0x30FC + '"' }

    # Last updated
    $lastUpdated = $unknownStr
    if ($tags.'check_date')   { $lastUpdated = $tags.'check_date' -replace '-', '/' }
    elseif ($tags.'survey:date') { $lastUpdated = $tags.'survey:date' -replace '-', '/' }

    $payStr    = $payments -join ', '
    $lineupStr = $lineup -join ', '
    $nameEsc   = $name -replace '\\', '\\\\' -replace '"', '\"'
    $mfgEsc    = $mfgJa -replace '"', '\"'

    $entry = "    {`n        id: $id,`n        name: `"$nameEsc`",`n        lat: $lat,`n        lng: $lng,`n        manufacturer: `"$mfgEsc`",`n        rating: 3.0,`n        priceRange: `"$unknownStr`",`n        hasTrashBin: `"$trash`",`n        paymentMethods: [$payStr],`n        rarity: 1,`n        lineup: [$lineupStr],`n        description: `"`",`n        type: `"standard`",`n        photos: [],`n        verifiedCount: 0,`n        lastUpdated: `"$lastUpdated`",`n        osmId: $osmId,`n        namingRightsAvailable: true,`n        owner: null,`n        comments: []`n    }"
    $entries += $entry
    $id++
}

$jsContent = "export const initialSpots = [`n" + ($entries -join ",`n") + "`n];`n"
[System.IO.File]::WriteAllText("$PWD\data_osm.js", $jsContent, [System.Text.Encoding]::UTF8)
Write-Host "Written: $($entries.Count) entries to data_osm.js"
