# Simple Native PowerShell Web Server for Linsora
$port = 3000
$path = "c:\Users\Urso\Documents\FINANCEMVP"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "🚀 LINSORA Server rodando em http://localhost:$port/"

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $localPath = $request.Url.LocalPath
    if ($localPath -eq "/") { $localPath = "/index.html" }
    $filePath = Join-Path $path $localPath

    if (Test-Path $filePath -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        if ($filePath.EndsWith(".html")) { $response.ContentType = "text/html; charset=utf-8" }
        elseif ($filePath.EndsWith(".css")) { $response.ContentType = "text/css; charset=utf-8" }
        elseif ($filePath.EndsWith(".js")) { $response.ContentType = "application/javascript; charset=utf-8" }
        elseif ($filePath.EndsWith(".png")) { $response.ContentType = "image/png" }
        elseif ($filePath.EndsWith(".jpg")) { $response.ContentType = "image/jpeg" }
        elseif ($filePath.EndsWith(".svg")) { $response.ContentType = "image/svg+xml" }
        
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
    }
    $response.Close()
}
