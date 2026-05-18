$css = Get-Content "c:\Users\admin\Documents\GitHub\Shiira\src\renderer\styles.css" -Raw
$themes = @("shiira-night", "shiira-classic-dark", "shiira-pearl", "abyssal-red", "steelheart", "rustveil", "sakura-shadow")
foreach ($theme in $themes) {
    $matches = [regex]::Matches($css, "(?i)\.$theme")
    Write-Output "$theme has $($matches.Count) matches in styles.css"
}
