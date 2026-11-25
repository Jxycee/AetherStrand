// Hybrid mass C# port test (hybrid plan phase 2). From the AetherStrand clone:
//   npx tsx tools/unity-parity/web_export.ts tools/hair-blocks/recipes/loop_messy-mage.json out --mass --edge-cards 24
//   npx tsx tools/unity-parity/mass_roundtrip.ts tools/hair-blocks/recipes/loop_messy-mage.json --vectors out/vectors.json
//   dotnet run --project tools/unity-parity/mass_test -- out/PresetGeometry.json out/vectors.json
// Loads the hybridMass block with the plugin's reader, deforms it by the vectors' node motion and head pose, and compares
// positions and normals with the web result. Exit 1 on a mismatch.
using System;
using System.Collections.Generic;
using System.IO;
using AetherStrand;

var geoText = File.ReadAllText(args[0]);
var root = (Dictionary<string, object>)AetherStrandJson.Parse(geoText);
var mass = AetherStrandWebMass.Load(root) ?? throw new Exception("no hybridMass block");
var locks = AetherStrandWebData.LoadGeometry(geoText, out _);
mass.SetRestNodes(locks);
var vec = (Dictionary<string, object>)AetherStrandJson.Parse(File.ReadAllText(args[1]));
double[] hp = AetherStrandJson.Arr(vec["hp"]), hq = AetherStrandJson.Arr(vec["hq"]);
double[] nodesD = AetherStrandJson.Arr(vec["nodes"]), expP = AetherStrandJson.Arr(vec["positions"]), expN = AetherStrandJson.Arr(vec["normals"]);
var nodes = new float[nodesD.Length];
for (int i = 0; i < nodes.Length; i++) nodes[i] = (float)nodesD[i];
var sw = System.Diagnostics.Stopwatch.StartNew();
mass.Deform(nodes, hp[0], hp[1], hp[2], hq[0], hq[1], hq[2], hq[3]);
double once = sw.Elapsed.TotalMilliseconds;
double maxP = 0, maxN = 0;
for (int i = 0; i < expP.Length; i++) maxP = Math.Max(maxP, Math.Abs(mass.Positions[i] - expP[i]));
for (int i = 0; i < expN.Length; i++) maxN = Math.Max(maxN, Math.Abs(mass.Normals[i] - expN[i]));
// steady-state cost of one deform (what the plugin pays per frame on this CPU, before the mesh upload)
sw.Restart();
for (int r = 0; r < 200; r++) mass.Deform(nodes, hp[0], hp[1], hp[2], hq[0], hq[1], hq[2], hq[3]);
double per = sw.Elapsed.TotalMilliseconds / 200;
bool ok = maxP < 1e-5 && maxN < 1e-3;
Console.WriteLine($"vertices {mass.VertexCount}  max position error {maxP * 1000:F5} mm  max normal error {maxN:F6}  deform {per:F3} ms/frame (first {once:F1} ms)  {(ok ? "OK" : "MISMATCH")}");
return ok ? 0 : 1;
