$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path $PSScriptRoot '../src-tauri/icons'
$master = [System.Drawing.Image]::FromFile((Join-Path $iconRoot 'isla-master.png'))
try {
    foreach ($size in @(16,20,24,32,40,48,64,96,128,256,512)) {
        $bitmap = [System.Drawing.Bitmap]::new($size,$size,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
            try {
                $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
                $graphics.DrawImage($master,[System.Drawing.Rectangle]::new(0,0,$size,$size),0,0,$master.Width,$master.Height,[System.Drawing.GraphicsUnit]::Pixel,$attributes)
            } finally { $attributes.Dispose() }
            $bitmap.Save((Join-Path $iconRoot "$($size)x$($size).png"),[System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $master.Dispose() }
