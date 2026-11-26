using System;
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
        Vector3[] seat; // per-vertex head-local offset that fits the mass to the character's skull (ConformToSkin)

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
        /// Fit the mass to the character's real skull, exactly as the web generator does when a character head is loaded
        /// (characterHead.ts buildHeadConformMap + conformPoint, applied through hairMass's conform hook). The web builds the
        /// mass over its ellipsoid scalp; a character's skull bulges past it in places (Tobin: up to 9% at the forehead, 2-7%
        /// over the upper sides) and is smaller elsewhere, so without this the mass sinks into the skin or floats off it.
        /// skinHeadLocal: the character's head-weighted skin vertices in head-bone-local space (AetherStrandWebImport).
        /// Call once after an Update at the rest pose; the offsets then ride along in every Update.
        /// </summary>
        public void ConformToSkin(Vector3[] skinHeadLocal)
        {
            seat = null;
            if (!useFit || skinHeadLocal == null || skinHeadLocal.Length == 0) return;
            var pts = new float[skinHeadLocal.Length * 3];
            for (int i = 0; i < skinHeadLocal.Length; i++) { Vector3 w = ToWeb(skinHeadLocal[i]); pts[i * 3] = w.x; pts[i * 3 + 1] = w.y; pts[i * 3 + 2] = w.z; }
            float[] map = AetherStrandHeadConform.Build(pts);
            int V = mass.VertexCount; seat = new Vector3[V];
            int moved = 0; double outMax = 0, inMax = 0;
            for (int i = 0; i < V; i++)
            {
                Vector3 w = ToWeb(verts[i]); // the mesh as last written, at the snapped rest pose (call after Update)
                AetherStrandHeadConform.Offset(map, w.x, w.y, w.z, out double dx, out double dy, out double dz);
                seat[i] = new Vector3((float)(-dx * fitScale.x), (float)(dy * fitScale.y), (float)(dz * fitScale.z));
                double len = Math.Sqrt(dx * dx + dy * dy + dz * dz) * 1000.0;
                Vector3 rad = w - new Vector3(0f, 0.425f, -0.01f);
                bool outward = dx * rad.x + dy * rad.y + dz * rad.z >= 0;
                if (len > 0.2) moved++;
                if (outward) outMax = Math.Max(outMax, len); else inMax = Math.Max(inMax, len);
            }
            SeatReport = "mass conformed to skull: " + moved + "/" + V + " vertices moved over 0.2 web-mm; largest push out "
                + outMax.ToString("F1") + " web-mm, in " + inMax.ToString("F1") + " web-mm";
        }

        // head-bone-local -> rest-head-local web space: the inverse of the per-axis fit in Update (X mirrored)
        Vector3 ToWeb(Vector3 v) { return new Vector3(-(v.x - fitOffset.x) / fitScale.x, (v.y - fitOffset.y) / fitScale.y, (v.z - fitOffset.z) / fitScale.z); }



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
