using System;

namespace AetherStrand
{
    /// <summary>
    /// The per-frame ring build of AetherStrandWebMesh.Update (web updateVolumetricBuffers), split out so Burst can compile it.
    /// It ran 8 to 10 ms a frame under Mono for the Messy Mage hybrid (447 locks, ~96k vertices). The maths is unchanged line
    /// for line. With com.unity.burst installed (AETHERSTRAND_BURST, set by the asmdef's versionDefines) it is compiled with
    /// FloatMode.Strict so the vertices match the managed path; without Burst it runs as ordinary C#.
    /// </summary>
#if AETHERSTRAND_BURST
    [Unity.Burst.BurstCompile]
#endif
    public static unsafe class AetherStrandMeshKernel
    {
        const int RV = AetherStrandWebMesh.RingVerts;

        /// <summary>Per-call pose and output mapping (Update's arguments and the head-fit settings).</summary>
        public struct Params
        {
            public double hpx, hpy, hpz, hqx, hqy, hqz, hqw, widthScale, unitScale;
            public int fit, lockCount;
            public double fsx, fsy, fsz, fox, foy, foz;
        }

        /// <summary>Pointers to pinned arrays: solver particles, per-lock data flattened by AetherStrandWebMesh, tables, outputs.</summary>
        public struct Buffers
        {
            public double* X, Y, Z;
            public double* rootWidth, scalpRoot, baseWidth, baseThickness, surfaceShine, roundness, tipWidth, tipStart, ripple, rippleFreq, rootNormal, shadeDir;
            public byte* isBaseShell, lockNormal, isFadeCap, hasShade;
            public int* lockSm, ringCount;
            public double* RootSin, TipTaper, BaseTipTaper, TipFactor, ThickPow, PX, PY, PNX, PNY;
            public float* verts, norms, tans;
        }

        static void MapPoint(ref Params mp, float* o, double x, double y, double z)
        {
            if (mp.fit == 0) { o[0] = (float)(-x * mp.unitScale); o[1] = (float)(y * mp.unitScale); o[2] = (float)(z * mp.unitScale); return; }
            double cqx = -mp.hqx, cqy = -mp.hqy, cqz = -mp.hqz, cqw = mp.hqw;
            double ax = x - mp.hpx, ay = y - mp.hpy, az = z - mp.hpz;
            double tx2 = 2 * (cqy * az - cqz * ay), ty2 = 2 * (cqz * ax - cqx * az), tz2 = 2 * (cqx * ay - cqy * ax);
            double lx = ax + cqw * tx2 + (cqy * tz2 - cqz * ty2), ly = ay + cqw * ty2 + (cqz * tx2 - cqx * tz2), lz = az + cqw * tz2 + (cqx * ty2 - cqy * tx2);
            o[0] = (float)(-lx * mp.fsx + mp.fox); o[1] = (float)(ly * mp.fsy + mp.foy); o[2] = (float)(lz * mp.fsz + mp.foz);
        }

        // kind: 0 = normal (inverse-transpose of the fit), 1 = tangent/direction
        static void MapDir(ref Params mp, float* o, double x, double y, double z, int kind)
        {
            if (mp.fit == 0) { o[0] = (float)-x; o[1] = (float)y; o[2] = (float)z; return; }
            double cqx = -mp.hqx, cqy = -mp.hqy, cqz = -mp.hqz, cqw = mp.hqw;
            double tx2 = 2 * (cqy * z - cqz * y), ty2 = 2 * (cqz * x - cqx * z), tz2 = 2 * (cqx * y - cqy * x);
            double lx = x + cqw * tx2 + (cqy * tz2 - cqz * ty2), ly = y + cqw * ty2 + (cqz * tx2 - cqx * tz2), lz = z + cqw * tz2 + (cqx * ty2 - cqy * tx2);
            double dx = -lx, dy = ly, dz = lz;
            if (kind == 0) { dx /= mp.fsx; dy /= mp.fsy; dz /= mp.fsz; } else { dx *= mp.fsx; dy *= mp.fsy; dz *= mp.fsz; }
            double l = System.Math.Sqrt(dx * dx + dy * dy + dz * dz); if (l < 1e-12) l = 1;
            o[0] = (float)(dx / l); o[1] = (float)(dy / l); o[2] = (float)(dz / l);
        }

    internal static double CR(double p0, double p1, double p2, double p3, double f)
            {
                double f2 = f * f;
                return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f2 * f);
            }
    internal static double CRD(double p0, double p1, double p2, double p3, double f)
            {
                return 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * f + 3 * (3 * p1 - p0 - 3 * p2 + p3) * f * f);
            }
    internal static void RotConj(double x, double y, double z, double qx, double qy, double qz, double qw, out double lx, out double ly, out double lz)
            {
                double tx2 = 2 * (qy * z - qz * y), ty2 = 2 * (qz * x - qx * z), tz2 = 2 * (qx * y - qy * x);
                lx = x + qw * tx2 + (qy * tz2 - qz * ty2); ly = y + qw * ty2 + (qz * tx2 - qx * tz2); lz = z + qw * tz2 + (qx * ty2 - qy * tx2);
            }
    internal static void TipShape(double t, double tipStart, double tipWidth, double ripple, double rippleFreq, out double w, out double th)
            {
                double s = double.IsNaN(tipStart) ? 0.44 : System.Math.Min(0.97, System.Math.Max(0.2, tipStart));
                double tw = System.Math.Min(0.9, System.Math.Max(0.0, tipWidth));
                t = System.Math.Min(1.0, t * (AetherStrandWebSolver.N - 1) / (double)(AetherStrandWebSolver.N - 2)); // last ring = node N-2; tip vertex closes at N-1
                double u = t < s ? t * 0.44 / s : 0.44 + ((t - s) / (1 - s)) * 0.56;
                w = System.Math.Max(0.06, u < 0.44 ? 1.0 - u * 0.14 : System.Math.Pow((1.0 - u) / 0.56, 0.94) * 0.938);
                th = System.Math.Pow(System.Math.Max(0.04, 1.0 - u), 0.86);
                if (tw > 0)
                {
                    w = tw + (1 - tw) * w;
                    th = tw + (1 - tw) * th;
                    const double cap = 0.07;
                    if (t > 1 - cap)
                    {
                        double c = (t - (1 - cap)) / cap;
                        double f = 0.55 + 0.45 * System.Math.Sqrt(System.Math.Max(0.0, 1 - c * c));
                        w *= f; th *= f;
                    }
                }
                double rp = System.Math.Min(0.45, System.Math.Max(0.0, ripple));
                if (rp > 0)
                {
                    double fq = System.Math.Max(1.0, rippleFreq);
                    double rf = System.Math.Min(1.0, System.Math.Max(0.0, (t - 0.04) / 0.11));
                    double m = 1 - rp * 0.5 * (1 - System.Math.Cos(2 * System.Math.PI * fq * t)) * rf * rf * (3 - 2 * rf);
                    w *= m; th *= m;
                }
            }

        /// <summary>Writes every lock's ring vertices, normals and tangents (xyz, xyz, xyzw floats) in lock order.</summary>
#if AETHERSTRAND_BURST
        [Unity.Burst.BurstCompile(FloatMode = Unity.Burst.FloatMode.Strict, FloatPrecision = Unity.Burst.FloatPrecision.Standard)]
#endif
        public static void Build(ref Params mp, ref Buffers bf)
        {
            // per-call constants (Update's locals)
            double hpx = mp.hpx, hpy = mp.hpy, hpz = mp.hpz, hqx = mp.hqx, hqy = mp.hqy, hqz = mp.hqz, hqw = mp.hqw, widthScale = mp.widthScale;
            double cqx = -hqx, cqy = -hqy, cqz = -hqz, cqw = hqw;
            bool fit = mp.fit != 0;
            double fsx = mp.fsx, fsy = mp.fsy, fsz = mp.fsz;
            const int NN = AetherStrandWebSolver.N;
            int locksLength = mp.lockCount;
            double* X = bf.X; double* Y = bf.Y; double* Z = bf.Z;
            double* _ext = stackalloc double[(NN + 2) * 3];
            float* c0 = stackalloc float[3]; float* tvR = stackalloc float[3];
            float* outV = bf.verts; float* outN = bf.norms; float* outT = bf.tans;
            double* rootN = bf.rootNormal; double* shadeD = bf.shadeDir; byte* hasShade = bf.hasShade;
            int* lockSm = bf.lockSm; int* ringCount = bf.ringCount;
            double* RootSin = bf.RootSin; double* TipTaper = bf.TipTaper; double* BaseTipTaper = bf.BaseTipTaper; double* TipFactor = bf.TipFactor; double* ThickPow = bf.ThickPow;
            double* PX = bf.PX; double* PY = bf.PY; double* PNX = bf.PNX; double* PNY = bf.PNY;
            double* L_rootWidth = bf.rootWidth;
            double* L_scalpRoot = bf.scalpRoot;
            double* L_baseWidth = bf.baseWidth;
            double* L_baseThickness = bf.baseThickness;
            double* L_surfaceShine = bf.surfaceShine;
            double* L_roundness = bf.roundness;
            double* L_tipWidth = bf.tipWidth;
            double* L_tipStart = bf.tipStart;
            double* L_ripple = bf.ripple;
            double* L_rippleFreq = bf.rippleFreq;
            byte* L_isBaseShell = bf.isBaseShell;
            byte* L_lockNormal = bf.lockNormal;
            byte* L_isFadeCap = bf.isFadeCap;
            // head centre in world = HEAD_CENTER_LOCAL (0,0.425,-0.01) rotated + head pos (three applyQuaternion)
            double hcx, hcy, hcz;
            {
                double lx = 0, ly = 0.425, lz = -0.01;
                double ix = hqw * lx + hqy * lz - hqz * ly;
                double iy = hqw * ly + hqz * lx - hqx * lz;
                double iz = hqw * lz + hqx * ly - hqy * lx;
                double iw = -hqx * lx - hqy * ly - hqz * lz;
                hcx = ix * hqw + iw * -hqx + iy * -hqz - iz * -hqy + hpx;
                hcy = iy * hqw + iw * -hqy + iz * -hqx - ix * -hqz + hpy;
                hcz = iz * hqw + iw * -hqz + ix * -hqy - iy * -hqx + hpz;
            }
            double x2 = hqx + hqx, y2 = hqy + hqy, z2 = hqz + hqz;
            double xx = hqx * x2, xy = hqx * y2, xz = hqx * z2, yy = hqy * y2, yz = hqy * z2, zz = hqz * z2, wx = hqw * x2, wy = hqw * y2, wz = hqw * z2;
            double m00 = 1 - (yy + zz), m01 = xy - wz, m02 = xz + wy;
            double m10 = xy + wz, m11 = 1 - (xx + zz), m12 = yz - wx;
            double m20 = xz - wy, m21 = yz + wx, m22 = 1 - (xx + yy);
            double us = mp.unitScale;
            int vIdx = 0;
            for (int s = 0; s < locksLength; s++)
            {
                int b = s * NN;
                bool isBase = (L_isBaseShell[s] != 0), lockNormal = (L_lockNormal[s] != 0);
                double rootMinW = !double.IsNaN(L_rootWidth[s]) ? L_rootWidth[s] : (L_scalpRoot[s] >= 0.5 ? 0.36 : 0.08);
                double effW = isBase ? 1.0 : widthScale;
                double effT = isBase ? 1.0 : 0.9 * (0.65 + 0.35 * effW);
                double baseHalfW = L_baseWidth[s] * 0.5 * effW;
                double baseHalfT = L_baseThickness[s] * 0.5 * effT;

                double odx = m00 * rootN[s * 3 + 0] + m01 * rootN[s * 3 + 1] + m02 * rootN[s * 3 + 2];
                double ody = m10 * rootN[s * 3 + 0] + m11 * rootN[s * 3 + 1] + m12 * rootN[s * 3 + 2];
                double odz = m20 * rootN[s * 3 + 0] + m21 * rootN[s * 3 + 1] + m22 * rootN[s * 3 + 2];
                double odl = System.Math.Sqrt(odx * odx + ody * ody + odz * odz);
                double odInv = 1.0 / (odl == 0 ? 1.0 : odl);
                odx *= odInv; ody *= odInv; odz *= odInv;
                double ox = 0, oy = 1, oz = 0;
                // the lock's overall direction (root to tip): with surfaceShine the shading tangent leans to it, so a lock that
                // bends keeps one highlight along its length instead of going dark where it bends away from the light (as the web)
                double chx = 0, chy = 0, chz = 0;
                if (L_surfaceShine[s] > 0 && hasShade[s] != 0)
                {
                    // (a shadeDir from the builder: the comb direction there, shared by neighbouring locks)
                    double* sd = shadeD + s * 3;
                    chx = m00 * sd[0] + m01 * sd[1] + m02 * sd[2]; chy = m10 * sd[0] + m11 * sd[1] + m12 * sd[2]; chz = m20 * sd[0] + m21 * sd[1] + m22 * sd[2];
                    double cl = System.Math.Sqrt(chx * chx + chy * chy + chz * chz);
                    if (cl > 1e-5) { chx /= cl; chy /= cl; chz /= cl; } else { chx = chy = chz = 0; }
                }
                else if (L_surfaceShine[s] > 0)
                {
                    int tl0 = b + NN - 1;
                    chx = X[tl0] - X[b]; chy = Y[tl0] - Y[b]; chz = Z[tl0] - Z[b];
                    double cl = System.Math.Sqrt(chx * chx + chy * chy + chz * chz);
                    if (cl > 1e-5) { chx /= cl; chy /= cl; chz /= cl; } else { chx = chy = chz = 0; }
                }
                int sm = lockSm[s], rings = ringCount[s];
                double round = L_roundness[s];
                if (sm > 1)
                {
                    int n = NN;
                    for (int q = 0; q < n; q++) { _ext[(q + 1) * 3] = X[b + q]; _ext[(q + 1) * 3 + 1] = Y[b + q]; _ext[(q + 1) * 3 + 2] = Z[b + q]; }
                    for (int a = 0; a < 3; a++) { _ext[a] = 2 * _ext[3 + a] - _ext[6 + a]; _ext[(n + 1) * 3 + a] = 2 * _ext[n * 3 + a] - _ext[(n - 1) * 3 + a]; }
                }

                for (int m = 0; m < rings; m++)
                {
                    int k = sm == 1 ? m : m / sm;
                    int i = b + k;
                    double px0, py0, pz0;
                    double tx = 0, ty = 0, tz = 0;
                    double sRs = 0, sTT = 0, sBT = 0, sTF = 0, sTP = 0;
                    if (sm > 1)
                    {
                        double fu = (m - k * sm) / (double)sm; int e = k * 3;
                        px0 = CR(_ext[e], _ext[e + 3], _ext[e + 6], _ext[e + 9], fu);
                        py0 = CR(_ext[e + 1], _ext[e + 4], _ext[e + 7], _ext[e + 10], fu);
                        pz0 = CR(_ext[e + 2], _ext[e + 5], _ext[e + 8], _ext[e + 11], fu);
                        tx = CRD(_ext[e], _ext[e + 3], _ext[e + 6], _ext[e + 9], fu);
                        ty = CRD(_ext[e + 1], _ext[e + 4], _ext[e + 7], _ext[e + 10], fu);
                        tz = CRD(_ext[e + 2], _ext[e + 5], _ext[e + 8], _ext[e + 11], fu);
                        double tt = (m / (double)sm) / (NN - 1);
                        sTF = tt;
                        sRs = System.Math.Sin(System.Math.Min(1.0, tt * 4.2) * System.Math.PI * 0.5);
                        sTT = System.Math.Max(0.06, tt < 0.44 ? 1.0 - tt * 0.14 : System.Math.Pow((1.0 - tt) / 0.56, 0.94) * 0.938);
                        sBT = System.Math.Max(0.04, tt < 0.42 ? 1.0 - tt * 0.16 : System.Math.Pow((1.0 - tt) / 0.58, 1.12) * 0.933);
                        sTP = System.Math.Pow(System.Math.Max(0.04, 1.0 - tt), 0.86);
                    }
                    else { px0 = X[i]; py0 = Y[i]; pz0 = Z[i]; }
                    if (sm > 1) { }
                    else if (k == 0) { tx = X[i + 1] - px0; ty = Y[i + 1] - py0; tz = Z[i + 1] - pz0; }
                    else { tx = X[i + 1] - X[i - 1]; ty = Y[i + 1] - Y[i - 1]; tz = Z[i + 1] - Z[i - 1]; }
                    double tl = System.Math.Sqrt(tx * tx + ty * ty + tz * tz);
                    double tInv = 1.0 / (tl == 0 ? 1.0 : tl);
                    tx *= tInv; ty *= tInv; tz *= tInv;

                    double hnx = px0 - hcx, hny = py0 - hcy, hnz = pz0 - hcz;
                    double hl = System.Math.Sqrt(hnx * hnx + hny * hny + hnz * hnz);
                    double hnInv = 1.0 / (hl == 0 ? 1.0 : hl);
                    hnx *= hnInv; hny *= hnInv; hnz *= hnInv;
                    // shading tangent (surfaceShine): the lock's direction along the scalp, its rise off the skin removed
                    double stx = tx, sty = ty, stz = tz;
                    if (L_surfaceShine[s] > 0)
                    {
                        if (chx != 0 || chy != 0 || chz != 0) { stx += (chx - stx) * L_surfaceShine[s]; sty += (chy - sty) * L_surfaceShine[s]; stz += (chz - stz) * L_surfaceShine[s]; }
                        double tn = (stx * hnx + sty * hny + stz * hnz) * L_surfaceShine[s];
                        stx -= hnx * tn; sty -= hny * tn; stz -= hnz * tn;
                        double sl = System.Math.Sqrt(stx * stx + sty * sty + stz * stz);
                        if (sl > 1e-4) { stx /= sl; sty /= sl; stz /= sl; } else { stx = tx; sty = ty; stz = tz; }
                    }

                    double sx, sy, sz;
                    if (!lockNormal)
                    {
                        sx = ty * hnz - tz * hny; sy = tz * hnx - tx * hnz; sz = tx * hny - ty * hnx;
                        if (sx * sx + sy * sy + sz * sz >= 0.0025) { odx = hnx; ody = hny; odz = hnz; }
                        else
                        {
                            odx += (hnx - odx) * 0.5; ody += (hny - ody) * 0.5; odz += (hnz - odz) * 0.5;
                            double ol = System.Math.Sqrt(odx * odx + ody * ody + odz * odz);
                            double oInv = 1.0 / (ol == 0 ? 1.0 : ol);
                            odx *= oInv; ody *= oInv; odz *= oInv;
                            sx = ty * odz - tz * ody; sy = tz * odx - tx * odz; sz = tx * ody - ty * odx;
                        }
                    }
                    else { sx = ty * odz - tz * ody; sy = tz * odx - tx * odz; sz = tx * ody - ty * odx; }

                    double sLenSq = sx * sx + sy * sy + sz * sz;
                    if (sLenSq < 0.0001) { sx = 1; sy = 0; sz = 0; }
                    else { double sInv = 1.0 / System.Math.Sqrt(sLenSq); sx *= sInv; sy *= sInv; sz *= sInv; }

                    ox = sy * tz - sz * ty; oy = sz * tx - sx * tz; oz = sx * ty - sy * tx;

                    double rSin = sm > 1 ? sRs : RootSin[k];
                    double rootTuck = isBase ? 0.88 + 0.12 * rSin : rootMinW + (1.0 - rootMinW) * rSin;
                    double rootThickTuck = isBase ? 1.0 : 0.2 + 0.8 * rSin;
                    bool isFade = (L_isFadeCap[s] != 0);
                    bool customTip = !isFade && (L_tipWidth[s] > 0 || !double.IsNaN(L_tipStart[s]) || L_ripple[s] > 0);
                    double ctW = 1, ctT = 1;
                    if (customTip) TipShape(sm > 1 ? sTF : TipFactor[k], L_tipStart[s], L_tipWidth[s], L_ripple[s], L_rippleFreq[s], out ctW, out ctT);
                    double tipTaper = isFade ? 1.0 : (customTip ? ctW : (isBase ? (sm > 1 ? sBT : BaseTipTaper[k]) : (sm > 1 ? sTT : TipTaper[k])));
                    double halfW = baseHalfW * rootTuck * tipTaper;
                    double halfT = isFade ? baseHalfT * rootThickTuck * 0.55 * (1.0 - (sm > 1 ? sTF : TipFactor[k]) * 0.65) : baseHalfT * rootThickTuck * (customTip ? ctT : (sm > 1 ? sTP : ThickPow[k]));
                    if (round > 0 && !isFade && !isBase) halfT += (halfW * 0.9 * rootThickTuck - halfT) * round;

                    // The output mapping is affine (MapPoint) or linear then normalised (MapDir), so it is applied once per ring to
                    // the centre and the two cross-section axes, and each ring vertex is a weighted sum of those (same result as
                    // mapping every vertex, about a quarter of the work: this loop runs for every vertex of every lock every frame).
                    MapPoint(ref mp, c0, px0, py0, pz0);
                    double cx0 = c0[0], cy0 = c0[1], cz0 = c0[2];
                    double psx, psy, psz, pox, poy, poz; // position axes, mapped (linear part of MapPoint)
                    double nsx, nsy, nsz, nox, noy, noz; // normal axes, mapped (linear part of MapDir kind 0, before normalising)
                    if (!fit)
                    {
                        psx = -sx * us; psy = sy * us; psz = sz * us; pox = -ox * us; poy = oy * us; poz = oz * us;
                        nsx = -sx; nsy = sy; nsz = sz; nox = -ox; noy = oy; noz = oz;
                    }
                    else
                    {
                        RotConj(sx, sy, sz, cqx, cqy, cqz, cqw, out double lx, out double ly, out double lz);
                        psx = -lx * fsx; psy = ly * fsy; psz = lz * fsz; nsx = -lx / fsx; nsy = ly / fsy; nsz = lz / fsz;
                        RotConj(ox, oy, oz, cqx, cqy, cqz, cqw, out lx, out ly, out lz);
                        pox = -lx * fsx; poy = ly * fsy; poz = lz * fsz; nox = -lx / fsx; noy = ly / fsy; noz = lz / fsz;
                    }
                    MapDir(ref mp, tvR, stx, sty, stz, 1);
                    for (int r = 0; r < RV; r++)
                    {
                        double a = PX[r] * halfW, c = PY[r] * halfT;
                        float* ov = outV + vIdx * 3; ov[0] = (float)(cx0 + psx * a + pox * c); ov[1] = (float)(cy0 + psy * a + poy * c); ov[2] = (float)(cz0 + psz * a + poz * c);
                        double nx = nsx * PNX[r] + nox * PNY[r], ny = nsy * PNX[r] + noy * PNY[r], nz = nsz * PNX[r] + noz * PNY[r];
                        if (fit) { double l = System.Math.Sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) l = 1; nx /= l; ny /= l; nz /= l; }
                        float* on = outN + vIdx * 3; on[0] = (float)nx; on[1] = (float)ny; on[2] = (float)nz;
                        float* ot = outT + vIdx * 4; ot[0] = tvR[0]; ot[1] = tvR[1]; ot[2] = tvR[2]; ot[3] = 1f;
                        vIdx++;
                    }
                }

                int ti = b + NN - 1;
                double ttx = X[ti] - X[ti - 1], tty = Y[ti] - Y[ti - 1], ttz = Z[ti] - Z[ti - 1];
                double tl2 = System.Math.Sqrt(ttx * ttx + tty * tty + ttz * ttz);
                double ttInv = 1.0 / (tl2 == 0 ? 1.0 : tl2);
                ttx *= ttInv; tty *= ttInv; ttz *= ttInv;
                if (L_surfaceShine[s] > 0)
                {
                    double thx = X[ti] - hcx, thy = Y[ti] - hcy, thz = Z[ti] - hcz;
                    double thl = System.Math.Sqrt(thx * thx + thy * thy + thz * thz);
                    if (thl > 0) { thx /= thl; thy /= thl; thz /= thl; }
                    if (chx != 0 || chy != 0 || chz != 0) { ttx += (chx - ttx) * L_surfaceShine[s]; tty += (chy - tty) * L_surfaceShine[s]; ttz += (chz - ttz) * L_surfaceShine[s]; }
                    double tn = (ttx * thx + tty * thy + ttz * thz) * L_surfaceShine[s];
                    double fx = ttx - thx * tn, fy = tty - thy * tn, fz = ttz - thz * tn;
                    double fl = System.Math.Sqrt(fx * fx + fy * fy + fz * fz);
                    if (fl > 1e-4) { ttx = fx / fl; tty = fy / fl; ttz = fz / fl; }
                }
                MapPoint(ref mp, outV + vIdx * 3, X[ti], Y[ti], Z[ti]);
                MapDir(ref mp, outN + vIdx * 3, ox, oy, oz, 0);
                { MapDir(ref mp, outT + vIdx * 4, ttx, tty, ttz, 1); outT[vIdx * 4 + 3] = 1f; }
                vIdx++;
            }
        }
    }
}
