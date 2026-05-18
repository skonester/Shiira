$css = Get-Content "c:\Users\admin\Documents\GitHub\Shiira\src\renderer\styles.css"
$hardcoded = @()
for ($i = 0; $i -lt $css.Length; $i++) {
    $line = $css[$i]
    if ($line -match "background:\s*#[a-fA-F0-9]{3,6}" -or $line -match "background-color:\s*#[a-fA-F0-9]{3,6}" -or $line -match "border:\s*\d+px\s+solid\s+#[a-fA-F0-9]{3,6}" -or $line -match "border-color:\s*#[a-fA-F0-9]{3,6}") {
        # Skip the theme definition section (lines 2950 to 3500)
        if ($i -lt 2950 -or $i -gt 3500) {
            $hardcoded += "$($i + 1): $line"
        }
    }
}
Write-Output "Found $($hardcoded.Length) hardcoded colors outside theme definitions:"
$hardcoded | Select-Object -First 30
