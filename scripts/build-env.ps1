$ErrorActionPreference = 'Stop'

$nodeBin = 'C:\Users\Langz\AppData\Local\OpenAI\Codex\runtimes\cua_node\db1cc9e06a6c48d6\bin'
$cargoBin = 'C:\Users\Langz\.cargo\bin'
$mingwBin = 'C:\Users\Langz\.llvm-mingw\bin'
$selfContainedLib = 'C:\Users\Langz\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\lib\self-contained'
$mingwLib = 'C:\Users\Langz\.llvm-mingw\x86_64-w64-mingw32\lib'

if ((Test-Path -LiteralPath $selfContainedLib) -and (Test-Path -LiteralPath $mingwLib)) {
    if (!(Test-Path -LiteralPath (Join-Path $mingwLib 'libgcc_eh.a'))) {
        Copy-Item "$selfContainedLib\libgcc*.a" -Destination $mingwLib -Force
    }
}

foreach ($dir in @($mingwBin, $cargoBin, $nodeBin)) {
    if ((Test-Path -LiteralPath $dir) -and ($env:PATH -notlike "*$dir*")) {
        $env:PATH = "$dir;$env:PATH"
    }
}

$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
$env:CC_x86_64_pc_windows_gnu = Join-Path $mingwBin 'x86_64-w64-mingw32-gcc.exe'
$env:CXX_x86_64_pc_windows_gnu = Join-Path $mingwBin 'x86_64-w64-mingw32-g++.exe'
$env:AR_x86_64_pc_windows_gnu = Join-Path $mingwBin 'x86_64-w64-mingw32-ar.exe'
$env:RANLIB_x86_64_pc_windows_gnu = Join-Path $mingwBin 'x86_64-w64-mingw32-ranlib.exe'
$env:WINDRES = Join-Path $mingwBin 'windres.exe'
