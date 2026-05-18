$css = Get-Content "c:\Users\admin\Documents\GitHub\Shiira\src\renderer\styles.css"
for ($i = 0; $i -lt $css.Length; $i++) {
    $line = $css[$i]
    if ($line -match "gradient" -or $line -match "rgba\(\d+,\s*\d+,\s*\d+") {
        # Only show lines outside the theme option gradient definitions (lines 2950 to 3500)
        if ($i -lt 2950 -or $i -gt 3500) {
            Write-Output "$($i + 1): $line"
        }
    }
}
