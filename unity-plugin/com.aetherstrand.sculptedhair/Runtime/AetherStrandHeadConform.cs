// Head conform: port of the web's characterHead.ts buildHeadConformMap / sampleHeadConform / conformPoint.
// The web lays hair on its ellipsoid scalp; a character's skull bulges past it in places and is smaller elsewhere. The map
// stores, per scalp direction, how far the real skull stands out from the ellipsoid (in ellipsoid radius units), and
// Offset moves a point out or in by that amount so hair keeps its height above the real skull. Web head-pivot space,
// no UnityEngine types (tools/unity-parity/conform_test checks it against the web).
using System;
using System.Collections.Generic;

namespace AetherStrand
{
    public static class AetherStrandHeadConform
    {
        public const int AzBins = 72, PhiBins = 48; // CONFORM_AZ_BINS, CONFORM_PHI_BINS
        public const double PhiMax = 2.4;           // CONFORM_PHI_MAX
        const double HCx = 0.0, HCy = 0.425, HCz = -0.01; // HEAD_CENTER_LOCAL
        const double RX = 0.282, RY = 0.318, RZ = 0.31;   // SCALP_RX/RY/RZ

        static void Ell(double x, double y, double z, out double az, out double phi, out double r)
        {
            double dx = (x - HCx) / RX, dy = (y - HCy) / RY, dz = (z - HCz) / RZ;
            r = Math.Sqrt(dx * dx + dy * dy + dz * dz);
            az = Math.Atan2(dx, dz);
            phi = Math.Acos(Math.Max(-1.0, Math.Min(1.0, dy / (r != 0 ? r : 1))));
        }

        static float At(float[] arr, int a, int p) => arr[(((a % AzBins) + AzBins) % AzBins) * PhiBins + Math.Max(0, Math.Min(PhiBins - 1, p))];

        /// <summary>Builds the map from head points (x, y, z triples) in web head-pivot space.</summary>
        public static float[] Build(float[] pts)
        {
            int A = AzBins, P = PhiBins;
            var bins = new List<double>[A * P];
            for (int i = 0; i + 2 < pts.Length; i += 3)
            {
                Ell(pts[i], pts[i + 1], pts[i + 2], out double az, out double phi, out double r);
                if (phi >= PhiMax) continue;
                int a = Math.Min(A - 1, (int)Math.Floor((az + Math.PI) / (Math.PI * 2) * A));
                int p = Math.Min(P - 1, (int)Math.Floor(phi / PhiMax * P));
                (bins[a * P + p] ??= new List<double>()).Add(r);
            }
            var raw = new float[A * P];
            for (int i = 0; i < raw.Length; i++)
            {
                var b = bins[i];
                if (b == null) { raw[i] = float.NaN; continue; }
                b.Sort();
                raw[i] = (float)(b[(int)Math.Floor((b.Count - 1) * 0.97)] - 1.0); // 97th percentile radius
            }
            for (int pass = 0; pass < 6; pass++) // fill holes from neighbours (in place, as the web does)
                for (int a = 0; a < A; a++) for (int p = 0; p < P; p++)
                {
                    if (!float.IsNaN(raw[a * P + p])) continue;
                    float s = 0; int n = 0;
                    for (int da = -1; da <= 1; da++) for (int dp = -1; dp <= 1; dp++) { float v = At(raw, a + da, p + dp); if (!float.IsNaN(v)) { s += v; n++; } }
                    if (n > 0) raw[a * P + p] = s / n;
                }
            var cur = new float[A * P];
            for (int i = 0; i < cur.Length; i++) cur[i] = float.IsNaN(raw[i]) ? 0f : raw[i];
            { // 3x3 max: the hair must clear the highest point under it
                var mx = new float[A * P];
                for (int a = 0; a < A; a++) for (int p = 0; p < P; p++)
                {
                    float m = float.NegativeInfinity;
                    for (int da = -1; da <= 1; da++) for (int dp = -1; dp <= 1; dp++) m = Math.Max(m, At(cur, a + da, p + dp));
                    mx[a * P + p] = m;
                }
                cur = mx;
            }
            for (int pass = 0; pass < 2; pass++) // two 3x3 box passes
            {
                var nx = new float[A * P];
                for (int a = 0; a < A; a++) for (int p = 0; p < P; p++)
                {
                    float s = 0;
                    for (int da = -1; da <= 1; da++) for (int dp = -1; dp <= 1; dp++) s += At(cur, a + da, p + dp);
                    nx[a * P + p] = s / 9f;
                }
                cur = nx;
            }
            for (int i = 0; i < cur.Length; i++) cur[i] = Math.Max(-0.12f, Math.Min(0.2f, cur[i]));
            return cur;
        }

        /// <summary>Skull excess at signed azimuth az and polar angle phi (bilinear, azimuth wraps).</summary>
        public static double Sample(float[] m, double az, double phi)
        {
            double fa = (az + Math.PI) / (Math.PI * 2) * AzBins - 0.5;
            double fp = Math.Max(0, Math.Min(PhiBins - 1, phi / PhiMax * PhiBins - 0.5));
            int a0 = (int)Math.Floor(fa), p0 = (int)Math.Floor(fp);
            double ta = fa - a0, tp = fp - p0;
            double g(int a, int p) => m[(((a % AzBins) + AzBins) % AzBins) * PhiBins + Math.Min(PhiBins - 1, p)];
            return (g(a0, p0) * (1 - ta) + g(a0 + 1, p0) * ta) * (1 - tp) + (g(a0, p0 + 1) * (1 - ta) + g(a0 + 1, p0 + 1) * ta) * tp;
        }

        /// <summary>
        /// conformPoint with allowInward = true and no hairline cap: the move (web space) that puts (x, y, z) at its height
        /// above the real skull. The web clamps phi to the lowest hairline for hair hanging past the scalp; the hybrid mass
        /// stops above the painted hairline by design (hairPhysics MASS_PAINT_BAND), so the clamp does not apply to it.
        /// </summary>
        public static void Offset(float[] m, double x, double y, double z, out double dx, out double dy, out double dz)
        {
            dx = dy = dz = 0;
            Ell(x, y, z, out double az, out double phi, out double r);
            if (r < 1e-6) return;
            double ex = Sample(m, az, phi);
            if (Math.Abs(ex) < 1e-5) return;
            double k = (r + ex) / r - 1;
            dx = (x - HCx) * k; dy = (y - HCy) * k; dz = (z - HCz) * k;
        }
    }
}
