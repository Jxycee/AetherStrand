using System;
using System.Collections.Generic;

namespace AetherStrand
{
    /// <summary>
    /// Hybrid inner hair mass (web src/engine/hairMass.ts), driven by the web solver. The web generator builds the mass and
    /// writes it to PresetGeometry.json as the "hybridMass" block (tools/unity-parity/web_geometry.ts exportMass); this class
    /// only runs the deform (deformHairMass + computeMassNormals), in WEB space like AetherStrandWebSolver. No UnityEngine
    /// types, so the parity test (tools/unity-parity/mass_test) compiles it outside Unity. AetherStrandWebMassMesh renders it.
    ///
    /// Deform, per frame: each vertex takes the weighted offset of its 3 bound lock nodes from their rest; the offsets are
    /// averaged into coarse blocks, smoothed on the blocks, interpolated back, limited to followShare of the vertex's height
    /// over the scalp, smoothed twice on the vertices, then turned with the head. Arithmetic in double, stored in float,
    /// as the web does (JS numbers into Float32Array).
    /// </summary>
    public sealed class AetherStrandWebMass
    {
        public int VertexCount, BindCount, NodesPerLock, BlockCount, FollowSmooth;
        public double FollowShare;
        // rest data, web head-pivot space
        public float[] Rest, RestHeadNormals, RestTangents, Uv, Seed, LayerAO, ScalpRoot, GradT, BindW, RestHeight, VInterpW;
        public int[] Indices, BindNode, AdjStart, AdjIdx, VBlock, VInterpB, BAdjStart, BAdjIdx;
        /// <summary>Rest node positions the binding was made against (head-pivot space, 3 per node, lock-major).</summary>
        public float[] RestNodes;
        // output, web world space (head pose applied)
        public float[] Positions, Normals, HeadNormals, Tangents;
        float[] offA, offB, bA, bB, bN, nodes;

        /// <summary>Reads the hybridMass block of a parsed PresetGeometry.json; null when the file has none.</summary>
        public static AetherStrandWebMass Load(Dictionary<string, object> root)
        {
            if (!AetherStrandJson.Has(root, "hybridMass")) return null;
            var d = (Dictionary<string, object>)root["hybridMass"];
            var m = new AetherStrandWebMass
            {
                VertexCount = (int)AetherStrandJson.D(d, "vertexCount", 0),
                BindCount = (int)AetherStrandJson.D(d, "bindCount", 3),
                NodesPerLock = (int)AetherStrandJson.D(d, "nodesPerLock", AetherStrandWebSolver.N),
                BlockCount = (int)AetherStrandJson.D(d, "blockCount", 0),
                FollowSmooth = (int)AetherStrandJson.D(d, "followSmooth", 8),
                FollowShare = AetherStrandJson.D(d, "followShare", 0.5),
                Rest = Web3(d["rest"]), RestHeadNormals = Web3(d["restHeadNormal"]), RestTangents = Web3(d["restTangent"]),
                Uv = F(d["uv"]), Seed = F(d["seed"]), LayerAO = F(d["layerAO"]), ScalpRoot = F(d["scalpRoot"]), GradT = F(d["gradT"]),
                Indices = I(d["indices"]), BindNode = I(d["bindNode"]), BindW = F(d["bindW"]), RestHeight = F(d["restHeight"]),
                AdjStart = I(d["adjStart"]), AdjIdx = I(d["adjIdx"]), VBlock = I(d["vBlock"]), VInterpB = I(d["vInterpB"]), VInterpW = F(d["vInterpW"]),
                BAdjStart = I(d["bAdjStart"]), BAdjIdx = I(d["bAdjIdx"]),
            };
            int V = m.VertexCount;
            if (V <= 0 || m.Rest.Length != V * 3 || m.BindNode.Length != V * m.BindCount || m.AdjStart.Length != V + 1 || m.BAdjStart.Length != m.BlockCount + 1)
                throw new FormatException("[AetherStrand] hybridMass block is inconsistent (vertexCount " + V + ").");
            m.Positions = new float[V * 3]; m.Normals = new float[V * 3];
            m.HeadNormals = (float[])m.RestHeadNormals.Clone(); m.Tangents = (float[])m.RestTangents.Clone();
            m.offA = new float[V * 3]; m.offB = new float[V * 3];
            m.bA = new float[m.BlockCount * 3]; m.bB = new float[m.BlockCount * 3]; m.bN = new float[m.BlockCount];
            return m;
        }

        /// <summary>Takes the rest nodes from the solver's locks (the same lock order the binding uses).</summary>
        public void SetRestNodes(AetherStrandWebSolver.LockData[] locks)
        {
            int P = NodesPerLock;
            RestNodes = new float[locks.Length * P * 3];
            nodes = new float[RestNodes.Length];
            for (int s = 0; s < locks.Length; s++)
                for (int k = 0; k < P; k++)
                    for (int c = 0; c < 3; c++) RestNodes[(s * P + k) * 3 + c] = (float)locks[s].rest[k * 3 + c];
        }

        /// <summary>
        /// Follows the solver: node positions from its particles (web world space) into the head frame, then the deform and
        /// the turn back into world space with the head pose (hp, hq), as hairPhysics.ts updateMass does.
        /// </summary>
        public void Update(double[] px, double[] py, double[] pz, double hpx, double hpy, double hpz, double hqx, double hqy, double hqz, double hqw)
        {
            // conjugate of the head quaternion (three applyQuaternion with the inverse)
            double cx = -hqx, cy = -hqy, cz = -hqz, cw = hqw;
            int n = nodes.Length / 3;
            for (int i = 0; i < n; i++)
            {
                double ax = px[i] - hpx, ay = py[i] - hpy, az = pz[i] - hpz;
                double ix = cw * ax + cy * az - cz * ay, iy = cw * ay + cz * ax - cx * az, iz = cw * az + cx * ay - cy * ax, iw = -cx * ax - cy * ay - cz * az;
                nodes[i * 3] = (float)(ix * cw + iw * -cx + iy * -cz - iz * -cy);
                nodes[i * 3 + 1] = (float)(iy * cw + iw * -cy + iz * -cx - ix * -cz);
                nodes[i * 3 + 2] = (float)(iz * cw + iw * -cz + ix * -cy - iy * -cx);
            }
            Deform(nodes, hpx, hpy, hpz, hqx, hqy, hqz, hqw);
        }

        /// <summary>deformHairMass: nodesLocal in head-pivot space (3 per node, same layout as RestNodes).</summary>
        public void Deform(float[] nodesLocal, double hpx, double hpy, double hpz, double hqx, double hqy, double hqz, double hqw)
        {
            int K = BindCount, V = VertexCount, nb = BlockCount;
            float[] R = RestNodes, A = offA, B = offB;
            for (int i = 0; i < V; i++)
            {
                double dx = 0, dy = 0, dz = 0;
                for (int j = 0; j < K; j++)
                {
                    int g = BindNode[i * K + j];
                    if (g < 0) continue;
                    double w = BindW[i * K + j];
                    dx += w * ((double)nodesLocal[g * 3] - R[g * 3]); dy += w * ((double)nodesLocal[g * 3 + 1] - R[g * 3 + 1]); dz += w * ((double)nodesLocal[g * 3 + 2] - R[g * 3 + 2]);
                }
                A[i * 3] = (float)dx; A[i * 3 + 1] = (float)dy; A[i * 3 + 2] = (float)dz;
            }
            float[] CA = bA, CB = bB;
            Array.Clear(CA, 0, CA.Length); Array.Clear(bN, 0, bN.Length);
            for (int i = 0; i < V; i++) { int b = VBlock[i]; CA[b * 3] = (float)((double)CA[b * 3] + A[i * 3]); CA[b * 3 + 1] = (float)((double)CA[b * 3 + 1] + A[i * 3 + 1]); CA[b * 3 + 2] = (float)((double)CA[b * 3 + 2] + A[i * 3 + 2]); bN[b]++; }
            for (int b = 0; b < nb; b++) if (bN[b] != 0) { CA[b * 3] = (float)((double)CA[b * 3] / bN[b]); CA[b * 3 + 1] = (float)((double)CA[b * 3 + 1] / bN[b]); CA[b * 3 + 2] = (float)((double)CA[b * 3 + 2] / bN[b]); }
            for (int pass = 0; pass < FollowSmooth; pass++)
            {
                for (int b = 0; b < nb; b++)
                {
                    int s0 = BAdjStart[b], s1 = BAdjStart[b + 1], cnt = s1 - s0;
                    if (bN[b] == 0 || cnt == 0) { CB[b * 3] = CA[b * 3]; CB[b * 3 + 1] = CA[b * 3 + 1]; CB[b * 3 + 2] = CA[b * 3 + 2]; continue; }
                    double x = 0, y = 0, z = 0;
                    for (int j = s0; j < s1; j++) { int q = BAdjIdx[j] * 3; x += CA[q]; y += CA[q + 1]; z += CA[q + 2]; }
                    CB[b * 3] = (float)(0.5 * CA[b * 3] + 0.5 * x / cnt); CB[b * 3 + 1] = (float)(0.5 * CA[b * 3 + 1] + 0.5 * y / cnt); CB[b * 3 + 2] = (float)(0.5 * CA[b * 3 + 2] + 0.5 * z / cnt);
                }
                var t = CA; CA = CB; CB = t;
            }
            for (int i = 0; i < V; i++)
            {
                double x = 0, y = 0, z = 0;
                for (int j = 0; j < 4; j++) { double w = VInterpW[i * 4 + j]; if (w == 0) continue; int q = VInterpB[i * 4 + j] * 3; x += w * CA[q]; y += w * CA[q + 1]; z += w * CA[q + 2]; }
                A[i * 3] = (float)x; A[i * 3 + 1] = (float)y; A[i * 3 + 2] = (float)z;
            }
            for (int i = 0; i < V; i++)
            {
                double lim = FollowShare * RestHeight[i];
                double l = Math.Sqrt((double)A[i * 3] * A[i * 3] + (double)A[i * 3 + 1] * A[i * 3 + 1] + (double)A[i * 3 + 2] * A[i * 3 + 2]);
                if (l > lim) { double f = lim / l; A[i * 3] = (float)(A[i * 3] * f); A[i * 3 + 1] = (float)(A[i * 3 + 1] * f); A[i * 3 + 2] = (float)(A[i * 3 + 2] * f); }
            }
            for (int pass = 0; pass < 2; pass++)
            {
                for (int i = 0; i < V; i++)
                {
                    int s0 = AdjStart[i], s1 = AdjStart[i + 1], cnt = s1 - s0;
                    if (cnt == 0) { B[i * 3] = A[i * 3]; B[i * 3 + 1] = A[i * 3 + 1]; B[i * 3 + 2] = A[i * 3 + 2]; continue; }
                    double x = 0, y = 0, z = 0;
                    for (int j = s0; j < s1; j++) { int q = AdjIdx[j] * 3; x += A[q]; y += A[q + 1]; z += A[q + 2]; }
                    B[i * 3] = (float)(0.5 * A[i * 3] + 0.5 * x / cnt); B[i * 3 + 1] = (float)(0.5 * A[i * 3 + 1] + 0.5 * y / cnt); B[i * 3 + 2] = (float)(0.5 * A[i * 3 + 2] + 0.5 * z / cnt);
                }
                var t = A; A = B; B = t;
            }
            // rotation matrix (three makeRotationFromQuaternion), then turn and move
            double x2 = hqx + hqx, y2 = hqy + hqy, z2 = hqz + hqz;
            double xx = hqx * x2, xy = hqx * y2, xz = hqx * z2, yy = hqy * y2, yz = hqy * z2, zz = hqz * z2, wx = hqw * x2, wy = hqw * y2, wz = hqw * z2;
            double m00 = 1 - (yy + zz), m01 = xy - wz, m02 = xz + wy, m10 = xy + wz, m11 = 1 - (xx + zz), m12 = yz - wx, m20 = xz - wy, m21 = yz + wx, m22 = 1 - (xx + yy);
            float[] P = Positions, S = Rest;
            for (int i = 0; i < V * 3; i += 3)
            {
                double x = (float)((double)S[i] + A[i]), y = (float)((double)S[i + 1] + A[i + 1]), z = (float)((double)S[i + 2] + A[i + 2]);
                P[i] = (float)(m00 * x + m01 * y + m02 * z + hpx); P[i + 1] = (float)(m10 * x + m11 * y + m12 * z + hpy); P[i + 2] = (float)(m20 * x + m21 * y + m22 * z + hpz);
                double hx = RestHeadNormals[i], hy = RestHeadNormals[i + 1], hz = RestHeadNormals[i + 2];
                HeadNormals[i] = (float)(m00 * hx + m01 * hy + m02 * hz); HeadNormals[i + 1] = (float)(m10 * hx + m11 * hy + m12 * hz); HeadNormals[i + 2] = (float)(m20 * hx + m21 * hy + m22 * hz);
                double tx = RestTangents[i], ty = RestTangents[i + 1], tz = RestTangents[i + 2];
                Tangents[i] = (float)(m00 * tx + m01 * ty + m02 * tz); Tangents[i + 1] = (float)(m10 * tx + m11 * ty + m12 * tz); Tangents[i + 2] = (float)(m20 * tx + m21 * ty + m22 * tz);
            }
            ComputeNormals();
        }

        /// <summary>computeMassNormals: area-weighted face normals, flipped outward, then half toward the head normal.</summary>
        void ComputeNormals()
        {
            float[] P = Positions, N = Normals, H = HeadNormals;
            Array.Clear(N, 0, N.Length);
            for (int t = 0; t < Indices.Length; t += 3)
            {
                int a = Indices[t] * 3, b = Indices[t + 1] * 3, c = Indices[t + 2] * 3;
                double ux = (double)P[b] - P[a], uy = (double)P[b + 1] - P[a + 1], uz = (double)P[b + 2] - P[a + 2];
                double vx = (double)P[c] - P[a], vy = (double)P[c + 1] - P[a + 1], vz = (double)P[c + 2] - P[a + 2];
                double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                N[a] = (float)(N[a] + nx); N[a + 1] = (float)(N[a + 1] + ny); N[a + 2] = (float)(N[a + 2] + nz);
                N[b] = (float)(N[b] + nx); N[b + 1] = (float)(N[b + 1] + ny); N[b + 2] = (float)(N[b + 2] + nz);
                N[c] = (float)(N[c] + nx); N[c + 1] = (float)(N[c + 1] + ny); N[c + 2] = (float)(N[c + 2] + nz);
            }
            for (int i = 0; i < VertexCount * 3; i += 3)
            {
                double x = N[i], y = N[i + 1], z = N[i + 2];
                if (x * H[i] + y * H[i + 1] + z * H[i + 2] < 0) { x = -x; y = -y; z = -z; }
                double l = Math.Sqrt(x * x + y * y + z * z); if (l == 0) l = 1;
                x = x / l + H[i]; y = y / l + H[i + 1]; z = z / l + H[i + 2];
                l = Math.Sqrt(x * x + y * y + z * z); if (l == 0) l = 1;
                N[i] = (float)(x / l); N[i + 1] = (float)(y / l); N[i + 2] = (float)(z / l);
            }
        }

        static float[] F(object o) { double[] a = AetherStrandJson.Arr(o); var r = new float[a.Length]; for (int i = 0; i < a.Length; i++) r[i] = (float)a[i]; return r; }
        static int[] I(object o) { double[] a = AetherStrandJson.Arr(o); var r = new int[a.Length]; for (int i = 0; i < a.Length; i++) r[i] = (int)a[i]; return r; }
        /// <summary>File axes (Blender: x, -z, y) back to web (x, y, z).</summary>
        static float[] Web3(object o)
        {
            double[] a = AetherStrandJson.Arr(o); var r = new float[a.Length];
            for (int i = 0; i + 2 < a.Length; i += 3) { r[i] = (float)a[i]; r[i + 1] = (float)a[i + 2]; r[i + 2] = (float)-a[i + 1]; }
            return r;
        }
    }
}
