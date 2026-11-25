// Scratch harness (NOT game code): builds the fixed hybrid proof scene on Tobin and plays it (HybridProofRunner does the runs).
// Both hairs go on through the live path (AetherStrandWebImport.ApplyLive), which builds the scalp paint and fade and, for the
// hybrid export, the inner mass. Lights and hair-material rig are TobinFitTest's (the web studio rig).
// Put this file in an Editor folder (beside TobinFitTest.cs) and tools/parity/runtime/* in a non-Editor folder.
// Batch:  Unity -batchmode -projectPath <game> -executeMethod HybridProofTest.Run   (no -quit: the runner exits when done)
// Editor: Tools > AetherStrand > Parity > Hybrid Proof
// Env: SC_HP_BASE_GEO (today's export), SC_HP_HYB_GEO (export with --mass --edge-cards 24), SC_HP_RECIPE, SC_PARITY_RIG,
//      SC_PARITY_OUT (results folder), SC_HP_FRAMES (frames per run, default 150), SC_HP_EXIT (1 = quit Unity when done)
using System;
using System.IO;
using AetherStrand;
using AetherStrand.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class HybridProofTest
{
    [Serializable] class V3 { public float x, y, z; }
    [Serializable] class Rig { public string bg, keyC, fillC, rimC, skyC, gndC; public V3 keyD, fillD, rimD; public float keyI, fillI, rimI, hemiI; }

    [MenuItem("Tools/AetherStrand/Parity/Hybrid Proof")]
    public static void Run()
    {
        try { Setup(); }
        catch (Exception e) { Debug.LogError("HYBRIDPROOF EXCEPTION " + e); if (Application.isBatchMode) EditorApplication.Exit(1); }
    }

    static void Setup()
    {
        if (GraphicsSettings.currentRenderPipeline == null) throw new Exception("no URP asset");
        string outDir = ParityRender.Env("SC_PARITY_OUT", "<scratch>/hybrid_proof");
        string baseGeo = ParityRender.Env("SC_HP_BASE_GEO", "<scratch>/web_out/mage_base/PresetGeometry.json");
        string hybGeo = ParityRender.Env("SC_HP_HYB_GEO", "<scratch>/web_out/mage_hybrid/PresetGeometry.json");
        string recipe = ParityRender.Env("SC_HP_RECIPE", "<aetherstrand>/tools/hair-blocks/recipes/loop_messy-mage.json");
        var rig = JsonUtility.FromJson<Rig>(File.ReadAllText(ParityRender.Env("SC_PARITY_RIG", "<scratch>/web_out/rig_studio.json")));
        foreach (var f in new[] { baseGeo, hybGeo, recipe }) if (!File.Exists(f)) throw new Exception("missing " + f);
        if (!AssetDatabase.IsValidFolder("Assets/Parity")) AssetDatabase.CreateFolder("Assets", "Parity");

        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var tobin = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Tobin/TobinBase.fbx"));
        tobin.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        Transform head = AetherStrandMeshGenerator.ResolveHeadBone(tobin);
        if (head == null) throw new Exception("no head bone");
        var anim = tobin.GetComponent<Animator>(); if (anim != null) anim.enabled = false; // the runner poses the head bone itself

        // today's hair first, renamed so the second ApplyLive does not replace it; the scalp paint is shared (same recipe)
        var baseHair = AetherStrandWebImport.ApplyLive(tobin, baseGeo, recipe, "Assets/Parity", "HP_base", true);
        if (baseHair == null) throw new Exception("ApplyLive (baseline) failed");
        baseHair.gameObject.name = "AetherStrand_WebHair_Baseline";
        var hybHair = AetherStrandWebImport.ApplyLive(tobin, hybGeo, recipe, "Assets/Parity", "HP_hyb", true);
        if (hybHair == null) throw new Exception("ApplyLive (hybrid) failed");
        hybHair.gameObject.name = "AetherStrand_WebHair_Hybrid";
        if (!new AetherStrandWebMassCheck(hybGeo).HasMass) Debug.LogWarning("HYBRIDPROOF the hybrid export has no hybridMass block (export with --mass)");

        // web studio rig on the hair materials, exactly as TobinFitTest
        Func<string, float, Vector4> LinC = (h, k) => { Color c; ColorUtility.TryParseHtmlString(h, out c); c = c.linear * k; return new Vector4(c.r, c.g, c.b, 0); };
        Func<V3, Vector4> MDir = d => { var v = new Vector3(-d.x, d.y, d.z).normalized; return new Vector4(v.x, v.y, v.z, 0); };
        foreach (var m in new[] { baseHair.material, hybHair.material })
        {
            m.SetFloat("_UseWebRig", 1f);
            m.SetVector("_KeyDirW", MDir(rig.keyD)); m.SetVector("_KeyColW", LinC(rig.keyC, rig.keyI * 0.42f));
            m.SetVector("_FillDirW", MDir(rig.fillD)); m.SetVector("_FillColW", LinC(rig.fillC, rig.fillI * 0.38f));
            m.SetVector("_RimDirW", MDir(rig.rimD)); m.SetVector("_RimColW", LinC(rig.rimC, rig.rimI * 0.42f));
            m.SetVector("_AmbColW", LinC(rig.skyC, rig.hemiI * 0.48f));
            EditorUtility.SetDirty(m);
        }

        Color bg; ColorUtility.TryParseHtmlString(rig.bg, out bg);
        Action<string, V3, string, float> Dir = (n, d, col, inten) =>
        {
            var g = new GameObject(n); var l = g.AddComponent<Light>(); l.type = LightType.Directional;
            Color c; ColorUtility.TryParseHtmlString(col, out c); l.color = c; l.intensity = inten / Mathf.PI; l.shadows = LightShadows.None;
            g.transform.rotation = Quaternion.LookRotation(-new Vector3(-d.x, d.y, d.z).normalized);
        };
        Dir("key", rig.keyD, rig.keyC, rig.keyI); Dir("fill", rig.fillD, rig.fillC, rig.fillI); Dir("rim", rig.rimD, rig.rimC, rig.rimI);
        RenderSettings.ambientMode = AmbientMode.Trilight;
        Color sky, gnd; ColorUtility.TryParseHtmlString(rig.skyC, out sky); ColorUtility.TryParseHtmlString(rig.gndC, out gnd);
        float hi = rig.hemiI / Mathf.PI;
        RenderSettings.ambientSkyColor = sky.linear * hi; RenderSettings.ambientEquatorColor = Color.Lerp(sky.linear, gnd.linear, 0.5f) * hi; RenderSettings.ambientGroundColor = gnd.linear * hi;
        RenderSettings.fog = false;

        var camGo = new GameObject("ProofCam"); var cam = camGo.AddComponent<Camera>();
        cam.fieldOfView = 33; cam.nearClipPlane = 0.02f; cam.farClipPlane = 20;
        cam.clearFlags = CameraClearFlags.SolidColor; cam.allowHDR = true; cam.allowMSAA = false;
        var ucd = camGo.AddComponent<UniversalAdditionalCameraData>(); ucd.renderPostProcessing = false;

        string odPath = "Assets/Parity/HP_overdraw.mat";
        var odShader = Shader.Find("Hidden/AetherStrand/ParityOverdraw");
        if (odShader == null) throw new Exception("HybridOverdraw.shader not imported");
        AssetDatabase.DeleteAsset(odPath); var od = new Material(odShader); AssetDatabase.CreateAsset(od, odPath);

        var runGo = new GameObject("HybridProofRunner");
        var run = runGo.AddComponent<HybridProofRunner>();
        run.head = head; run.root = tobin.transform; run.cam = cam;
        run.baseline = baseHair; run.hybrid = hybHair; run.overdrawMat = od;
        var paint = head.Find(AetherStrandScalpPaint.ObjectName);
        run.paintRenderers = paint != null ? new Renderer[] { paint.GetComponent<Renderer>() } : new Renderer[0];
        run.clearLinear = ParityRender.InverseBg(bg).gamma; // as TobinFitTest: the clear colour that tone maps to the web background
        run.frameCentre = head.position + head.up * 0.06f;
        run.frameScale = 0.34f;
        run.outDir = outDir;
        run.runFrames = int.Parse(ParityRender.Env("SC_HP_FRAMES", "150"));
        run.exitWhenDone = ParityRender.Env("SC_HP_EXIT", Application.isBatchMode ? "1" : "0") == "1";
        Debug.Log("HYBRIDPROOF scene: baseline " + baseGeo + ", hybrid " + hybGeo + ", paint " + (paint != null ? "yes" : "none") + ", out " + outDir);

        PlayerSettings.enableFrameTimingStats = true; // FrameTimingManager GPU times
        AssetDatabase.SaveAssets();
        EditorSceneManager.SaveScene(EditorSceneManager.GetActiveScene(), "Assets/Parity/HybridProof.unity");
        EditorApplication.EnterPlaymode();
    }

    // tiny reader so the setup can warn early when the hybrid export lacks its mass
    struct AetherStrandWebMassCheck
    {
        public bool HasMass;
        public AetherStrandWebMassCheck(string path) { HasMass = File.ReadAllText(path).Contains("\"hybridMass\""); }
    }
}
