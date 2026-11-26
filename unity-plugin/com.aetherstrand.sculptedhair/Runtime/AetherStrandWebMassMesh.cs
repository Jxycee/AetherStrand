using UnityEngine;
using UnityEngine.Rendering;

namespace AetherStrand
{
    /// <summary>
    /// Unity mesh for the hybrid inner mass (AetherStrandWebMass), written the way AetherStrandWebMesh writes the locks:
    /// same output spaces (hair space, or head-bone-local through the per-axis head fit), same vertex channels, so the hair
    /// material shades it like the web lock material shades hairMass.ts's geometry:
    ///   uv = strand coordinates, uv2 = (scalp root, gradient coordinate + 1), colour = (seed low, layer AO, seed high,
    ///   card mask 0 = solid), tangent = comb direction.
    /// </summary>
    public sealed class AetherStrandWebMassMesh
    {
        public readonly AetherStrandWebMass mass;
        public readonly Mesh mesh;
        readonly Vector3[] verts, norms;
        readonly Vector4[] tans;
        public bool useFit;
        public Vector3 fitScale = Vector3.one;
        public Vector3 fitOffset = Vector3.zero;
        public string SeatReport = "mass not seated";
        Vector3[] seat; // per-vertex head-local offset that seats the mass on the character's own skin (SeatOnSkin)

        public AetherStrandWebMassMesh(AetherStrandWebMass mass)
        {
            this.mass = mass;
            int V = mass.VertexCount;
            verts = new Vector3[V]; norms = new Vector3[V]; tans = new Vector4[V];
            var uv = new Vector2[V]; var uv2 = new Vector2[V]; var col = new Color[V];
            for (int i = 0; i < V; i++)
            {
                uv[i] = new Vector2(mass.Uv[i * 2], mass.Uv[i * 2 + 1]);
                uv2[i] = new Vector2(mass.ScalpRoot[i], 1f + mass.GradT[i]);
                float sd = Mathf.Clamp01(mass.Seed[i]) * 255f, sh = Mathf.Floor(sd);
                col[i] = new Color(sd - sh, mass.LayerAO[i], sh / 255f, 0f);
            }
            // web winding, then X is mirrored on output: flip each triangle so the faces keep their side (as the lock mesh does
            // by building its index order for the mirrored space)
            var tris = new int[mass.Indices.Length];
            for (int t = 0; t < tris.Length; t += 3) { tris[t] = mass.Indices[t]; tris[t + 1] = mass.Indices[t + 2]; tris[t + 2] = mass.Indices[t + 1]; }
            mesh = new Mesh { name = "AetherStrandWebMass", indexFormat = IndexFormat.UInt32 };
            mesh.MarkDynamic();
            mesh.vertices = verts;
            mesh.uv = uv; mesh.uv2 = uv2; mesh.colors = col;
            mesh.SetTriangles(tris, 0, false);
            mesh.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(2, 2, 2));
        }

        /// <summary>
        /// Seat the mass on the character's own skin. The web builds it 1 mm or more over the web head (or over the head the
        /// generator conformed it to), and the per-axis fit only scales that head; where the character's skull bulges past
        /// the scaled web head (above the ears on Tobin) the mass sank into the skin, and the scalp paint showed through as a
        /// tan band with a hard edge where the mass came back out (proof rerun 2, ear isolation). Each vertex is moved along
        /// the ray from the head centre so it stands its own rest height over the skin the ray meets, as the web's conform does.
        /// skinHeadLocal: the character's head-weighted skin vertices in head-bone-local space (AetherStrandWebImport).
        /// Call once after an Update at the rest pose; the offsets then ride along in every Update.
        /// </summary>
        public void SeatOnSkin(Vector3[] skinHeadLocal, Vector3 headCenterLocal, float minGapLocal)
        {
            seat = null;
            if (!useFit || skinHeadLocal == null || skinHeadLocal.Length == 0) return;
            const int AZ = 120, PH = 60; // 3 degree cells
            var cellR = new System.Collections.Generic.List<float>[AZ * PH];
            float fs = (fitScale.x + fitScale.y + fitScale.z) / 3f;
            foreach (var p in skinHeadLocal)
            {
                Vector3 d = p - headCenterLocal; float r = d.magnitude;
                // only the skull's shell: points far inside (mouth, eye sockets) or far outside (shoulders) are not scalp
                if (r < 0.15f * fs || r > 0.5f * fs) continue;
                int k = Cell(d / r, AZ, PH);
                (cellR[k] ?? (cellR[k] = new System.Collections.Generic.List<float>())).Add(r);
            }
            // per cell, the median radius: an ear or a strand of skin standing off the skull is a minority in its cell
            var med = new float[AZ * PH];
            for (int k = 0; k < med.Length; k++) { var l = cellR[k]; if (l == null) { med[k] = -1f; continue; } l.Sort(); med[k] = l[l.Count / 2]; }
            int V = mass.VertexCount;
            var off = new float[V]; var dir = new Vector3[V]; var has = new bool[V];
            float maxMove = 0.015f * fs; // a correction past 1.5 cm means the lookup found something that is not the scalp
            for (int i = 0; i < V; i++)
            {
                Vector3 d = verts[i] - headCenterLocal; // the mesh as last written, at the snapped rest pose (call after Update)
                float r = d.magnitude; if (r < 1e-6f) continue;
                dir[i] = d / r;
                int ci = Cell(dir[i], AZ, PH), ca = ci % AZ, cp = ci / AZ;
                float sum = 0f; int n = 0;
                for (int dp = -1; dp <= 1; dp++) for (int da = -1; da <= 1; da++)
                {
                    int pp = cp + dp; if (pp < 0 || pp >= PH) continue;
                    float m = med[pp * AZ + ((ca + da + AZ) % AZ)]; if (m > 0f) { sum += m; n++; }
                }
                if (n == 0) continue;
                float target = sum / n + Mathf.Max(minGapLocal, mass.RestHeight[i] * fs);
                off[i] = Mathf.Clamp(target - r, -maxMove, maxMove); has[i] = true;
            }
            var raw = (float[])off.Clone();
            // smooth the correction over the mass so 3 degree cells leave no steps (neighbours from the triangles)
            var nb = new System.Collections.Generic.List<int>[V];
            for (int t = 0; t < mass.Indices.Length; t += 3)
                for (int e = 0; e < 3; e++)
                {
                    int a = mass.Indices[t + e], b = mass.Indices[t + (e + 1) % 3];
                    (nb[a] ?? (nb[a] = new System.Collections.Generic.List<int>())).Add(b);
                    (nb[b] ?? (nb[b] = new System.Collections.Generic.List<int>())).Add(a);
                }
            for (int pass = 0; pass < 4; pass++)
            {
                var nx = (float[])off.Clone();
                for (int i = 0; i < V; i++)
                {
                    if (!has[i] || nb[i] == null) continue;
                    float s2 = off[i]; int c = 1;
                    foreach (int q in nb[i]) if (has[q]) { s2 += off[q]; c++; }
                    nx[i] = s2 / c;
                }
                off = nx;
            }
            // smoothing must not pull a vertex back under the skin: keep it within 0.5 mm of its own correction
            for (int i = 0; i < V; i++) if (has[i]) off[i] = Mathf.Max(off[i], raw[i] - 0.0005f * fs);
            seat = new Vector3[V];
            int moved = 0, nHas = 0; float outMax = 0f, inMax = 0f;
            for (int i = 0; i < V; i++)
            {
                if (!has[i]) continue;
                nHas++; seat[i] = dir[i] * off[i];
                if (Mathf.Abs(off[i]) > 0.0002f * fs) moved++;
                outMax = Mathf.Max(outMax, off[i]); inMax = Mathf.Max(inMax, -off[i]);
            }
            SeatReport = "mass seated on skin: " + nHas + "/" + V + " vertices found skin, " + moved + " moved; largest push out "
                + (outMax / fs * 1000f).ToString("F1") + " web-mm, in " + (inMax / fs * 1000f).ToString("F1") + " web-mm";
        }

        static int Cell(Vector3 n, int AZ, int PH)
        {
            float az = Mathf.Atan2(n.x, n.z), ph = Mathf.Acos(Mathf.Clamp(n.y, -1f, 1f));
            int a = Mathf.Clamp((int)((az + Mathf.PI) / (2f * Mathf.PI) * AZ), 0, AZ - 1);
            int p = Mathf.Clamp((int)(ph / Mathf.PI * PH), 0, PH - 1);
            return p * AZ + a;
        }

        /// <summary>Follow the solver and upload. Same arguments as AetherStrandWebMesh.Update.</summary>
        public void Update(AetherStrandWebSolver solver, double hpx, double hpy, double hpz, double hqx, double hqy, double hqz, double hqw, float unitScale)
        {
            mass.Update(solver.PosX, solver.PosY, solver.PosZ, hpx, hpy, hpz, hqx, hqy, hqz, hqw);
            double cqx = -hqx, cqy = -hqy, cqz = -hqz, cqw = hqw;
            double fsx = fitScale.x, fsy = fitScale.y, fsz = fitScale.z;
            float[] P = mass.Positions, N = mass.Normals, T = mass.Tangents;
            for (int i = 0; i < mass.VertexCount; i++)
            {
                int o = i * 3;
                if (!useFit)
                {
                    verts[i] = new Vector3(-P[o] * unitScale, P[o + 1] * unitScale, P[o + 2] * unitScale);
                    norms[i] = new Vector3(-N[o], N[o + 1], N[o + 2]);
                    tans[i] = new Vector4(-T[o], T[o + 1], T[o + 2], 1f);
                    continue;
                }
                // world -> rest-head-local (web) by the conjugate head rotation, then the per-axis fit (AetherStrandWebMesh.MapPoint)
                Rot(P[o] - hpx, P[o + 1] - hpy, P[o + 2] - hpz, cqx, cqy, cqz, cqw, out double lx, out double ly, out double lz);
                verts[i] = new Vector3((float)(-lx * fsx + fitOffset.x), (float)(ly * fsy + fitOffset.y), (float)(lz * fsz + fitOffset.z));
                Rot(N[o], N[o + 1], N[o + 2], cqx, cqy, cqz, cqw, out lx, out ly, out lz);
                norms[i] = Unit(-lx / fsx, ly / fsy, lz / fsz);
                Rot(T[o], T[o + 1], T[o + 2], cqx, cqy, cqz, cqw, out lx, out ly, out lz);
                Vector3 tv = Unit(-lx * fsx, ly * fsy, lz * fsz);
                tans[i] = new Vector4(tv.x, tv.y, tv.z, 1f);
                if (seat != null) verts[i] += seat[i];
            }
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetTangents(tans);
            mesh.RecalculateBounds();
        }

        static void Rot(double x, double y, double z, double qx, double qy, double qz, double qw, out double ox, out double oy, out double oz)
        {
            double tx2 = 2 * (qy * z - qz * y), ty2 = 2 * (qz * x - qx * z), tz2 = 2 * (qx * y - qy * x);
            ox = x + qw * tx2 + (qy * tz2 - qz * ty2); oy = y + qw * ty2 + (qz * tx2 - qx * tz2); oz = z + qw * tz2 + (qx * ty2 - qy * tx2);
        }

        static Vector3 Unit(double x, double y, double z)
        {
            double l = System.Math.Sqrt(x * x + y * y + z * z); if (l < 1e-12) l = 1;
            return new Vector3((float)(x / l), (float)(y / l), (float)(z / l));
        }
    }
}
