// Scratch harness (NOT game code): plays the fixed hybrid proof scene that HybridProofTest builds, in play mode.
// For each resolution x alpha mode x camera distance it runs the same recorded motion (the web app's head turn) and camera
// path three times: no hair, today's hair (baseline export) and the hybrid (mass + edge cards), and writes
//   summary.md / summary.json  GPU frame time, hair cost (with hair minus without), overdraw, shimmer, CPU solver time
//   stills/*.jpg               three frames of each run, tone mapped like the web (ACES 1.16 + sRGB)
//   seq/<run>/*.jpg            one second of consecutive frames for the 1080p close runs (encode to video to judge shimmer)
//   overdraw/*.png             rasterised hair layers as a heat map
//   sheet_<hair>.png           the four parity views at rest (1024 px, 2x2 supersampled), to set beside the web sheets
//   cam_path.json              the camera path and head pose for every frame, so a run can be replayed elsewhere
//   depth_<mode>.png           the hybrid at rest with and without a depth prepass (see DepthCheck), with a diff
// It also runs in a standalone player (HybridProofTest.Build): the editor's own rendering and overhead are then out of the
// timings, and matrixOnly skips the parity and isolation sheets (they need editor-only shaders). Player arguments:
//   -hpOut <folder> (default: the folder the build was made with), -hpFrames <n>.
// The hair steps once per rendered frame with a fixed 1/60 s (AetherStrandWebHair.manualStep + Tick), so every run sees the
// same simulation whatever the real frame time.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using AetherStrand;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public class HybridProofRunner : MonoBehaviour
{
    public Transform head, root;
    public Camera cam;
    public AetherStrandWebHair baseline, hybrid;
    public Renderer[] paintRenderers = new Renderer[0];
    public Material overdrawMat;
    public Color clearLinear = Color.gray;
    public Vector3 frameCentre;           // world, at rest
    public float frameScale = 0.34f;      // web-to-Tobin framing scale (TobinFitTest's ks)
    public string outDir = "";
    public int warmFrames = 60, runFrames = 150, seqFrom = 45, seqTo = 105, timingRepeats = 16;
    public bool exitWhenDone = true;
    public bool matrixOnly = false;       // player build: timings, flicker and the depth check only

    static readonly CultureInfo IC = CultureInfo.InvariantCulture;
    Quaternion headRestRot; Vector3 headRestPos;
    readonly Dictionary<Material, float> ditherRest = new Dictionary<Material, float>();
    readonly StringBuilder md = new StringBuilder();
    readonly List<string> json = new List<string>();
    int a2cSamples = 4;

    struct Res { public int w, h; public string name; }
    // HybridLocks / HybridMass: the hybrid with only its locks and cards, or only its inner mass (the flicker split)
    enum Hair { None, Baseline, Hybrid, HybridLocks, HybridMass }

    void Start()
    {
        Application.runInBackground = true; // an unfocused editor (or player window) otherwise throttles
        if (!Application.isEditor)
        {
            // a player must not wait on the display: the GPU time is what is measured, and vsync would hold every frame to 60 Hz
            QualitySettings.vSyncCount = 0; Application.targetFrameRate = -1;
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i + 1 < args.Length; i++)
            {
                if (args[i] == "-hpOut") outDir = args[i + 1];
                if (args[i] == "-hpFrames") int.TryParse(args[i + 1], out runFrames);
            }
        }
        StartCoroutine(RunAll());
    }

    IEnumerator RunAll()
    {
        yield return null; // every Start has run: both hairs are built against the rest pose before anything moves
        Directory.CreateDirectory(outDir);
        foreach (var d in new[] { "stills", "seq", "overdraw" }) Directory.CreateDirectory(Path.Combine(outDir, d));
        headRestRot = head.rotation; headRestPos = head.position;
        foreach (var h in new[] { baseline, hybrid })
        {
            h.manualStep = true;
            if (h.material != null) ditherRest[h.material] = h.material.GetFloat("_DitherStrength");
        }
        cam.enabled = false; // rendered by hand, once per frame (or in timing bursts)
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        int msaaRest = urp != null ? urp.msaaSampleCount : 1;
        var ucd = cam.GetUniversalAdditionalCameraData();
        bool ftm = FrameTimingManager.IsFeatureEnabled();
        Log("HYBRIDPROOF start: " + SystemInfo.graphicsDeviceName + " / " + SystemInfo.graphicsDeviceType + " / Unity " + Application.unityVersion
            + " / URP msaa " + msaaRest + " / FrameTimingManager " + (ftm ? "on" : "off (burst timing only)"));
        md.AppendLine("# Hybrid proof, " + DateTime.Now.ToString("yyyy-MM-dd HH:mm", IC) + (Application.isEditor ? " (editor play mode)" : " (standalone player, " + (Debug.isDebugBuild ? "development" : "release") + " build)"));
        md.AppendLine();
        md.AppendLine("GPU: " + SystemInfo.graphicsDeviceName + " (" + SystemInfo.graphicsDeviceType + "), Unity " + Application.unityVersion
            + ". Locks baseline " + LockTris(baseline) + " tris, hybrid " + LockTris(hybrid) + " tris + mass " + MassTris(hybrid) + " tris. Hybrid " + hybrid.MassSeatReport + ".");
        md.AppendLine();
        WriteCamPath();
        cam.backgroundColor = clearLinear;
        yield return null;

        // 1) four parity views at rest, clip mode like TobinFitTest
        SetAa(ucd, urp, false, false); SetAlphaMode(false, false);
        if (!matrixOnly)
        {
            foreach (var hv in new[] { Hair.Baseline, Hair.Hybrid })
            {
                ShowHair(hv); Pose(0); SnapAll(); for (int i = 0; i < warmFrames; i++) TickVisible();
                yield return null;
                ParitySheet(hv);
            }
            // 1b) ear isolation (dev group review, Nov 25): which layer makes the tan band above the ear in Unity
            ShowHair(Hair.Hybrid); Pose(0); SnapAll(); for (int i = 0; i < warmFrames; i++) TickVisible();
            yield return null;
            IsolationSheet();
        }
        // 1c) depth prepass: does the hair survive a depth texture request or forced depth priming (phase 2c)
        yield return DepthCheck(ucd, urp);

        // 2) the matrix
        var resList = new[] { new Res { w = 1920, h = 1080, name = "1080p" }, new Res { w = 2560, h = 1440, name = "1440p" } };
        md.AppendLine("| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |");
        md.AppendLine("|---|---|---|---|---|---|---|---|---|---|---|---|");
        foreach (var res in resList)
            foreach (var mode in new[] { "a2c", "taa" })
            {
                bool a2c = mode == "a2c";
                SetAa(ucd, urp, a2c, !a2c); SetAlphaMode(a2c, !a2c);
                var rt = new RenderTexture(res.w, res.h, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear) { antiAliasing = a2c ? a2cSamples : 1 };
                rt.Create();
                cam.targetTexture = rt; cam.aspect = (float)res.w / res.h;
                foreach (var dist in new[] { "close", "mid" })
                {
                    float dk = dist == "close" ? 1.2f : 2.6f;
                    RunStats none = default;
                    var hairs = new List<Hair> { Hair.None, Hair.Baseline, Hair.Hybrid };
                    if (res.name == "1080p" && a2c && dist == "close") { hairs.Add(Hair.HybridLocks); hairs.Add(Hair.HybridMass); } // flicker split by layer
                    foreach (var hv in hairs)
                    {
                        string run = res.name + "_" + mode + "_" + dist + "_" + hv.ToString().ToLowerInvariant();
                        var st = new RunStats();
                        yield return Timed(hv, dk, rt, st);
                        yield return Captured(hv, dk, rt, st, run, res.name == "1080p" && dist == "close" && hv != Hair.None);
                        if (hv != Hair.None && !a2c) Overdraw(hv, dk, rt, st, run); // overdraw does not depend on the alpha mode
                        if (hv == Hair.None) { none = st; continue; }
                        double cost = (st.gpuMedian > 0 && none.gpuMedian > 0) ? st.gpuMedian - none.gpuMedian : st.burst - none.burst;
                        double shim = st.shimmer - none.shimmer;
                        md.AppendLine("| " + res.name + " | " + (a2c ? "MSAA " + a2cSamples + "x + A2C" : "clip + dither + TAA") + " | " + dist + " | " + hv
                            + " | " + F(st.gpuMedian) + " / " + F(st.gpuP95) + " (none " + F(none.gpuMedian) + " / " + F(none.gpuP95) + ") | " + F(st.burst) + " (none " + F(none.burst) + ") | " + F(cost)
                            + " | " + (st.odMean > 0 ? F(st.odMean, 1) + " / " + F(st.odP95, 1) + " / " + F(st.odMax, 0) : "see TAA row")
                            + " | " + F(shim, 4) + " (raw " + F(st.shimmer, 4) + ", peak " + F(st.shimmerPeak, 4) + ") | " + st.pops + " | " + st.badPx + (st.badFirst >= 0 ? " from f" + st.badFirst : "") + " (" + none.badPx + ") | " + F(st.cpuMs) + " (" + F(st.solverMs) + " / " + F(st.meshMs) + ") |");
                        json.Add("{\"run\":\"" + run + "\",\"gpuMedianMs\":" + J(st.gpuMedian) + ",\"gpuP95Ms\":" + J(st.gpuP95) + ",\"gpuNoneMs\":" + J(none.gpuMedian) + ",\"burstMs\":" + J(st.burst)
                            + ",\"burstNoneMs\":" + J(none.burst) + ",\"hairCostMs\":" + J(cost) + ",\"overdrawMean\":" + J(st.odMean) + ",\"overdrawP95\":" + J(st.odP95)
                            + ",\"overdrawMax\":" + J(st.odMax) + ",\"hairCoverage\":" + J(st.odCoverage) + ",\"shimmerHair\":" + J(shim) + ",\"shimmerRaw\":" + J(st.shimmer)
                            + ",\"shimmerPeak\":" + J(st.shimmerPeak) + ",\"pops\":" + st.pops + ",\"badPx\":" + st.badPx + ",\"badPxNone\":" + none.badPx + ",\"cpuMs\":" + J(st.cpuMs) + ",\"solverMs\":" + J(st.solverMs) + ",\"meshMs\":" + J(st.meshMs) + "}");
                        Flush();
                    }
                }
                cam.targetTexture = null; rt.Release(); Destroy(rt);
            }
        if (urp != null) urp.msaaSampleCount = msaaRest;
        md.AppendLine();
        md.AppendLine("Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. "
            + "Burst = wall time of " + timingRepeats + " back-to-back renders of one frame, then a GPU sync, divided by " + timingRepeats + ". "
            + "Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). "
            + "Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. "
            + "Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.");
        Flush();
        Log("HYBRIDPROOF RESULT PASS " + Path.Combine(outDir, "summary.md"));
#if UNITY_EDITOR
        if (exitWhenDone) { UnityEditor.EditorApplication.isPlaying = false; if (Application.isBatchMode) UnityEditor.EditorApplication.Exit(0); }
#else
        if (exitWhenDone) Application.Quit(0);
#endif
    }

    class RunStats { public double solverMs, meshMs, gpuP95, gpuMedian, burst, shimmer, shimmerPeak, cpuMs, odMean, odP95, odMax, odCoverage; public int pops; public long badPx; public int badFirst = -1; }

    // ---- motion: the web app's turn (HairViewport applyMotionPose / cpu_preview --pose turn), mirrored into Unity ----
    void Pose(int f)
    {
        float t = f / 60f;
        float swing = Mathf.Sin(t * 2.15f);
        float rx = Mathf.Sin(t * 1.4f) * 0.055f, ry = swing * 0.62f, rz = -swing * 0.085f; // three.js Euler XYZ, radians
        // web quaternion (x, y, z, w) <-> Unity (x, -y, -z, w) (AetherStrandWebHair.ToWebPose), so Ry and Rz flip sign
        Quaternion q = Quaternion.AngleAxis(rx * Mathf.Rad2Deg, Vector3.right) * Quaternion.AngleAxis(-ry * Mathf.Rad2Deg, Vector3.up) * Quaternion.AngleAxis(-rz * Mathf.Rad2Deg, Vector3.forward);
        head.rotation = root.rotation * q * Quaternion.Inverse(root.rotation) * headRestRot;
        float us = hybrid != null ? hybrid.unitScale : 1f;
        Vector3 webOff = new Vector3(swing * 0.022f, (Mathf.Cos(t * 4.3f) - 1f) * 0.012f, 0f); // zero at rest
        head.position = headRestPos + root.TransformDirection(new Vector3(-webOff.x, webOff.y, webOff.z)) * us;
    }

    // ---- camera path: a slow orbit across the face with a small rise and dolly, around the rest head centre ----
    void CamAt(int f, float dk)
    {
        float u = Mathf.Clamp01(f / (float)runFrames);
        float th = (-35f + 70f * (0.5f - 0.5f * Mathf.Cos(Mathf.PI * u))) * Mathf.Deg2Rad;
        float ph = (8f + 4f * Mathf.Sin(2f * Mathf.PI * u)) * Mathf.Deg2Rad;
        float r = dk * (1f + 0.06f * Mathf.Sin(3f * Mathf.PI * u)) * frameScale;
        Vector3 fwd = root.forward, right = root.right, up = root.up;
        cam.transform.position = frameCentre + (right * (Mathf.Sin(th) * Mathf.Cos(ph)) + up * Mathf.Sin(ph) + fwd * (Mathf.Cos(th) * Mathf.Cos(ph))) * r;
        cam.transform.LookAt(frameCentre, up);
    }

    void WriteCamPath()
    {
        var sb = new StringBuilder("{\"fps\":60,\"frames\":" + runFrames + ",\"fovY\":" + J(cam.fieldOfView) + ",\"paths\":{");
        int k = 0;
        foreach (var dist in new[] { "close", "mid" })
        {
            float dk = dist == "close" ? 1.2f : 2.6f;
            sb.Append((k++ > 0 ? "," : "") + "\"" + dist + "\":[");
            for (int f = 0; f <= runFrames; f++)
            {
                CamAt(f, dk); Pose(f);
                var p = cam.transform.position; var q = cam.transform.rotation; var hq = head.rotation; var hp = head.position;
                sb.Append((f > 0 ? "," : "") + "[" + J(p.x) + "," + J(p.y) + "," + J(p.z) + "," + J(q.x) + "," + J(q.y) + "," + J(q.z) + "," + J(q.w)
                    + "," + J(hp.x) + "," + J(hp.y) + "," + J(hp.z) + "," + J(hq.x) + "," + J(hq.y) + "," + J(hq.z) + "," + J(hq.w) + "]");
            }
            sb.Append("]");
        }
        sb.Append("},\"columns\":\"camPos xyz, camRot xyzw, headPos xyz, headRot xyzw (Unity world)\"}");
        File.WriteAllText(Path.Combine(outDir, "cam_path.json"), sb.ToString());
        Pose(0);
    }

    // the head-centre drivers run in LateUpdate, after this coroutine; apply them first so the shading uses this frame's head
    AetherStrandHeadCenterDriver[] drivers;
    void Draw()
    {
        if (drivers == null) drivers = FindObjectsByType<AetherStrandHeadCenterDriver>(FindObjectsSortMode.None);
        foreach (var d in drivers) d.Apply();
        cam.Render();
    }

    // ---- hair control ----
    void ShowHair(Hair h)
    {
        SetVisible(baseline, h == Hair.Baseline);
        SetVisible(hybrid, h == Hair.Hybrid || h == Hair.HybridLocks || h == Hair.HybridMass);
        var mass = hybrid.MassRenderer;
        if (h == Hair.HybridLocks && mass != null) mass.enabled = false;
        if (h == Hair.HybridMass) foreach (var r in hybrid.GetComponentsInChildren<Renderer>(true)) r.enabled = r == mass;
        foreach (var r in paintRenderers) if (r != null) r.enabled = h != Hair.None;
    }
    static void SetVisible(AetherStrandWebHair h, bool on) { foreach (var r in h.GetComponentsInChildren<Renderer>(true)) r.enabled = on; }
    AetherStrandWebHair Active(Hair h) => h == Hair.Baseline ? baseline : h == Hair.None ? null : hybrid;
    void SnapAll() { baseline.SnapToHead(); hybrid.SnapToHead(); }
    // both hairs step every frame so the hidden one stays in step and costs the same CPU; only the visible one draws
    double TickVisible() { float t0 = Time.realtimeSinceStartup; baseline.Tick(1f / 60f); hybrid.Tick(1f / 60f); return (Time.realtimeSinceStartup - t0) * 1000.0; }

    IEnumerator Restart(Hair hv, float dk)
    {
        ShowHair(hv); Pose(0); CamAt(0, dk); SnapAll();
        for (int i = 0; i < warmFrames; i++) TickVisible();
        Draw(); yield return null; // let TAA history start from the first frame of the path
    }

    IEnumerator Timed(Hair hv, float dk, RenderTexture rt, RunStats st)
    {
        yield return Restart(hv, dk);
        var gpu = new List<double>(); var cpu = new List<double>(); var sol = new List<double>(); var msh = new List<double>(); var ft = new FrameTiming[1];
        for (int f = 1; f <= runFrames; f++)
        {
            Pose(f); CamAt(f, dk);
            float t0 = Time.realtimeSinceStartup;
            var ah = Active(hv);
            ah?.Tick(1f / 60f);
            cpu.Add((Time.realtimeSinceStartup - t0) * 1000.0);
            if (ah != null) { sol.Add(ah.LastSolverMs); msh.Add(ah.LastMeshMs); }
            Draw();
            FrameTimingManager.CaptureFrameTimings();
            if (FrameTimingManager.GetLatestTimings(1, ft) > 0 && f > 10 && ft[0].gpuFrameTime > 0) gpu.Add(ft[0].gpuFrameTime);
            yield return null;
        }
        st.gpuMedian = Median(gpu); st.gpuP95 = Pct(gpu, 0.95); st.cpuMs = hv == Hair.None ? 0 : Median(cpu); st.solverMs = Median(sol); st.meshMs = Median(msh);
        // burst timing at three poses along the path
        var burst = new List<double>();
        foreach (int f in new[] { runFrames / 4, runFrames / 2, 3 * runFrames / 4 })
        {
            CamAt(f, dk); // the head and hair stay at the end of the run, so they stay together; only the view changes
            Draw(); Sync(rt);
            float t0 = Time.realtimeSinceStartup;
            for (int i = 0; i < timingRepeats; i++) Draw();
            Sync(rt);
            burst.Add((Time.realtimeSinceStartup - t0) * 1000.0 / timingRepeats);
            yield return null;
        }
        st.burst = Median(burst);
    }

    IEnumerator Captured(Hair hv, float dk, RenderTexture rt, RunStats st, string run, bool keepSeq)
    {
        yield return Restart(hv, dk);
        int W = rt.width, H = rt.height, step = 2, gw = W / step, gh = H / step;
        float[] l0 = null, l1 = null; var l2 = new float[gw * gh];
        var tex = new Texture2D(W, H, TextureFormat.RGBAHalf, false, true);
        var per = new List<double>();
        string seqDir = Path.Combine(outDir, "seq", run);
        if (keepSeq) Directory.CreateDirectory(seqDir);
        for (int f = 1; f <= runFrames; f++)
        {
            Pose(f); CamAt(f, dk);
            Active(hv)?.Tick(1f / 60f);
            Draw();
            RenderTexture.active = rt; tex.ReadPixels(new Rect(0, 0, W, H), 0, 0, false); RenderTexture.active = null;
            var px = tex.GetPixelData<ushort>(0);
            for (int y = 0; y < gh; y++)
                for (int x = 0; x < gw; x++)
                {
                    int o = ((y * step) * W + x * step) * 4;
                    float lum = 0.2126f * Mathf.HalfToFloat(px[o]) + 0.7152f * Mathf.HalfToFloat(px[o + 1]) + 0.0722f * Mathf.HalfToFloat(px[o + 2]);
                    // a NaN or infinite pixel (shader output) would poison the whole mean: count it, score it as black
                    if (float.IsNaN(lum) || float.IsInfinity(lum)) { st.badPx++; if (st.badFirst < 0) st.badFirst = f; lum = 0f; }
                    l2[y * gw + x] = lum;
                }
            if (l0 != null)
            {
                double s = 0;
                for (int i = 0; i < l2.Length; i++) s += Math.Abs(l2[i] - 2f * l1[i] + l0[i]);
                per.Add(s / l2.Length);
            }
            // rotate buffers
            var tmp = l0 ?? new float[gw * gh]; l0 = l1; l1 = l2; l2 = tmp;
            if (f == 1 || f == runFrames / 3 || f == 2 * runFrames / 3) SaveJpg(tex, Path.Combine(outDir, "stills", run + "_f" + f.ToString("000") + ".jpg"), 92);
            if (keepSeq && f >= seqFrom && f <= seqTo) SaveJpg(tex, Path.Combine(seqDir, f.ToString("000") + ".jpg"), 90);
            yield return null;
        }
        Destroy(tex);
        if (per.Count > 0)
        {
            double sum = 0, peak = 0; foreach (var v in per) { sum += v; peak = Math.Max(peak, v); }
            st.shimmer = sum / per.Count; st.shimmerPeak = peak;
            double med = Median(per); int pops = 0; foreach (var v in per) if (v > 3 * med && v > 1e-5) pops++;
            st.pops = pops;
        }
    }

    // rasterised hair layers: (body + additive hair counts) - body, at the middle of the path
    void Overdraw(Hair hv, float dk, RenderTexture rtColour, RunStats st, string run)
    {
        int W = rtColour.width, H = rtColour.height;
        var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear) { antiAliasing = 1 };
        var ucd = cam.GetUniversalAdditionalCameraData(); var aaRest = ucd.antialiasing; bool ppRest = ucd.renderPostProcessing;
        ucd.antialiasing = AntialiasingMode.None; ucd.renderPostProcessing = false;
        cam.targetTexture = rt; CamAt(runFrames, dk); // head and hair as the capture left them (end of the path)
        ShowHair(Hair.None); var a = Grab(rt);
        ShowHair(hv);
        var rends = new List<Renderer>(Active(hv).GetComponentsInChildren<Renderer>(true)); rends.AddRange(paintRenderers);
        var mats = new Dictionary<Renderer, Material[]>();
        foreach (var r in rends) if (r != null) { mats[r] = r.sharedMaterials; var m = new Material[r.sharedMaterials.Length]; for (int i = 0; i < m.Length; i++) m[i] = overdrawMat; r.sharedMaterials = m; }
        var b = Grab(rt);
        foreach (var kv in mats) kv.Key.sharedMaterials = kv.Value;
        var counts = new List<float>(); float mx = 0; var heat = new Texture2D(W, H, TextureFormat.RGB24, false); var hp = new Color32[W * H];
        for (int i = 0; i < W * H; i++)
        {
            float c = (Mathf.HalfToFloat(b[i * 4]) - Mathf.HalfToFloat(a[i * 4])) * 32f;
            if (c > 0.5f) { counts.Add(c); mx = Mathf.Max(mx, c); }
            float u = Mathf.Clamp01(c / 16f);
            hp[i] = c > 0.5f ? (Color32)Color.HSVToRGB(0.66f * (1f - u), 0.9f, 0.35f + 0.65f * u) : new Color32(0, 0, 0, 255);
        }
        heat.SetPixels32(hp); heat.Apply(false);
        File.WriteAllBytes(Path.Combine(outDir, "overdraw", run + ".png"), heat.EncodeToPNG()); Destroy(heat);
        if (counts.Count > 0)
        {
            counts.Sort(); double s = 0; foreach (var c in counts) s += c;
            st.odMean = s / counts.Count; st.odP95 = counts[(int)(counts.Count * 0.95f)]; st.odMax = mx; st.odCoverage = counts.Count / (double)(W * H);
        }
        ucd.antialiasing = aaRest; ucd.renderPostProcessing = ppRest; cam.targetTexture = rtColour;
        rt.Release(); Destroy(rt);
    }

    ushort[] Grab(RenderTexture rt)
    {
        Draw();
        var t = new Texture2D(rt.width, rt.height, TextureFormat.RGBAHalf, false, true);
        RenderTexture.active = rt; t.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0, false); RenderTexture.active = null;
        var d = t.GetPixelData<ushort>(0).ToArray(); Destroy(t); return d;
    }

    // wait for the GPU: reading one pixel back blocks until every queued render into rt is done (and resolves MSAA,
    // which AsyncGPUReadback does not take)
    Texture2D syncTex;
    void Sync(RenderTexture rt)
    {
        if (syncTex == null) syncTex = new Texture2D(1, 1, TextureFormat.RGBAHalf, false, true);
        RenderTexture.active = rt; syncTex.ReadPixels(new Rect(0, 0, 1, 1), 0, 0, false); syncTex.Apply(false); RenderTexture.active = null;
    }
    static void SaveJpg(Texture2D linearHalf, string path, int q) { var t = ToneMap(linearHalf); File.WriteAllBytes(path, t.EncodeToJPG(q)); Destroy(t); }

    // ---- four parity views at rest (TobinFitTest framing), 1024 then 2x2 down to 512 each ----
    void ParitySheet(Hair hv)
    {
        var rt = new RenderTexture(1024, 1024, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
        cam.targetTexture = rt; cam.aspect = 1f;
        Pose(0); SnapAll(); for (int i = 0; i < warmFrames; i++) TickVisible();
        Vector3 fwd = root.forward, right = root.right;
        var views = new[] { new Vector3(0, 0.38f, 1.84f), new Vector3(0, 0.38f, -1.84f), new Vector3(1.86f, 0.38f, 0), new Vector3(-1.86f, 0.38f, 0) };
        int[] gx = { 0, 1, 0, 1 }, gy = { 1, 1, 0, 0 };
        var sheet = new Texture2D(1024, 1024, TextureFormat.RGB24, false);
        var th = new Texture2D(1024, 1024, TextureFormat.RGBAHalf, false, true);
        for (int k = 0; k < 4; k++)
        {
            Vector3 v = views[k];
            cam.transform.position = frameCentre + (right * (-v.x) + Vector3.up * (v.y - 0.38f) + fwd * v.z) * frameScale;
            cam.transform.LookAt(frameCentre);
            Draw(); RenderTexture.active = rt; th.ReadPixels(new Rect(0, 0, 1024, 1024), 0, 0, false); RenderTexture.active = null;
            var tm = ToneMap(th, 2);
            sheet.SetPixels(gx[k] * 512, gy[k] * 512, 512, 512, tm.GetPixels()); Destroy(tm);
        }
        sheet.Apply(false);
        File.WriteAllBytes(Path.Combine(outDir, "sheet_" + hv.ToString().ToLowerInvariant() + ".png"), sheet.EncodeToPNG());
        Destroy(sheet); Destroy(th); cam.targetTexture = null; rt.Release(); Destroy(rt);
    }

    // ---- ear isolation: the hybrid's left side at rest, close, one layer at a time (dev group review, Nov 25) ----
    // Panels: all | paint only | mass + paint | mass in flat grey, no paint | locks and cards + paint | paint, lights logged.
    // Tells whether the tan band above the ear comes from the mass's material, its lighting, its edge, or a pale paint under it.
    void IsolationSheet()
    {
        const int S = 768;
        var rt = new RenderTexture(S, S, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
        cam.targetTexture = rt; cam.aspect = 1f;
        Vector3 fwd = root.forward, right = root.right;
        // the parity sheet's left view (web +x), pulled in to frame the ear and the hairline above it
        cam.transform.position = frameCentre + (right * -0.95f + Vector3.up * -0.08f + fwd * 0.18f) * frameScale;
        cam.transform.LookAt(frameCentre + Vector3.up * (-0.10f * frameScale) + right * (-0.30f * frameScale));
        var mass = hybrid.MassRenderer;
        var grey = new Material(Shader.Find("Universal Render Pipeline/Lit")); grey.SetColor("_BaseColor", new Color(0.5f, 0.5f, 0.5f, 1f)); grey.SetFloat("_Smoothness", 0.2f);
        Material massMat = mass != null ? mass.sharedMaterial : null;
        string[] names = { "all", "paint only", "mass + paint", "mass flat grey, no paint", "locks + cards + paint", "nothing (skin)" };
        var sheet = new Texture2D(S * 3, S * 2, TextureFormat.RGB24, false);
        var th = new Texture2D(S, S, TextureFormat.RGBAHalf, false, true);
        for (int k = 0; k < 6; k++)
        {
            ShowHair(Hair.Hybrid);
            var hr = hybrid.GetComponentsInChildren<Renderer>(true);
            bool paint = k != 3 && k != 5;
            foreach (var r in paintRenderers) if (r != null) r.enabled = paint;
            foreach (var r in hr)
            {
                bool isMass = r == mass;
                r.enabled = k == 0 || (k == 2 && isMass) || (k == 3 && isMass) || (k == 4 && !isMass);
            }
            if (mass != null) mass.sharedMaterial = k == 3 ? grey : massMat;
            Draw(); RenderTexture.active = rt; th.ReadPixels(new Rect(0, 0, S, S), 0, 0, false); RenderTexture.active = null;
            var tm = ToneMap(th, 1);
            sheet.SetPixels((k % 3) * S, (1 - k / 3) * S, S, S, tm.GetPixels()); Destroy(tm);
        }
        if (mass != null) mass.sharedMaterial = massMat;
        ShowHair(Hair.Hybrid);
        sheet.Apply(false);
        File.WriteAllBytes(Path.Combine(outDir, "ear_isolation.png"), sheet.EncodeToPNG());
        Destroy(sheet); Destroy(th); Destroy(grey); cam.targetTexture = null; rt.Release(); Destroy(rt);
        // what lights the paint in Unity; the web lights it with a fixed direction (-0.4, 0.8, 0.6), colour x1, no ambient
        var L = RenderSettings.sun != null ? RenderSettings.sun : FindAnyLight();
        var sb = new StringBuilder("## Ear isolation\n\nPanels, left to right then down: " + string.Join(" | ", names) + ".\n\n");
        foreach (var r in paintRenderers)
            if (r != null && r.sharedMaterial != null && r.sharedMaterial.HasProperty("_Color"))
            { var c = r.sharedMaterial.GetColor("_Color"); sb.Append("- Paint _Color sRGB " + F(c.r, 3) + ", " + F(c.g, 3) + ", " + F(c.b, 3) + " (linear " + F(c.linear.r, 3) + ", " + F(c.linear.g, 3) + ", " + F(c.linear.b, 3) + ")\n"); break; }
        if (L != null) sb.Append("- Main light " + L.name + ": colour " + F(L.color.r, 3) + ", " + F(L.color.g, 3) + ", " + F(L.color.b, 3) + " x intensity " + F(L.intensity, 3) + ", direction to light " + V3(-L.transform.forward) + " (web paint uses (-0.4, 0.8, 0.6) normalised, colour 1)\n");
        else sb.Append("- No main light found\n");
        var sh = RenderSettings.ambientProbe; var outs = new Color[1];
        sh.Evaluate(new[] { -root.right }, outs);
        sb.Append("- Ambient (SH) on the left side of the head: " + F(outs[0].r, 3) + ", " + F(outs[0].g, 3) + ", " + F(outs[0].b, 3) + " (the Unity paint adds 0.25 x this; the web adds none)\n");
        sb.Append("- Ambient mode " + RenderSettings.ambientMode + ", intensity " + F(RenderSettings.ambientIntensity, 3) + "\n\n");
        md.Append(sb);
        Log("HYBRIDPROOF ear isolation written");
    }
    static Light FindAnyLight() { foreach (var l in FindObjectsByType<Light>(FindObjectsSortMode.None)) if (l.type == LightType.Directional && l.isActiveAndEnabled) return l; return null; }
    static string V3(Vector3 v) => "(" + F(v.x, 3) + ", " + F(v.y, 3) + ", " + F(v.z, 3) + ")";

    // ---- camera and material modes ----
    void SetAa(UniversalAdditionalCameraData ucd, UniversalRenderPipelineAsset urp, bool msaa, bool taa)
    {
        if (urp != null) urp.msaaSampleCount = msaa ? a2cSamples : 1;
        cam.allowMSAA = msaa;
        ucd.antialiasing = taa ? AntialiasingMode.TemporalAntiAliasing : AntialiasingMode.None;
        ucd.renderPostProcessing = taa; // URP runs TAA in the post-processing pass; the scene has no volume, so nothing else changes
    }

    void SetAlphaMode(bool a2c, bool taa)
    {
        foreach (var kv in ditherRest)
        {
            var m = kv.Key;
            m.SetFloat("_AlphaToMask", a2c ? 1f : 0f);
            if (a2c) m.EnableKeyword("_ALPHA_TO_COVERAGE"); else m.DisableKeyword("_ALPHA_TO_COVERAGE");
            // A2C: coverage replaces the dither. TAA: full dither, so the accumulation turns it into soft tips. Plain clip: as authored.
            m.SetFloat("_DitherStrength", a2c ? 0f : taa ? 1f : kv.Value);
        }
    }

    // ---- depth prepass (phase 2c) ----
    // Games often ask URP for a depth texture (SSAO, soft particles, depth of field), and with MSAA on the forward renderer
    // then draws a depth prepass with each material's DepthOnly pass; depth priming goes further and draws the colour pass
    // with ZTest Equal against that prepass. Either way the DepthOnly pass's clip decides which hair pixels exist, so a
    // DepthOnly clip that differs from the forward pass (or that cannot do alpha to coverage) cuts soft tips or leaves
    // holes. This renders the hybrid at rest three ways (as the matrix runs it, with a depth texture requested, with depth
    // priming forced on every URP renderer) and compares the hair pixels. Changed = hair pixels whose linear luminance
    // moved by more than 0.02; holes = hair pixels that now match the no-hair frame (the hair is gone there).
    IEnumerator DepthCheck(UniversalAdditionalCameraData ucd, UniversalRenderPipelineAsset urp)
    {
        var datas = new List<UniversalRendererData>();
        try
        {
            var fi = typeof(UniversalRenderPipelineAsset).GetField("m_RendererDataList", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if (urp != null && fi != null && fi.GetValue(urp) is ScriptableRendererData[] list)
                foreach (var d in list) if (d is UniversalRendererData u) datas.Add(u);
        }
        catch (Exception e) { Log("HYBRIDPROOF depth check: renderer list not readable (" + e.Message + "); priming run skipped"); }
        var primRest = new List<DepthPrimingMode>(); foreach (var d in datas) primRest.Add(d.depthPrimingMode);
        bool depthRest = ucd.requiresDepthTexture;
        md.AppendLine("## Depth prepass");
        md.AppendLine();
        md.AppendLine("Hybrid at rest, 1080p close. Changed = hair pixels whose linear luminance moved over 0.02 against the matrix render; holes = hair pixels that now show what is behind the hair. Priming restored to " + (primRest.Count > 0 ? primRest[0].ToString() : "n/a") + " afterwards.");
        md.AppendLine();
        md.AppendLine("| alpha | variant | hair px | changed % | holes % | mean abs diff (linear lum) |");
        md.AppendLine("|---|---|---|---|---|---|");
        const int W = 1920, H = 1080; const float dk = 1.2f;
        foreach (var mode in new[] { "a2c", "clip" })
        {
            bool a2c = mode == "a2c";
            SetAa(ucd, urp, a2c, false); SetAlphaMode(a2c, false);
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear) { antiAliasing = a2c ? a2cSamples : 1 };
            rt.Create(); cam.targetTexture = rt; cam.aspect = (float)W / H;
            yield return Restart(Hair.Hybrid, dk);
            ShowHair(Hair.None); var none = Grab(rt);
            ShowHair(Hair.Hybrid); var refPx = Grab(rt);
            var variants = new List<KeyValuePair<string, ushort[]>>();
            ucd.requiresDepthTexture = true; yield return null;
            variants.Add(new KeyValuePair<string, ushort[]>("depth texture", Grab(rt)));
            ucd.requiresDepthTexture = depthRest;
            if (datas.Count > 0)
            {
                foreach (var d in datas) d.depthPrimingMode = DepthPrimingMode.Forced;
                yield return null;
                variants.Add(new KeyValuePair<string, ushort[]>("priming forced", Grab(rt)));
                for (int i = 0; i < datas.Count; i++) datas[i].depthPrimingMode = primRest[i];
                yield return null;
            }
            md.AppendLine("| " + (a2c ? "MSAA " + a2cSamples + "x + A2C" : "clip") + " | matrix render | " + HairPx(refPx, none) + " | 0 | 0 | 0 |");
            var strip = new Texture2D(W * (1 + variants.Count), H, TextureFormat.RGBAHalf, false, true);
            Blit(strip, refPx, 0, W, H, 1f);
            for (int v = 0; v < variants.Count; v++)
            {
                var x = variants[v].Value; long hair = 0, changed = 0, holes = 0; double sum = 0;
                var diff = new Color32[W * H];
                for (int i = 0; i < W * H; i++)
                {
                    float lr = Lum(refPx, i), ln = Lum(none, i), lx = Lum(x, i);
                    float d = Mathf.Abs(lx - lr);
                    byte g8 = (byte)Mathf.RoundToInt(Mathf.Min(1f, d * 8f) * 255f); diff[i] = new Color32(g8, g8, g8, 255);
                    if (Mathf.Abs(lr - ln) < 0.01f) continue; // not a hair pixel
                    hair++; sum += d;
                    if (d > 0.02f) changed++;
                    if (Mathf.Abs(lx - ln) < 0.01f) holes++;
                }
                md.AppendLine("| " + (a2c ? "MSAA " + a2cSamples + "x + A2C" : "clip") + " | " + variants[v].Key + " | " + hair + " | " + F(100.0 * changed / Math.Max(1, hair), 2) + " | " + F(100.0 * holes / Math.Max(1, hair), 2) + " | " + F(sum / Math.Max(1, hair), 4) + " |");
                json.Add("{\"run\":\"depth_" + mode + "_" + variants[v].Key.Replace(' ', '_') + "\",\"hairPx\":" + hair + ",\"changedPct\":" + J(100.0 * changed / Math.Max(1, hair)) + ",\"holesPct\":" + J(100.0 * holes / Math.Max(1, hair)) + ",\"meanAbsDiff\":" + J(sum / Math.Max(1, hair)) + "}");
                Blit(strip, x, W * (v + 1), W, H, 1f);
                if (v == variants.Count - 1) { var dt = new Texture2D(W, H, TextureFormat.RGB24, false); dt.SetPixels32(diff); dt.Apply(false); File.WriteAllBytes(Path.Combine(outDir, "depth_" + mode + "_diff_x8.png"), dt.EncodeToPNG()); Destroy(dt); }
            }
            strip.Apply(false);
            var tm = ToneMap(strip, 2); File.WriteAllBytes(Path.Combine(outDir, "depth_" + mode + ".png"), tm.EncodeToPNG()); Destroy(tm); Destroy(strip);
            cam.targetTexture = null; rt.Release(); Destroy(rt);
            Flush();
        }
        md.AppendLine();
        md.AppendLine("Images: depth_<alpha>.png = matrix render | depth texture | priming forced (tone mapped); depth_<alpha>_diff_x8.png = |last variant - matrix| x 8. Where priming made no difference at all, URP may have turned it off for this camera (it does with some MSAA set-ups), which this check cannot see.");
        md.AppendLine();
    }
    static float Lum(ushort[] p, int i) => 0.2126f * Mathf.HalfToFloat(p[i * 4]) + 0.7152f * Mathf.HalfToFloat(p[i * 4 + 1]) + 0.0722f * Mathf.HalfToFloat(p[i * 4 + 2]);
    static long HairPx(ushort[] a, ushort[] none) { long n = 0; for (int i = 0; i < a.Length / 4; i++) if (Mathf.Abs(Lum(a, i) - Lum(none, i)) >= 0.01f) n++; return n; }
    static void Blit(Texture2D dst, ushort[] src, int x0, int w, int h, float k)
    {
        var d = dst.GetPixelData<ushort>(0); int DW = dst.width;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) for (int c = 0; c < 4; c++) d[((y * DW) + x0 + x) * 4 + c] = src[(y * w + x) * 4 + c];
    }

    // ---- helpers ----
    static int LockTris(AetherStrandWebHair h) { var mf = h != null ? h.GetComponent<MeshFilter>() : null; return mf != null && mf.sharedMesh != null ? (int)(mf.sharedMesh.GetIndexCount(0) / 3) : 0; }
    static int MassTris(AetherStrandWebHair h) { var r = h != null ? h.MassRenderer : null; var mf = r != null ? r.GetComponent<MeshFilter>() : null; return mf != null && mf.sharedMesh != null ? (int)(mf.sharedMesh.GetIndexCount(0) / 3) : 0; }
    static double Pct(List<double> v, double p) { if (v.Count == 0) return 0; var c = new List<double>(v); c.Sort(); return c[Math.Min(c.Count - 1, (int)Math.Floor(p * c.Count))]; }
    static double Median(List<double> v) { if (v.Count == 0) return 0; var c = new List<double>(v); c.Sort(); return c[c.Count / 2]; }
    static string F(double v, int d = 2) => v.ToString("F" + d, IC);
    static string J(double v) => double.IsNaN(v) || double.IsInfinity(v) ? "null" : v.ToString("R", IC);
    void Log(string s) { Debug.Log(s); }
    void Flush()
    {
        File.WriteAllText(Path.Combine(outDir, "summary.md"), md.ToString());
        File.WriteAllText(Path.Combine(outDir, "summary.json"), "[" + string.Join(",\n", json) + "]");
    }

    // three.js ACESFilmicToneMapping (exposure 1.16) + sRGB, as ParityRender; ss = box downsample factor
    static Texture2D ToneMap(Texture2D src, int ss = 1)
    {
        int W = src.width / ss, H = src.height / ss, SW = src.width;
        var px = src.GetPixelData<ushort>(0);
        var o = new Color32[W * H];
        for (int y = 0; y < H; y++)
            for (int x = 0; x < W; x++)
            {
                float r = 0, g = 0, b = 0;
                for (int j = 0; j < ss; j++)
                    for (int i = 0; i < ss; i++)
                    {
                        int k = ((y * ss + j) * SW + (x * ss + i)) * 4;
                        Aces(Mathf.HalfToFloat(px[k]), Mathf.HalfToFloat(px[k + 1]), Mathf.HalfToFloat(px[k + 2]), out float tr, out float tg, out float tb);
                        r += Lin2S(tr); g += Lin2S(tg); b += Lin2S(tb);
                    }
                float n = 1f / (ss * ss);
                o[y * W + x] = new Color32((byte)Mathf.RoundToInt(r * n * 255f), (byte)Mathf.RoundToInt(g * n * 255f), (byte)Mathf.RoundToInt(b * n * 255f), 255);
            }
        var t = new Texture2D(W, H, TextureFormat.RGB24, false); t.SetPixels32(o); t.Apply(false); return t;
    }
    static float Lin2S(float v) { v = Mathf.Clamp01(v); return v <= 0.0031308f ? v * 12.92f : 1.055f * Mathf.Pow(v, 1f / 2.4f) - 0.055f; }
    static float Fit(float v) => (v * (v + 0.0245786f) - 0.000090537f) / (v * (0.983729f * v + 0.4329510f) + 0.238081f);
    static void Aces(float r, float g, float b, out float or, out float og, out float ob)
    {
        const float e = 1.16f / 0.6f; r *= e; g *= e; b *= e;
        float r1 = Fit(0.59719f * r + 0.35458f * g + 0.04823f * b), g1 = Fit(0.07600f * r + 0.90834f * g + 0.01566f * b), b1 = Fit(0.02840f * r + 0.13383f * g + 0.83777f * b);
        or = Mathf.Clamp01(1.60475f * r1 - 0.53108f * g1 - 0.07367f * b1); og = Mathf.Clamp01(-0.10208f * r1 + 1.10813f * g1 - 0.00605f * b1); ob = Mathf.Clamp01(-0.00327f * r1 - 0.07276f * g1 + 1.07602f * b1);
    }
}
