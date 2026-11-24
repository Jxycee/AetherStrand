#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace AetherStrand.Editor
{
    /// <summary>
    /// Builds the scalp paint layer (fades, sideburn stubble, scalp under thin or parted hair) on any rigged character from the
    /// "scalpPaint" block of a web PresetGeometry.json. Mirrors the web viewport (src/engine/scalpPaintMaterial.ts):
    /// a thin shell over the head-weighted skin triangles, shaded per pixel by AetherStrand/ScalpPaint from the paint curves.
    ///
    /// Each shell vertex carries its web head-pivot-local position in UV1 (xyz), so the shader evaluates the paint exactly as the
    /// web does, whatever the character's head proportions. Web position of a head-bone-local point u: (u - fit.offset) / fit.scale,
    /// then X negated (Unity = web with X mirrored).
    /// </summary>
    public static class AetherStrandScalpPaint
    {
        public const string ObjectName = "AetherStrand_ScalpPaint";
        /// <summary>Lift of the shell off the skin, metres (world).</summary>
        public const float LiftMetres = 0.0006f;

        /// <summary>Builds (or rebuilds) the scalp paint shell under the head bone. Returns the renderer, or null when the geometry has no paint.</summary>
        public static MeshRenderer Build(GameObject character, string presetGeometryJson, Material hairMaterial, string outputFolder, string baseName)
        {
            if (character == null || !File.Exists(presetGeometryJson)) return null;
            ScalpPaintData paint = ScalpPaintData.Load(File.ReadAllText(presetGeometryJson));
            Transform head = AetherStrandMeshGenerator.ResolveHeadBone(character);
            if (head == null) return null;
            var old = head.Find(ObjectName); if (old != null) Object.DestroyImmediate(old.gameObject);
            if (paint == null) { Debug.Log("[AetherStrand] Scalp paint: none in " + Path.GetFileName(presetGeometryJson) + " (re-export from the web generator to get one)."); return null; }
            if (!AetherStrandHeadFit.TryCompute(character, head, out AetherStrandHeadFit.Fit fit)) { Debug.LogWarning("[AetherStrand] Scalp paint: head fit failed."); return null; }

            float lift = LiftMetres / Mathf.Max(1e-6f, head.lossyScale.y);
            Mesh shell = BuildShell(character, head, fit, paint, lift);
            if (shell == null || shell.vertexCount == 0) { Debug.LogWarning("[AetherStrand] Scalp paint: no head-weighted skin under the paint."); return null; }

            string meshPath = outputFolder + "/" + baseName + "_scalpPaint.asset";
            string matPath = outputFolder + "/" + baseName + "_scalpPaint.mat";
            AssetDatabase.DeleteAsset(meshPath);
            AssetDatabase.CreateAsset(shell, meshPath);
            Material mat = CreateMaterial(paint, hairMaterial, matPath);

            var go = new GameObject(ObjectName);
            go.transform.SetParent(head, false);
            go.AddComponent<MeshFilter>().sharedMesh = shell;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            AssetDatabase.SaveAssets();
            Debug.Log("[AetherStrand] Scalp paint: " + shell.vertexCount + " verts, " + (shell.triangles.Length / 3) + " tris.");
            return mr;
        }

        /// <summary>Head-weighted skin triangles (all three corners weighted > 0.5 to the head bone) that the paint can reach, in head-bone space.</summary>
        public static Mesh BuildShell(GameObject character, Transform head, AetherStrandHeadFit.Fit fit, ScalpPaintData paint, float lift)
        {
            var pos = new List<Vector3>(); var nrm = new List<Vector3>(); var web = new List<Vector3>(); var tris = new List<int>();
            foreach (var smr in character.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (smr.sharedMesh == null || smr.name.StartsWith("Hair_") || smr.name.Contains("AetherStrand")) continue;
                var mesh = smr.sharedMesh;
                int hi = System.Array.IndexOf(smr.bones, head);
                if (hi < 0 || hi >= mesh.bindposes.Length) continue;
                Matrix4x4 bp = mesh.bindposes[hi];
                var weights = mesh.GetAllBoneWeights();
                var perVertex = mesh.GetBonesPerVertex();
                var verts = mesh.vertices; var norms = mesh.normals;
                var headW = new float[verts.Length];
                int wi = 0;
                for (int i = 0; i < verts.Length; i++)
                {
                    for (int k = 0; k < perVertex[i]; k++) if (weights[wi + k].boneIndex == hi) headW[i] += weights[wi + k].weight;
                    wi += perVertex[i];
                }
                var remap = new Dictionary<int, int>();
                int[] src = mesh.triangles;
                for (int t = 0; t < src.Length; t += 3)
                {
                    int a = src[t], b = src[t + 1], c = src[t + 2];
                    if (headW[a] <= 0.5f || headW[b] <= 0.5f || headW[c] <= 0.5f) continue;
                    if (!Reaches(paint, fit, bp.MultiplyPoint3x4(verts[a])) && !Reaches(paint, fit, bp.MultiplyPoint3x4(verts[b])) && !Reaches(paint, fit, bp.MultiplyPoint3x4(verts[c]))) continue;
                    foreach (int v in new[] { a, b, c })
                    {
                        if (!remap.TryGetValue(v, out int o))
                        {
                            Vector3 p = bp.MultiplyPoint3x4(verts[v]);
                            Vector3 n = norms.Length == verts.Length ? bp.MultiplyVector(norms[v]).normalized : Vector3.up;
                            o = pos.Count; remap[v] = o;
                            pos.Add(p + n * lift); nrm.Add(n); web.Add(ToWeb(fit, p));
                        }
                        tris.Add(o);
                    }
                }
            }
            if (pos.Count == 0) return null;
            var m = new Mesh { name = "AetherStrand_ScalpPaint" };
            if (pos.Count > 65000) m.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            m.SetVertices(pos); m.SetNormals(nrm); m.SetUVs(1, web); m.SetTriangles(tris, 0);
            m.RecalculateBounds();
            return m;
        }

        /// <summary>Web head-pivot-local position (X not mirrored) of a head-bone-local point.</summary>
        public static Vector3 ToWeb(AetherStrandHeadFit.Fit fit, Vector3 u)
        {
            Vector3 w = new Vector3((u.x - fit.offset.x) / fit.scale.x, (u.y - fit.offset.y) / fit.scale.y, (u.z - fit.offset.z) / fit.scale.z);
            w.x = -w.x;
            return w;
        }

        static bool Reaches(ScalpPaintData paint, AetherStrandHeadFit.Fit fit, Vector3 u)
        {
            Vector3 w = ToWeb(fit, u);
            // generous pad: a triangle whose corners all sit past the feather can still hold the cut line between them
            return paint.EvalWebPadded(w.x, w.y, w.z, 0.08) > 0.0;
        }

        /// <summary>Material for the paint: curves texture + colour halfway between the hair's root and base colours (as the web viewport).</summary>
        public static Material CreateMaterial(ScalpPaintData paint, Material hairMaterial, string path)
        {
            Shader sh = Shader.Find("AetherStrand/ScalpPaint");
            if (sh == null) { Debug.LogError("[AetherStrand] Shader AetherStrand/ScalpPaint not found."); return null; }
            AssetDatabase.DeleteAsset(path);
            var mat = new Material(sh) { name = Path.GetFileNameWithoutExtension(path) };
            AssetDatabase.CreateAsset(mat, path);
            Texture2D tex = CurvesTexture(paint);
            tex.name = mat.name + "_curves";
            AssetDatabase.AddObjectToAsset(tex, mat);
            mat.SetTexture("_Curves", tex);
            mat.SetFloat("_Feather", (float)paint.feather);
            mat.SetFloat("_Density", (float)paint.density);
            mat.SetFloat("_Grain", (float)paint.grain);
            mat.SetFloat("_Irregularity", (float)paint.irregularity);
            mat.SetColor("_Color", PaintColor(paint, hairMaterial));
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>
        /// Paint colour: the paint's own override (scalpPaint.color, set by the style or by hand) or the hair's own colour,
        /// 5% root, 40% base, 55% tip averaged in linear space, times 2.0, plus the primary highlight colour times 0.8 times its
        /// intensity, to stand in for the sheen the hair shader adds
        /// (so painted sides match the lit locks instead of reading as bare scalp). Mirrors scalpPaintColor / PAINT_MIX /
        /// PAINT_SHEEN in src/engine/scalpPaint.ts. Change the material's _Color afterwards to tint the hairline by hand.
        /// </summary>
        public static Color PaintColor(ScalpPaintData paint, Material hairMaterial)
        {
            Color c;
            if (paint != null && !string.IsNullOrEmpty(paint.color) && ColorUtility.TryParseHtmlString(paint.color, out c)) { c.a = 1f; return c; }
            Color root = hairMaterial != null && hairMaterial.HasProperty("_RootColor") ? hairMaterial.GetColor("_RootColor") : new Color(0.165f, 0.118f, 0.094f);
            Color mid = hairMaterial != null && hairMaterial.HasProperty("_BaseColor") ? hairMaterial.GetColor("_BaseColor") : root;
            Color tip = hairMaterial != null && hairMaterial.HasProperty("_TipColor") ? hairMaterial.GetColor("_TipColor") : mid;
            Color lin = (root.linear * 0.05f + mid.linear * 0.4f + tip.linear * 0.55f) * 2.0f;
            // plus the primary highlight (PAINT_SPEC 0.8): on dark hair the lit locks are mostly highlight
            if (hairMaterial != null && hairMaterial.HasProperty("_PrimarySpecColor") && hairMaterial.HasProperty("_PrimaryIntensity"))
                lin += hairMaterial.GetColor("_PrimarySpecColor").linear * (0.8f * hairMaterial.GetFloat("_PrimaryIntensity"));
            c = lin.gamma; c.a = 1f;
            return c;
        }

        /// <summary>bins x 1 float texture (R full, G edge, B edgeDensity), one texel per bin, linear + repeat, matching the web overlay.</summary>
        public static Texture2D CurvesTexture(ScalpPaintData p)
        {
            int W = p.bins;
            var tex = new Texture2D(W, 1, TextureFormat.RGBAFloat, false, true) { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Bilinear };
            for (int i = 0; i < W; i++)
            {
                tex.SetPixel(i, 0, new Color((float)p.fullPhi[i], (float)p.edgePhi[i], (float)p.edgeDensity[i], 1f));
            }
            tex.Apply(false, false);
            return tex;
        }

        [MenuItem("Tools/AetherStrand/Rebuild Scalp Paint On Selected Character...")]
        private static void RebuildFromMenu()
        {
            GameObject target = Selection.activeGameObject;
            if (target == null) { EditorUtility.DisplayDialog("AetherStrand", "Select the character root in the scene first.", "OK"); return; }
            string geo = EditorUtility.OpenFilePanel("PresetGeometry.json (web export with scalpPaint)", "", "json");
            if (string.IsNullOrEmpty(geo)) return;
            Transform head = AetherStrandMeshGenerator.ResolveHeadBone(target);
            Material hairMat = null;
            if (head != null)
            {
                var live = head.GetComponentInChildren<AetherStrandWebHair>();
                if (live != null) hairMat = live.material;
            }
            if (hairMat == null)
                foreach (var r in target.GetComponentsInChildren<Renderer>(true))
                    if (r.sharedMaterial != null && r.sharedMaterial.HasProperty("_RootColor") && r.name != ObjectName) { hairMat = r.sharedMaterial; break; }
            string folder = "Assets/AetherStrandHair";
            if (!AssetDatabase.IsValidFolder(folder)) AssetDatabase.CreateFolder("Assets", "AetherStrandHair");
            Build(target, geo, hairMat, folder, Path.GetFileNameWithoutExtension(geo));
        }
    }
}
#endif
