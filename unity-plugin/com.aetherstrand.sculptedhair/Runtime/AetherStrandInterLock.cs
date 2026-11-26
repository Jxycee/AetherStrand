using System;

namespace AetherStrand
{
    /// <summary>
    /// The lock-vs-lock contact pair loop of AetherStrandWebSolver.ResolveInterLock (web hairPhysics.ts resolveInterLock), split
    /// out so Burst can compile it: it is about three quarters of the solver's time (Messy Mage hybrid: ~313k candidate pairs a
    /// frame, ~19k in contact). The maths is unchanged line for line. With com.unity.burst installed (AETHERSTRAND_BURST, set
    /// by the asmdef's versionDefines) it is compiled with FloatMode.Strict so results match the managed path and the web;
    /// without Burst it runs as ordinary C#. Single-threaded on purpose: contacts write to both nodes, so a parallel version
    /// would change the summation order and with it the results.
    /// </summary>
#if AETHERSTRAND_BURST
    [Unity.Burst.BurstCompile]
#endif
    public static unsafe class AetherStrandInterLock
    {
        /// <summary>Pointers to the solver's pinned spatial buffers (see AetherStrandWebSolver field comments).</summary>
        public struct Buffers
        {
            public int* HalfDx, HalfDy, HalfDz, cellCount, cellCx, cellCy, cellCz, cellMapId, cellMapKey, cellStart, sLock, sOrig;
            public float* dispX, dispY, dispZ, entryHalfT, entryHalfW, entryInvMass, entryRadX, entryRadY, entryRadZ, entryRestMidR, entryRootY, entryVelX, entryVelY, entryVelZ, sHalfW, sWeight, sX, sY, sZ, velDX, velDY, velDZ, velWeightSum, weightSum;
            public short* entryLayer;
        }

        /// <summary>Accumulates displacement, velocity and weight sums per entry; returns 1 if any pair touched.</summary>
#if AETHERSTRAND_BURST
        [Unity.Burst.BurstCompile(FloatMode = Unity.Burst.FloatMode.Strict, FloatPrecision = Unity.Burst.FloatPrecision.Standard)]
#endif
        public static int Pairs(ref Buffers b, int cellCountN, double MAX_COMB_W, double RAD_PAD_SQ)
        {
            int* HalfDx = b.HalfDx;
            int* HalfDy = b.HalfDy;
            int* HalfDz = b.HalfDz;
            int* cellCount = b.cellCount;
            int* cellCx = b.cellCx;
            int* cellCy = b.cellCy;
            int* cellCz = b.cellCz;
            int* cellMapId = b.cellMapId;
            int* cellMapKey = b.cellMapKey;
            int* cellStart = b.cellStart;
            int* sLock = b.sLock;
            int* sOrig = b.sOrig;
            float* dispX = b.dispX;
            float* dispY = b.dispY;
            float* dispZ = b.dispZ;
            float* entryHalfT = b.entryHalfT;
            float* entryHalfW = b.entryHalfW;
            float* entryInvMass = b.entryInvMass;
            float* entryRadX = b.entryRadX;
            float* entryRadY = b.entryRadY;
            float* entryRadZ = b.entryRadZ;
            float* entryRestMidR = b.entryRestMidR;
            float* entryRootY = b.entryRootY;
            float* entryVelX = b.entryVelX;
            float* entryVelY = b.entryVelY;
            float* entryVelZ = b.entryVelZ;
            float* sHalfW = b.sHalfW;
            float* sWeight = b.sWeight;
            float* sX = b.sX;
            float* sY = b.sY;
            float* sZ = b.sZ;
            float* velDX = b.velDX;
            float* velDY = b.velDY;
            float* velDZ = b.velDZ;
            float* velWeightSum = b.velWeightSum;
            float* weightSum = b.weightSum;
            short* entryLayer = b.entryLayer;
            const double WIDTH_FRAC = 0.8, THICK_SCALE = 1.48;
            double maxPairBox = MAX_COMB_W + 0.012, negMaxPairBox = -maxPairBox;
            bool anyHit = false;

            for (int cA = 0; cA < cellCountN; cA++)
            {
                int startA = cellStart[cA], endA = startA + cellCount[cA];
                int cx0 = cellCx[cA], cy0 = cellCy[cA], cz0 = cellCz[cA];
                for (int o = 0; o < 14; o++)
                {
                    int startB, endB;
                    bool isSelf = o == 0;
                    if (isSelf)
                    {
                        if (endA - startA < 2) continue;
                        startB = startA; endB = endA;
                    }
                    else
                    {
                        int nx = cx0 + HalfDx[o], ny = cy0 + HalfDy[o], nz = cz0 + HalfDz[o];
                        int nKey = AetherStrandWebSolver.PackCellS(nx, ny, nz);
                        int slot = AetherStrandWebSolver.HashCellS(nx, ny, nz);
                        int cB = -1;
                        while (true)
                        {
                            int existing = cellMapKey[slot];
                            if (existing == nKey) { cB = cellMapId[slot]; break; }
                            if (existing == -1) break;
                            slot = (slot + 1) & AetherStrandWebSolver.HashMaskS;
                        }
                        if (cB == -1) continue;
                        startB = cellStart[cB]; endB = startB + cellCount[cB];
                    }

                    int iEnd = isSelf ? endA - 1 : endA;
                    for (int ii = startA; ii < iEnd; ii++)
                    {
                        double pAx = sX[ii], pAy = sY[ii], pAz = sZ[ii];
                        int sA = sLock[ii];
                        double wA = sWeight[ii];
                        int e = sOrig[ii];
                        double radAX = entryRadX[e], radAY = entryRadY[e], radAZ = entryRadZ[e];
                        double halfWA = entryHalfW[e], halfTA = entryHalfT[e], invMA = entryInvMass[e];
                        int layerA = entryLayer[e];
                        double rootYA = entryRootY[e], midRA = entryRestMidR[e];
                        double velAX = entryVelX[e], velAY = entryVelY[e], velAZ = entryVelZ[e];

                        int jStart = isSelf ? ii + 1 : startB;
                        for (int j = jStart; j < endB; j++)
                        {
                            double vx = sX[j] - pAx;
                            if (vx >= maxPairBox || vx <= negMaxPairBox) continue;
                            double vy = sY[j] - pAy;
                            if (vy >= maxPairBox || vy <= negMaxPairBox) continue;
                            double vz = sZ[j] - pAz;
                            if (vz >= maxPairBox || vz <= negMaxPairBox) continue;
                            int sB = sLock[j];
                            if (sB == sA) continue;
                            double wB = sWeight[j];
                            if (wA == 0 && wB == 0) continue;

                            double rawCombW = (halfWA + sHalfW[j]) * WIDTH_FRAC;
                            double combHalfW = rawCombW < MAX_COMB_W ? rawCombW : MAX_COMB_W;
                            double combWSq = combHalfW * combHalfW;
                            double dSq = vx * vx + vy * vy + vz * vz;
                            if (dSq >= combWSq + RAD_PAD_SQ) continue;

                            int idx = sOrig[j];
                            double radBX = entryRadX[idx], radBY = entryRadY[idx], radBZ = entryRadZ[idx];
                            double mrx = radAX + radBX, mry = radAY + radBY, mrz = radAZ + radBZ;
                            double mrSq = mrx * mrx + mry * mry + mrz * mrz;
                            double invMr;
                            if (mrSq > 0.25) invMr = 0.5 * (1.5 - 0.125 * mrSq);
                            else { double sq = Math.Sqrt(mrSq); invMr = 1.0 / (sq == 0 || double.IsNaN(sq) ? 1.0 : sq); }
                            mrx *= invMr; mry *= invMr; mrz *= invMr;
                            double dRad = vx * mrx + vy * mry + vz * mrz;
                            double tx = vx - dRad * mrx, ty = vy - dRad * mry, tz = vz - dRad * mrz;
                            double dTanSq = tx * tx + ty * ty + tz * tz;
                            if (dTanSq >= combWSq) continue;

                            double uTanSq = dTanSq / combWSq;
                            int layerB = entryLayer[idx];
                            double rootYB = entryRootY[idx];
                            bool aIsOuter;
                            if (layerA != layerB) aIsOuter = layerA > layerB;
                            else
                            {
                                double dyRoot = rootYA - rootYB;
                                if (dyRoot > 0.01) aIsOuter = true;
                                else if (dyRoot < -0.01) aIsOuter = false;
                                else
                                {
                                    double drMid = midRA - entryRestMidR[idx];
                                    if (drMid > 0.003) aIsOuter = true;
                                    else if (drMid < -0.003) aIsOuter = false;
                                    else
                                    {
                                        int cA3 = sA % 3, cB3 = sB % 3;
                                        if (cA3 != cB3) aIsOuter = cA3 > cB3;
                                        else
                                        {
                                            int lo = sA < sB ? sA : sB, hi = sA < sB ? sB : sA;
                                            uint hh = unchecked((uint)((lo * 73856093) ^ (hi * 19349663))) & 1u;
                                            aIsOuter = hh == 0 ? sA > sB : sA < sB;
                                        }
                                    }
                                }
                            }

                            double halfTB = entryHalfT[idx];
                            double innerT = aIsOuter ? halfTB : halfTA;
                            double outerT = aIsOuter ? halfTA : halfTB;
                            double edgeProfile = 1.0 - 0.46 * uTanSq * uTanSq;
                            double reqRad = (edgeProfile * (innerT + 0.42 * outerT) + 0.0018 * (1.0 - uTanSq)) * THICK_SCALE;
                            double backDepth = (edgeProfile * (outerT + 0.28 * innerT) + 0.0018) * THICK_SCALE;
                            double signedClear = aIsOuter ? -dRad : dRad;
                            double penRad = reqRad - signedClear;
                            if (penRad <= 0 || signedClear <= -backDepth) continue;

                            double efRaw = (1.0 - uTanSq) * 2.4;
                            double ef = efRaw < 1.0 ? efRaw : 1.0;
                            double edgeFade = ef * ef * (3.0 - 2.0 * ef);
                            double bfRaw = (signedClear + backDepth) / (backDepth * 0.78 + 0.0015);
                            double bf = bfRaw < 1.0 ? bfRaw : 1.0;
                            double backFade = bf * bf * (3.0 - 2.0 * bf);
                            double pfRaw = penRad / (reqRad * 0.16 + 0.0005);
                            double pf = pfRaw < 1.0 ? pfRaw : 1.0;
                            double penFade = pf * pf * (3.0 - 2.0 * pf);
                            double invMB = entryInvMass[idx];
                            double invSum = invMA + invMB;
                            double shareA = invMA / invSum, shareB = invMB / invSum;
                            double maxW = wA > wB ? wA : wB;
                            double cw = edgeFade * backFade * penFade;
                            double effPenRad = penRad > reqRad ? reqRad + (penRad - reqRad) * 0.2 : penRad;
                            double puRaw = effPenRad / (reqRad * 0.8 + 0.0008);
                            double pu = puRaw < 1.0 ? puRaw : 1.0;
                            double prio = 0.1 + 0.9 * (pu * pu * (3.0 - 2.0 * pu));
                            double cwPrio = cw * prio;
                            anyHit = true;

                            double rawRad = effPenRad * 0.66;
                            double radBase = (rawRad < 0.0095 ? rawRad : 0.0095) * cwPrio;
                            double rawOuterA = (aIsOuter ? 0.78 + 0.14 * shareA : 0.08 + 0.14 * shareA) * wA;
                            double rawOuterB = (aIsOuter ? 0.22 - 0.14 * shareA : 0.92 - 0.14 * shareA) * wB;
                            double outerSum = rawOuterA + rawOuterB;
                            if (outerSum == 0 || double.IsNaN(outerSum)) outerSum = 1.0;
                            double pushA = maxW * (rawOuterA / outerSum);
                            double pushB = maxW * (rawOuterB / outerSum);
                            if (pushA > wA)
                            {
                                double ex = pushA - wA; pushA = wA;
                                double pb = pushB + ex; pushB = pb < wB ? pb : wB;
                            }
                            else if (pushB > wB)
                            {
                                double ex = pushB - wB; pushB = wB;
                                double pa = pushA + ex; pushA = pa < wA ? pa : wA;
                            }
                            double signRadA = (aIsOuter ? 1.0 : -1.0) * radBase * pushA;
                            double signRadB = (aIsOuter ? 1.0 : -1.0) * radBase * pushB;

                            dispX[e] = (float)(dispX[e] + radAX * signRadA);
                            dispY[e] = (float)(dispY[e] + radAY * signRadA);
                            dispZ[e] = (float)(dispZ[e] + radAZ * signRadA);
                            dispX[idx] = (float)(dispX[idx] - radBX * signRadB);
                            dispY[idx] = (float)(dispY[idx] - radBY * signRadB);
                            dispZ[idx] = (float)(dispZ[idx] - radBZ * signRadB);

                            double maxWeightA = pushA, maxWeightB = pushB;

                            if (wA > 0 && wB > 0)
                            {
                                double dTan = Math.Sqrt(dTanSq);
                                if (dTan > 0.0002)
                                {
                                    bool sameTier = layerA == layerB && Math.Abs(rootYA - rootYB) <= 0.025;
                                    double latGain = sameTier ? 0.26 : 0.09;
                                    double penTan = combHalfW - dTan;
                                    double cfRaw = dTan / 0.011;
                                    double cf = cfRaw < 1.0 ? cfRaw : 1.0;
                                    double centerFade = cf * cf * (3.0 - 2.0 * cf);
                                    double rawLat = penTan * latGain;
                                    double latBase = (rawLat < 0.005 ? rawLat : 0.005) * cwPrio * centerFade;
                                    double latA = shareA * wA, latB = shareB * wB;
                                    double latSum = latA + latB;
                                    if (latSum == 0 || double.IsNaN(latSum)) latSum = 1.0;
                                    double lpa = maxW * (latA / latSum), lpb = maxW * (latB / latSum);
                                    double latPushA = lpa < wA ? lpa : wA;
                                    double latPushB = lpb < wB ? lpb : wB;
                                    if (latPushA > maxWeightA) maxWeightA = latPushA;
                                    if (latPushB > maxWeightB) maxWeightB = latPushB;
                                    double invTan = 1.0 / dTan;
                                    double lScaleA = latBase * latPushA * invTan, lScaleB = latBase * latPushB * invTan;
                                    dispX[e] = (float)(dispX[e] - tx * lScaleA);
                                    dispY[e] = (float)(dispY[e] - ty * lScaleA);
                                    dispZ[e] = (float)(dispZ[e] - tz * lScaleA);
                                    dispX[idx] = (float)(dispX[idx] + tx * lScaleB);
                                    dispY[idx] = (float)(dispY[idx] + ty * lScaleB);
                                    dispZ[idx] = (float)(dispZ[idx] + tz * lScaleB);
                                }
                            }

                            weightSum[e] = (float)(weightSum[e] + cwPrio * maxWeightA);
                            weightSum[idx] = (float)(weightSum[idx] + cwPrio * maxWeightB);

                            double dvx = entryVelX[idx] - velAX, dvy = entryVelY[idx] - velAY, dvz = entryVelZ[idx] - velAZ;
                            double dvRad = dvx * mrx + dvy * mry + dvz * mrz;
                            double momW = 0.42 * maxW * cw;
                            dvx = (dvx - dvRad * mrx) * momW;
                            dvy = (dvy - dvRad * mry) * momW;
                            dvz = (dvz - dvRad * mrz) * momW;
                            double vwA = cw * shareA * wA, vwB = cw * shareB * wB;
                            velWeightSum[e] = (float)(velWeightSum[e] + vwA);
                            velWeightSum[idx] = (float)(velWeightSum[idx] + vwB);
                            velDX[e] = (float)(velDX[e] + dvx * shareA * wA);
                            velDY[e] = (float)(velDY[e] + dvy * shareA * wA);
                            velDZ[e] = (float)(velDZ[e] + dvz * shareA * wA);
                            velDX[idx] = (float)(velDX[idx] - dvx * shareB * wB);
                            velDY[idx] = (float)(velDY[idx] - dvy * shareB * wB);
                            velDZ[idx] = (float)(velDZ[idx] - dvz * shareB * wB);
                        }
                    }
                }
            }

            return anyHit ? 1 : 0;
        }
    }
}
