// Scalp paint: the hair-coloured layer painted on the skin under the locks (fades, sideburn stubble, scalp under thin hair).
// Mirrors the web overlay (src/engine/scalpPaintMaterial.ts) and the curve evaluation in src/engine/scalpPaint.ts.
// The mesh is a thin shell over the head skin built by AetherStrandScalpPaint.cs; UV1.xyz is the web head-pivot-local position.
Shader "AetherStrand/ScalpPaint"
{
    Properties
    {
        _Color ("Paint Colour (default: the hair colour; set any colour to tint the hairline)", Color) = (0.19, 0.136, 0.108, 1)
        [NoScaleOffset] _Curves ("Paint Curves (R full, G edge, B edge density; one texel per azimuth bin)", 2D) = "black" {}
        _Feather ("Cut Line Feather (rad)", Range(0.001, 0.2)) = 0.065
        _Density ("Overall Density", Range(0, 1)) = 1
        _Grain ("Fibre Grain (staggered short hairs)", Range(0, 1)) = 0.55
        _GrainStretch ("Fibre Length Along The Comb", Range(1, 12)) = 8
        _Irregularity ("Hairline Irregularity", Range(0, 1)) = 0.5
        _Streaks ("Strand Streaks", Range(0, 1)) = 1
        _UnderShade ("Shade Under The Hair", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "RenderType" = "Transparent" "Queue" = "Transparent-10" }
        Pass
        {
            Name "ScalpPaint"
            Tags { "LightMode" = "UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Offset -2, -2
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            TEXTURE2D(_Curves); SAMPLER(sampler_Curves);
            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                float _Feather, _Density, _Grain, _GrainStretch, _Irregularity, _Streaks, _UnderShade;
            CBUFFER_END

            // web scalp ellipsoid (HEAD_CENTER_LOCAL, SCALP_RX/RY/RZ)
            static const float3 HC = float3(0.0, 0.425, -0.01);
            static const float3 RADII = float3(0.282, 0.318, 0.31);

            struct A { float4 pos : POSITION; float3 nrm : NORMAL; float3 web : TEXCOORD1; };
            struct V { float4 cs : SV_POSITION; float3 web : TEXCOORD0; float3 nW : TEXCOORD1; float3 pW : TEXCOORD2; };

            V vert(A i)
            {
                V o;
                o.cs = TransformObjectToHClip(i.pos.xyz);
                o.pW = TransformObjectToWorld(i.pos.xyz);
                o.web = i.web;
                o.nW = TransformObjectToWorldNormal(i.nrm);
                return o;
            }

            // mirrors paintHash / hairlineJag / paintStreak in src/engine/scalpPaint.ts
            float h11(float i) { float t = frac(i * 0.1031); t *= t + 33.33; t *= t + t; return frac(t); }
            float vnoise(float az, float cells)
            {
                float x = (az + PI) / (2.0 * PI) * cells;
                float i = floor(x), f = x - i;
                float a = h11(fmod(i, cells)), b = h11(fmod(i + 1.0, cells));
                return lerp(a, b, f * f * (3.0 - 2.0 * f));
            }

            // mirrors paintFibreAlpha in src/engine/scalpPaint.ts: directional short-hair fibres in two octaves,
            // box-filtered by the pixel footprint (fwAz) so they fade to their mean coverage instead of shimmering
            float BandCov(float d, float hw, float r) { return saturate((min(d + r, hw) - max(d - r, -hw)) / (2.0 * r)); }
            float FibreOctave(float az, float phi, float dens, float grain, float freq, float stretch, float stagAmp,
                              float w0, float w1, float d0, float d1, float c1, float3 kA, float2 kB, float fwLane)
            {
                float x = az * freq, lane = floor(x), f = x - lane;
                float row = floor(phi * (freq / stretch) + h11(lane * kA.x + kA.y) * kA.z);
                float stag = h11(lane * kB.x + row * kB.y);
                float localD = saturate(dens + (stag - 0.5) * stagAmp * grain);
                float hw = lerp(w0, w1, smoothstep(d0, d1, localD));
                float r = max(0.08, fwLane * 0.5);
                float fib = r < 0.5 ? BandCov(abs(f - 0.5), hw, r) : 2.0 * hw;
                float lanes = lerp(fib, 2.0 * hw, smoothstep(0.35, 0.5, r));
                return lanes * smoothstep(0.02, c1, localD);
            }
            float PaintFibreAlpha(float az, float phi, float dens, float grain, float stretch, float fwAz)
            {
                if (dens <= 0.002) return 0.0;
                if (dens >= 0.995) return 1.0;
                float st = max(2.0, stretch);
                float c1 = FibreOctave(az, phi, dens, grain, 260.0, st, 0.34, 0.14, 0.5, 0.05, 0.85, 0.28, float3(2.91, 37.3, 4.0), float2(3.17, 17.13), fwAz * 260.0);
                float c2 = FibreOctave(az, phi, dens, grain, 680.0, st * 1.25, 0.38, 0.12, 0.48, 0.04, 0.82, 0.24, float3(4.13, 19.1, 6.0), float2(5.71, 23.41), fwAz * 680.0);
                return saturate(lerp(pow(max(dens, 1e-4), 0.9), lerp(c1, c2, 0.45), min(0.85, grain * 0.78)));
            }

            // mirrors paintRamp in src/engine/scalpPaint.ts: one smooth monotone curve 1 -> ed (at edge) -> 0 (at edge + feather)
            float PaintRamp(float phi, float full, float edge, float ed, float feather)
            {
                if (phi <= full) return 1.0;
                float x2 = edge + max(1e-4, feather);
                if (phi >= x2) return 0.0;
                float h0 = max(1e-4, edge - full), h1 = x2 - edge;
                float s0 = (ed - 1.0) / h0, s1 = -ed / h1;
                float m1 = (s0 < 0.0 && s1 < 0.0) ? 2.0 * s0 * s1 / (s0 + s1) : 0.0;
                float t, ya, yb, ma, mb, h;
                if (phi <= edge) { t = (phi - full) / h0; ya = 1.0; yb = ed; ma = 0.0; mb = m1; h = h0; }
                else { t = (phi - edge) / h1; ya = ed; yb = 0.0; ma = m1; mb = 0.0; h = h1; }
                float t2 = t * t, t3 = t2 * t;
                return saturate((2.0 * t3 - 3.0 * t2 + 1.0) * ya + (t3 - 2.0 * t2 + t) * h * ma + (-2.0 * t3 + 3.0 * t2) * yb + (t3 - t2) * h * mb);
            }

            half4 frag(V i) : SV_Target
            {
                float3 d = (i.web - HC) / RADII;
                float r = max(1e-6, length(d));
                float az = atan2(d.x, d.z);
                float phi = acos(clamp(d.y / r, -1.0, 1.0));
                // seam-safe azimuth footprint (az jumps by 2 pi at the back), taken before any clip
                float fwAz = min(fwidth(az), fwidth(fmod(az + 2.0 * PI, 2.0 * PI)));
                phi -= _Irregularity * 0.008 * (vnoise(az, 28.0) - 0.5) * 2.0; // hairlineJag
                float3 c = SAMPLE_TEXTURE2D(_Curves, sampler_Curves, float2((az + PI) / (2.0 * PI), 0.5)).rgb;
                float full = c.r, edge = max(c.r + 1e-4, c.g), ed = c.b;
                float dens = PaintRamp(phi, full, edge, ed, _Feather) * _Density;
                clip(dens - 0.002);
                float a = PaintFibreAlpha(az, phi, dens, _Grain, _GrainStretch, fwAz);
                clip(a - 0.004);
                // paintStreak: short strands combed along phi
                float ia = floor((az + PI) / 0.006);
                float sy = phi / 0.03, ib = floor(sy), sf = sy - ib;
                float streak = lerp(h11(ia * 157.0 + ib * 113.0), h11(ia * 157.0 + (ib + 1.0) * 113.0), sf * sf * (3.0 - 2.0 * sf));
                float sk = lerp(1.0, 0.82 + 0.36 * streak, _Streaks);
                // mirrors paintUnderShade: darker under the hair (UNDER_SHADE_BAND 0.32); the lit forehead takes 55% less
                float front = smoothstep(0.0, 1.0, (0.95 - abs(az)) / 0.6);
                float cavity = 1.0 - smoothstep(full - 0.32, full + 0.02, phi);
                sk *= 1.0 - _UnderShade * (1.0 - 0.55 * front) * cavity;
                Light L = GetMainLight();
                float3 N = normalize(i.nW);
                float ndl = clamp(dot(N, L.direction) * 0.5 + 0.6, 0.35, 1.0);
                // mirrors paintSheen: broad strand highlight on the downward comb tangent
                float3 T = normalize(float3(N.x * N.y, -1.0 + N.y * N.y, N.z * N.y) + float3(0.0, -1e-5, 0.0));
                float th = clamp(dot(T, normalize(L.direction + GetWorldSpaceNormalizeViewDir(i.pW))), -1.0, 1.0);
                float sheen = 0.08 * pow(sqrt(max(0.0, 1.0 - th * th)), 10.0) * smoothstep(0.15, 0.85, dens);
                half3 col = (_Color.rgb * ndl * max(0.6h, (half3)L.color) + _Color.rgb * SampleSH(N) * 0.25h) * sk + _Color.rgb * sheen;
                return half4(col, a);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
