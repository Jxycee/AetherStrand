Render + measure one recipe on Tobin (Unity MCP, editor already open; do not close it):
1. Export geometry (from C:\Dev\scratch\AetherStrand):
   npx tsx <game-repo>/Reference/sessions/aetherstrand-combo/tools/web_export.ts <scratch>/batch/<name>/recipe.json <scratch>/batch/<name>
2. Unity MCP execute_code (action "execute", C# body only, no using lines, use fully-qualified System.*):
   System.Environment.SetEnvironmentVariable("SC_TOBIN_RECIPE","<scratch>/batch/<name>/recipe.json");
   System.Environment.SetEnvironmentVariable("SC_TOBIN_GEO","<scratch>/batch/<name>/PresetGeometry.json");
   System.Environment.SetEnvironmentVariable("SC_TOBIN_TAG","<tag>");
   System.Environment.SetEnvironmentVariable("SC_TOBIN_EYES","1");
   TobinFitTest.Run(); return "ok";
   Output: <scratch>/parity_out/<tag>_4view.png (front/back/left/right 2x2). Metrics line appended to <scratch>/parity_out/eval_k3.txt (tag first). A render taken right after a compile can come out hair-less: just re-run.
