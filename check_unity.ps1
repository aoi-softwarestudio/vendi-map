# Check Unity Hub and Unity Editor installation paths (English Version to avoid encoding issues)

$pathsToCheck = @(
    "C:\Program Files\Unity Hub\Unity Hub.exe",
    "C:\Program Files (x86)\Unity Hub\Unity Hub.exe",
    "$env:LOCALAPPDATA\Programs\unity-hub\Unity Hub.exe",
    "C:\Program Files\Unity\Hub\Editor"
)

Write-Host "--- Unity Installation Status Check ---"
$hubFound = $false

foreach ($path in $pathsToCheck) {
    if (Test-Path $path) {
        Write-Host "[DETECTED] Path exists: $path"
        if ($path.EndsWith("Unity Hub.exe")) {
            $hubFound = $true
        }
    }
}

# Search Editors
$editorRoot = "C:\Program Files\Unity\Hub\Editor"
if (Test-Path $editorRoot) {
    $editors = Get-ChildItem $editorRoot -Directory
    if ($editors.Count -gt 0) {
        Write-Host "[DETECTED] Installed Unity Editors:"
        foreach ($editor in $editors) {
            $exePath = Join-Path $editor.FullName "Editor\Unity.exe"
            if (Test-Path $exePath) {
                Write-Host "  - Version: $($editor.Name) (Path: $exePath)"
            }
        }
    } else {
        Write-Host "[WARNING] Unity Hub Editor folder is empty. Please install Editor from Unity Hub."
    }
} else {
    Write-Host "[INFO] Default Unity Editor root path not found."
}

if ($hubFound) {
    Write-Host "`n[SUCCESS] Unity Hub detected."
} else {
    Write-Host "`n[WAITING] Unity Hub not found. Please wait until installation completes."
}
