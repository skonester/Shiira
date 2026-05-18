Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Screen = [System.Windows.Forms.Screen]::PrimaryScreen
$Bounds = $Screen.Bounds
$Bitmap = New-Object System.Drawing.Bitmap $Bounds.Width, $Bounds.Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Bounds.Location, [System.Drawing.Point]::Empty, $Bounds.Size)
$Bitmap.Save("c:\Users\admin\Documents\GitHub\Shiira\screenshot.png", [System.Drawing.Imaging.ImageFormat]::Png)
$Graphics.Dispose()
$Bitmap.Dispose()
Write-Output "Screenshot saved successfully!"
