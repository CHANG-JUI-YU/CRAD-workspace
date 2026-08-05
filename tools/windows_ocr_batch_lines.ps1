param(
    [Parameter(Mandatory=$true)][string]$InputDirectory,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
function Await-WinRt($Operation, [Type]$ResultType) {
    $method = $script:asTaskGeneric.MakeGenericMethod($ResultType)
    $task = $method.Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType=WindowsRuntime]

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$files = Get-ChildItem -LiteralPath $InputDirectory -Filter '*.png' -File | Sort-Object Name
$done = 0
foreach ($image in $files) {
    $output = Join-Path $OutputDirectory ($image.BaseName + '.txt')
    if (Test-Path -LiteralPath $output) { $done++; continue }
    try {
        $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image.FullName)) ([Windows.Storage.StorageFile])
        $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @($result.Lines | ForEach-Object { $_.Text })
        Set-Content -LiteralPath $output -Value $lines -Encoding UTF8
        $stream.Dispose()
    } catch {
        Set-Content -LiteralPath $output -Value ("OCR_ERROR: " + $_.Exception.Message) -Encoding UTF8
    }
    $done++
    if (($done % 50) -eq 0) { Write-Output ("Processed {0}/{1}" -f $done, $files.Count) }
}
Write-Output ("Processed {0}/{1}" -f $done, $files.Count)
