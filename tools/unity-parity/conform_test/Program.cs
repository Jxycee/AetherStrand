// Head conform C# port test. From the AetherStrand clone:
//   npx tsx tools/unity-parity/conform_vectors.ts tools/hair-blocks/recipes/loop_messy-mage.json <Head.obj> out/conform.json
//   dotnet run --project tools/unity-parity/conform_test -- out/conform.json
// Builds the conform map from the head points with the plugin's port and compares each mass vertex's move with the web's.
using System;
using System.Collections.Generic;
using System.IO;
using AetherStrand;

var v = (Dictionary<string, object>)AetherStrandJson.Parse(File.ReadAllText(args[0]));
double[] ptsD = AetherStrandJson.Arr(v["points"]), q = AetherStrandJson.Arr(v["query"]), exp = AetherStrandJson.Arr(v["move"]);
var pts = new float[ptsD.Length];
for (int i = 0; i < pts.Length; i++) pts[i] = (float)ptsD[i];
var map = AetherStrandHeadConform.Build(pts);
double maxErr = 0, maxMove = 0;
for (int i = 0; i < q.Length; i += 3)
{
    AetherStrandHeadConform.Offset(map, q[i], q[i + 1], q[i + 2], out double dx, out double dy, out double dz);
    maxErr = Math.Max(maxErr, Math.Max(Math.Abs(dx - exp[i]), Math.Max(Math.Abs(dy - exp[i + 1]), Math.Abs(dz - exp[i + 2]))));
    maxMove = Math.Max(maxMove, Math.Sqrt(exp[i] * exp[i] + exp[i + 1] * exp[i + 1] + exp[i + 2] * exp[i + 2]));
}
bool ok = maxErr < 1e-5;
Console.WriteLine($"vertices {q.Length / 3}  largest web move {maxMove * 1000:F2} web-mm  max error {maxErr * 1000:F5} web-mm  {(ok ? "OK" : "MISMATCH")}");
return ok ? 0 : 1;
