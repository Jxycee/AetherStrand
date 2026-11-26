using UnityEngine;
using UnityEngine.Rendering;

namespace AetherStrand
{
    /// <summary>
    /// Web hair mesh (hairPhysics.ts buildVolumetricBuffers + updateVolumetricBuffers) driven by live solver particles.
    /// Same ring/frame math as AetherStrandMeshGenerator.BuildVolumetricMesh (frames are built in WEB space so cross
    /// products match, then X is mirrored to Unity), but reading live particle positions instead of rest points.
    /// Vertex order, UVs, uv2, colours, tangent.w and triangle winding are identical to the static mesh.
    /// Output vertices are in "hair space": (-webX, webY, webZ) * unitScale, i.e. Unity world axes relative to the hair origin.
    /// </summary>
    public sealed class AetherStrandWebMesh
    {
        public const int Rings = AetherStrandWebSolver.N - 1; // 11
        public const int RingVerts = 7;
        public const int VertsPerLock = Rings * RingVerts + 1; // legacy (smooth = 1); smoothed locks use vertBase / ringCount
        readonly int[] ringCount, vertBase, lockSm;

        static readonly float[] PU = { 0.0f, 0.17f, 0.34f, 0.5f, 0.66f, 0.83f, 1.0f };
        static readonly double[] PX = { 0.0, 0.76, 1.0, 0.0, -1.0, -0.76, 0.0 };
        static readonly double[] PY = { 1.0, 0.42, -0.32, -0.45, -0.32, 0.42, 1.0 };
        static readonly double[] PNX = { 0.0, 0.64409, 0.94451, 0.0, -0.94451, -0.64409, 0.0 };
        static readonly double[] PNY = { 1.0, 0.76495, -0.32849, -1.0, -0.32849, 0.76495, 1.0 };

        readonly AetherStrandWebSolver.LockData[] locks;
        readonly AetherStrandWebSolver solver;
        public readonly Mesh mesh;
        readonly Vector3[] verts, norms;
        readonly Vector4[] tans;
        // per-ring tables (identical to the web's Float32Array tables)
        static readonly double[] RootSin = new double[AetherStrandWebSolver.N], TipTaper = new double[AetherStrandWebSolver.N],
            BaseTipTaper = new double[AetherStrandWebSolver.N], TipFactor = new double[AetherStrandWebSolver.N], ThickPow = new double[AetherStrandWebSolver.N];

        static AetherStrandWebMesh()
        {
            for (int k = 0; k < AetherStrandWebSolver.N; k++)
            {
                double t = k / 11.0;
                RootSin[k] = (float)System.Math.Sin(System.Math.Min(1.0, t * 4.2) * System.Math.PI * 0.5);
                TipTaper[k] = (float)System.Math.Max(0.06, t < 0.44 ? 1.0 - t * 0.14 : System.Math.Pow((1.0 - t) / 0.56, 0.94) * 0.938);
                BaseTipTaper[k] = (float)System.Math.Max(0.04, t < 0.42 ? 1.0 - t * 0.16 : System.Math.Pow((1.0 - t) / 0.58, 1.12) * 0.933);
                TipFactor[k] = (float)t;
                ThickPow[k] = (float)System.Math.Pow(System.Math.Max(0.04, 1.0 - t), 0.86);
            }
        }

        public AetherStrandWebMesh(AetherStrandWebSolver solver, AetherStrandWebSolver.LockData[] locks)
        {
            this.solver = solver; this.locks = locks;
            int L = locks.Length;
            ringCount = new int[L]; vertBase = new int[L + 1]; lockSm = new int[L];
            fRootWidth = new double[L]; fScalpRoot = new double[L]; fBaseWidth = new double[L]; fBaseThickness = new double[L]; fSurfaceShine = new double[L];
            fRoundness = new double[L]; fTipWidth = new double[L]; fTipStart = new double[L]; fRipple = new double[L]; fRippleFreq = new double[L];
            fRootNormal = new double[L * 3]; fShadeDir = new double[L * 3];
            fIsBaseShell = new byte[L]; fLockNormal = new byte[L]; fIsFadeCap = new byte[L]; fHasShade = new byte[L];
            int triCount = 0;
            for (int s = 0; s < L; s++)
            {
                int sm0 = System.Math.Max(1, System.Math.Min(4, locks[s].smooth));
                lockSm[s] = sm0; ringCount[s] = (AetherStrandWebSolver.N - 2) * sm0 + 1;
                vertBase[s + 1] = vertBase[s] + ringCount[s] * RingVerts + 1;
                triCount += (ringCount[s] - 2) * (RingVerts - 1) * 6 + (RingVerts - 1) * 3 + (RingVerts - 1) * 6;
            }
            int V = vertBase[L];
            verts = new Vector3[V]; norms = new Vector3[V]; tans = new Vector4[V];
            var uv = new Vector2[V]; var uv2 = new Vector2[V]; var col = new Color[V];
            var tris = new int[triCount];
            int ti = 0;
            for (int s = 0; s < L; s++)
            {
                var d = locks[s];
                int bv = vertBase[s];
                int rings = ringCount[s], sm1 = lockSm[s];
                float mask = d.isBaseShell ? 0f : d.isFadeCap ? (double.IsNaN(d.fadeStart) ? 0.25f : 0.16f + 0.28f * Mathf.Clamp01((float)d.fadeStart)) : d.strandCard ? 0.75f : 1f; // 0.75 = strand card (hybrid fine strands)
                // uv2.y: colour gradient coordinate + 1 when the lock shows only part of the gradient (web colorRange / aGradT), else 0
                bool hasCr = !double.IsNaN(d.colorFrom) && !double.IsNaN(d.colorTo);
                float cr0 = hasCr ? (float)d.colorFrom : 0f, cr1 = hasCr ? (float)d.colorTo : 1f;
                int vi = bv;
                for (int k = 0; k < rings; k++)
                {
                    float t = sm1 > 1 ? ((float)k / sm1) / (AetherStrandWebSolver.N - 1) : k / (float)(AetherStrandWebSolver.N - 1);
                    for (int r = 0; r < RingVerts; r++)
                    {
                        uv[vi] = new Vector2(PU[r], t);
                        uv2[vi] = new Vector2((float)d.scalpRoot, hasCr ? 1f + cr0 + (cr1 - cr0) * t : 0f);
                        float under = PY[r] < -0.1 ? 0.85f : 1.0f;
                        { float sd = Mathf.Clamp01((float)d.seed) * 255f, sh = Mathf.Floor(sd); col[vi] = new Color(sd - sh, (float)d.layerAO * under, sh / 255f, mask); }
                        vi++;
                    }
                }
                int tip = vi;
                uv[tip] = new Vector2(0.5f, 1f); uv2[tip] = new Vector2((float)d.scalpRoot, hasCr ? 1f + cr1 : 0f);
                { float sd = Mathf.Clamp01((float)d.seed) * 255f, sh = Mathf.Floor(sd); col[tip] = new Color(sd - sh, (float)d.layerAO, sh / 255f, mask); }
                for (int k = 0; k < rings - 1; k++)
                {
                    int r0 = bv + k * RingVerts, r1 = bv + (k + 1) * RingVerts;
                    for (int r = 0; r < RingVerts - 1; r++)
                    {
                        int a = r0 + r, b = r0 + r + 1, c = r1 + r, dd = r1 + r + 1;
                        tris[ti++] = a; tris[ti++] = c; tris[ti++] = b;
                        tris[ti++] = b; tris[ti++] = c; tris[ti++] = dd;
                    }
                }
                int last = bv + (rings - 1) * RingVerts;
                for (int r = 0; r < RingVerts - 1; r++) { tris[ti++] = last + r; tris[ti++] = tip; tris[ti++] = last + r + 1; }
            }
            mesh = new Mesh { name = "AetherStrandWebHair", indexFormat = IndexFormat.UInt32 };
            mesh.MarkDynamic();
            mesh.vertices = verts; // zeros, replaced by Update
            mesh.uv = uv; mesh.uv2 = uv2; mesh.colors = col;
            mesh.SetTriangles(tris, 0, false);
            mesh.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(2, 2, 2));
        }

        /// <summary>
        /// Rebuild all ring vertices from the solver's current particles (web updateVolumetricBuffers) and upload them.
        /// head* = web-space head pose of the last step (the web recomputes the head centre from it).
        /// </summary>
        /// <summary>
        /// Head-fit output mode (character rigs): vertices are written in HEAD-BONE-LOCAL space after mapping web space through
        /// the per-axis head fit (see Editor/AetherStrandHeadFit). The renderer must then be a child of the head bone with identity local pose.
        /// </summary>
        public bool useFit;
        public Vector3 fitScale = Vector3.one;
        public Vector3 fitOffset = Vector3.zero;

        // Per-lock data flattened into plain arrays for AetherStrandMeshKernel (refreshed every Update, so edits to the
        // LockData objects still take effect as before; a few microseconds for hundreds of locks).
        readonly double[] fRootWidth, fScalpRoot, fBaseWidth, fBaseThickness, fSurfaceShine, fRoundness, fTipWidth, fTipStart, fRipple, fRippleFreq, fRootNormal, fShadeDir;
        readonly byte[] fIsBaseShell, fLockNormal, fIsFadeCap, fHasShade;

        void FlattenLocks()
        {
            for (int s = 0; s < locks.Length; s++)
            {
                var lk = locks[s];
                fRootWidth[s] = lk.rootWidth; fScalpRoot[s] = lk.scalpRoot; fBaseWidth[s] = lk.baseWidth; fBaseThickness[s] = lk.baseThickness;
                fSurfaceShine[s] = lk.surfaceShine; fRoundness[s] = lk.roundness; fTipWidth[s] = lk.tipWidth; fTipStart[s] = lk.tipStart;
                fRipple[s] = lk.ripple; fRippleFreq[s] = lk.rippleFreq;
                fRootNormal[s * 3] = lk.rootNormal[0]; fRootNormal[s * 3 + 1] = lk.rootNormal[1]; fRootNormal[s * 3 + 2] = lk.rootNormal[2];
                bool hs = lk.shadeDir != null;
                fHasShade[s] = (byte)(hs ? 1 : 0);
                if (hs) { fShadeDir[s * 3] = lk.shadeDir[0]; fShadeDir[s * 3 + 1] = lk.shadeDir[1]; fShadeDir[s * 3 + 2] = lk.shadeDir[2]; }
                fIsBaseShell[s] = (byte)(lk.isBaseShell ? 1 : 0); fLockNormal[s] = (byte)(lk.lockNormal ? 1 : 0); fIsFadeCap[s] = (byte)(lk.isFadeCap ? 1 : 0);
            }
        }

        public unsafe void Update(double hpx, double hpy, double hpz, double hqx, double hqy, double hqz, double hqw, double widthScale, float unitScale)
        {
            var mp = new AetherStrandMeshKernel.Params
            {
                hpx = hpx, hpy = hpy, hpz = hpz, hqx = hqx, hqy = hqy, hqz = hqz, hqw = hqw, widthScale = widthScale, unitScale = unitScale,
                fit = useFit ? 1 : 0, lockCount = locks.Length,
                fsx = fitScale.x, fsy = fitScale.y, fsz = fitScale.z, fox = fitOffset.x, foy = fitOffset.y, foz = fitOffset.z,
            };
            FlattenLocks();
            fixed (double* X = solver.PosX, Y = solver.PosY, Z = solver.PosZ)
            fixed (double* rw = fRootWidth, sr = fScalpRoot, bw = fBaseWidth, bt = fBaseThickness, ss = fSurfaceShine, rd = fRoundness, tw = fTipWidth, tst = fTipStart, rp = fRipple, rf = fRippleFreq, rn = fRootNormal, sd = fShadeDir)
            fixed (byte* ib = fIsBaseShell, ln = fLockNormal, fc = fIsFadeCap, hs = fHasShade)
            fixed (int* lsm = lockSm, rc = ringCount)
            fixed (double* t0 = RootSin, t1 = TipTaper, t2 = BaseTipTaper, t3 = TipFactor, t4 = ThickPow, px = PX, py = PY, pnx = PNX, pny = PNY)
            fixed (Vector3* ov = verts, on = norms)
            fixed (Vector4* ot = tans)
            {
                var bf = new AetherStrandMeshKernel.Buffers
                {
                    X = X, Y = Y, Z = Z,
                    rootWidth = rw, scalpRoot = sr, baseWidth = bw, baseThickness = bt, surfaceShine = ss, roundness = rd, tipWidth = tw, tipStart = tst, ripple = rp, rippleFreq = rf, rootNormal = rn, shadeDir = sd,
                    isBaseShell = ib, lockNormal = ln, isFadeCap = fc, hasShade = hs,
                    lockSm = lsm, ringCount = rc,
                    RootSin = t0, TipTaper = t1, BaseTipTaper = t2, TipFactor = t3, ThickPow = t4, PX = px, PY = py, PNX = pnx, PNY = pny,
                    verts = (float*)ov, norms = (float*)on, tans = (float*)ot,
                };
                AetherStrandMeshKernel.Build(ref mp, ref bf);
            }
            mesh.SetVertices(verts);
            mesh.SetNormals(norms);
            mesh.SetTangents(tans);
            mesh.RecalculateBounds();
        }



        /// <summary>Copy of the last vertex positions (hair space), for tests.</summary>
        public Vector3[] Vertices => verts;
    }
}
