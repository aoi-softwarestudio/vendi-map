$raw = Get-Content "osm_raw.json" -Encoding UTF8 | ConvertFrom-Json
Write-Host "Total elements: $($raw.Count)"

$id = 1
$entries = @()

foreach ($el in $raw) {
    $tags = $el.tags
    $lat = [string]$el.lat
    $lng = [string]$el.lon
    $osmId = $el.id

    # Manufacturer detection
    $mfg = "unknown"
    $be = if ($tags.'brand:en') { $tags.'brand:en' } else { "" }
    $oe = if ($tags.'operator:en') { $tags.'operator:en' } else { "" }
    $src = "$be $oe".ToLower()
    if ($src -match "coca")            { $mfg = "coca" }
    elseif ($src -match "suntory")     { $mfg = "suntory" }
    elseif ($src -match "dydo")        { $mfg = "dydo" }
    elseif ($src -match "kirin")       { $mfg = "kirin" }
    elseif ($src -match "asahi")       { $mfg = "asahi" }
    elseif ($src -match "itoen|ito.en"){ $mfg = "itoen" }
    elseif ($src -match "pokka|sapporo"){ $mfg = "pokka" }
    elseif ($src -match "ucc")         { $mfg = "ucc" }
    elseif ($src -match "sangaria")    { $mfg = "sangaria" }

    $mfgJa = switch ($mfg) {
        "coca"     { "$([char]0x30B3)$([char]0x30AB)$([char]0x30FB)$([char]0x30B3)$([char]0x30FC)$([char]0x30E9)" }
        "suntory"  { "$([char]0x30B5)$([char]0x30F3)$([char]0x30C8)$([char]0x30EA)$([char]0x30FC)" }
        "dydo"     { "$([char]0x30C0)$([char]0x30A4)$([char]0x30C9)$([char]0x30FC)" }
        "kirin"    { "$([char]0x30AD)$([char]0x30EA)$([char]0x30F3)" }
        "asahi"    { "$([char]0x30A2)$([char]0x30B5)$([char]0x30D2)" }
        "itoen"    { "$([char]0x4F0A)$([char]0x85E4)$([char]0x5712)" }
        "pokka"    { "$([char]0x30DD)$([char]0x30C3)$([char]0x30AB)$([char]0x30B5)$([char]0x30C3)$([char]0x30DD)$([char]0x30ED)" }
        "ucc"      { "UCC" }
        "sangaria" { "$([char]0x30B5)$([char]0x30F3)$([char]0x30AC)$([char]0x30EA)$([char]0x30A2)" }
        default    { "$([char]0x4E0D)$([char]0x660E)" }
    }

    $vendingStr  = "$([char]0x81EA)$([char]0x8CA9)$([char]0x6A5F)"
    $unknownStr  = "$([char]0x4E0D)$([char]0x660E)"

    # Name
    $name = "$vendingStr (OSM:$osmId)"
    if ($tags.'name:ja') {
        $name = $tags.'name:ja'
    } elseif ($tags.'name') {
        $nm = $tags.'name'
        # If name looks like a brand (Coca-Cola etc), make it "[brand] vending machine"
        if ($nm -match '^[A-Za-z\s\-]+$') {
            $name = "$mfgJa $vendingStr"
        } else {
            $name = $nm
        }
    } elseif ($mfg -ne "unknown") {
        $name = "$mfgJa $vendingStr"
    }

    # Payment
    $cashJa = "$([char]0x73FE)$([char]0x91D1)"
    $icJa   = "$([char]0x4EA4)$([char]0x901A)$([char]0x7CFB)IC"
    $ccJa   = "$([char]0x30AF)$([char]0x30EC)$([char]0x30B8)$([char]0x30C3)$([char]0x30C8)$([char]0x30AB)$([char]0x30FC)$([char]0x30C9)"
    $payments = @()
    if ($tags.'payment:coins' -ne 'no') { $payments += "`"$cashJa`"" }
    if ($tags.'payment:suica' -eq 'yes' -or $tags.'payment:ic_card' -eq 'yes' -or $tags.'payment:contactless' -eq 'yes') {
        $payments += "`"$icJa`""
    }
    if ($tags.'payment:credit_cards' -eq 'yes') { $payments += "`"$ccJa`"" }
    if ($payments.Count -eq 0) { $payments = @("`"$cashJa`"") }

    # Trash
    $trashNo  = "$([char]0x306A)$([char]0x3057)"
    $trashYes = "$([char]0x3042)$([char]0x308A)"
    $trash = if ($tags.'waste_basket' -eq 'yes') { $trashYes } else { $trashNo }

    # Lineup from real tags only
    $lineup = @()
    if ($tags.'drink:cola' -eq 'yes')         { $lineup += "`"$([char]0x30B3)$([char]0x30FC)$([char]0x30E9)`"" }
    if ($tags.'drink:coffee' -eq 'yes')       { $lineup += "`"$([char]0x30B3)$([char]0x30FC)$([char]0x30D2)$([char]0x30FC)`"" }
    if ($tags.'drink:tea' -eq 'yes')          { $lineup += "`"$([char]0x304A)$([char]0x8336)`"" }
    if ($tags.'drink:water' -eq 'yes')        { $lineup += "`"$([char]0x6C34)`"" }
    if ($tags.'drink:juice' -eq 'yes')        { $lineup += "`"$([char]0x30B8)$([char]0x30E5)$([char]0x30FC)$([char]0x30B9)`"" }
    if ($tags.'drink:energy_drink' -eq 'yes') { $lineup += "`"$([char]0x30A8)$([char]0x30CA)$([char]0x30B8)$([char]0x30FC)`"" }

    # Last updated
    $lastUpdated = $unknownStr
    if ($tags.'check_date')      { $lastUpdated = ($tags.'check_date' -replace '-', '/') }
    elseif ($tags.'survey:date') { $lastUpdated = ($tags.'survey:date' -replace '-', '/') }

    $payStr    = $payments -join ', '
    $lineupStr = $lineup -join ', '
    $nameEsc   = $name -replace '\\', '\\' -replace '"', '\"'
    $mfgEsc    = $mfgJa -replace '"', '\"'

    $entry = "    {`n        id: $id,`n        name: `"$nameEsc`",`n        lat: $lat,`n        lng: $lng,`n        manufacturer: `"$mfgEsc`",`n        rating: 3.0,`n        priceRange: `"$unknownStr`",`n        hasTrashBin: `"$trash`",`n        paymentMethods: [$payStr],`n        rarity: 1,`n        lineup: [$lineupStr],`n        description: `"`",`n        type: `"standard`",`n        photos: [],`n        verifiedCount: 0,`n        lastUpdated: `"$lastUpdated`",`n        osmId: $osmId,`n        namingRightsAvailable: true,`n        owner: null,`n        comments: []`n    }"
    $entries += $entry
    $id++
}

Write-Host "Building JS for $($entries.Count) spots..."
$jsContent = "export const initialSpots = [`n" + ($entries -join ",`n") + "`n];`n"
[System.IO.File]::WriteAllText("$PWD\data_osm.js", $jsContent, [System.Text.Encoding]::UTF8)
Write-Host "DONE: data_osm.js written with $($entries.Count) real spots"
