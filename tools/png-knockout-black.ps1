param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Threshold = 28
)
Add-Type -AssemblyName System.Drawing
$tmp = "$Path.$([guid]::NewGuid().ToString('n')).png"
$bmp = [System.Drawing.Bitmap]::FromFile($Path)
for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.A -gt 0 -and $c.R -le $Threshold -and $c.G -le $Threshold -and $c.B -le $Threshold) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    }
  }
}
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Move-Item -Force $tmp $Path
