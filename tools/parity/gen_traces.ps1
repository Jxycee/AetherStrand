# Regenerates all physics traces under <scratch>/ptraces (web ground truth). Run from anywhere.
$W = (Get-Location).Path
$T = "$W/Reference/sessions/aetherstrand-combo/tools/web_trace.ts"
$rec = @{ halfup059 = "$W/Reference/sessions/aetherstrand-combo/recipes/halfup059.json" }
foreach ($a in 'asym-cascade','spiky-hero','high-ponytail','sleek-bob','long-cascade','twin-tails') { $rec[$a] = "<scratch>/batch/$a/recipe.json" }
Set-Location C:\Dev\scratch\AetherStrand
foreach ($k in $rec.Keys) { foreach ($m in 'idle','walk','turn','gust') { npx tsx $T $rec[$k] "<scratch>/ptraces/$k/$m" $m 300 2>&1 | Select-String 'locks=' } }
