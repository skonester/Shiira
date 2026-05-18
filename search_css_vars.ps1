$css = Get-Content "c:\Users\admin\Documents\GitHub\Shiira\src\renderer\styles.css"
for ($i = 0; $i -lt $css.Length; $i++) {
    if ($css[$i] -match "theme-") {
        Write-Output "$($i + 1): $($css[$i])"
    }
}
