// Scalp paint: the hair-coloured layer painted on the skin under the locks (fades, sideburn stubble, scalp under thin hair).
// Mirrors the web overlay (src/engine/scalpPaintMaterial.ts) and the curve evaluation in src/engine/scalpPaint.ts.
// The mesh is a thin shell over the head skin built by AetherStrandScalpPaint.cs; UV1.xyz is the web head-pivot-local position.
Shader "AetherStrand/ScalpPaint"
{
    Properties
    {
        _Color ("Paint Colour (default: the hair colour; set any colour to tint the hairline)", Color) = (0.19, 0.136, 0.108, 1)
        [NoScaleOffset] _Curves ("Paint Curves (R full, G edge, B edge density; one texel per azimuth bin)", 2D) = "black" {}
        _Feather ("Cut Line Feather (rad)", Range(0.001, 0.2)) = 0.035
        _Density ("Overall Density", Range(0, 1)) = 1
        _Grain ("Stubble Grain", Range(0, 1)) = 0.5
        _GrainCell ("Grain Cell (rad)", Range(0.001, 0.02)) = 0.004
        _Irregularity ("Hairline Irregularity", Range(0, 1)) = 0.5
        _Streaks ("Strand Streaks", Range(0, 1)) = 1
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
                float _Feather, _Density, _Grain, _GrainCell, _Irregularity, _Streaks;
            CBUFFER_END

            // web scalp ellipsoid (HEAD_CENTER_LOCAL, SCALP_RX/RY/RZ)
            static const float3 HC = float3(0.0, 0.425, -0.01);
            static const float3 RADII = float3(0.282, 0.318, 0.31);

            struct A { float4 pos : POSITION; float3 nrm : NORMAL; float3 web : TEXCOORD1; };
            struct V { float4 cs : SV_POSITION; float3 web : TEXCOORD0; float3 nW : TEXCOORD1; };

            V vert(A i)
            {
                V o;
                o.cs = TransformObjectToHClip(i.pos.xyz);
                o.web = i.web;
                o.nW = TransformObjectToWorldNormal(i.nrm);
                return o;
            }

            float hash21(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
            // mirrors paintHash / hairlineJag / paintStreak in src/engine/scalpPaint.ts
            float h11(float i) { float t = frac(i * 0.1031); t *= t + 33.33; t *= t + t; return frac(t); }
            float vnoise(float az, float cells)
            {
                float x = (az + PI) / (2.0 * PI) * cells;
                float i = floor(x), f = x - i;
                float a = h11(fmod(i, cells)), b = h11(fmod(i + 1.0, cells));
                return lerp(a, b, f * f * (3.0 - 2.0 * f));
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
                phi -= _Irregularity * (0.024 * (vnoise(az, 150.0) - 0.5) * 2.0 + 0.011 * (vnoise(az, 440.0) - 0.5) * 2.0);
                float3 c = SAMPLE_TEXTURE2D(_Curves, sampler_Curves, float2((az + PI) / (2.0 * PI), 0.5)).rgb;
                float full = c.r, edge = max(c.r + 1e-4, c.g), ed = c.b;
                float dens = PaintRamp(phi, full, edge, ed, _Feather) * _Density;
                clip(dens - 0.002);
                // scalpPaintAlpha: a soft gradient mixed with stipple by grain, so the edge blends into the skin
                float n = 0.5 + (hash21(floor(float2(az, phi) / _GrainCell)) - 0.5) * min(1.0, _Grain + 0.2);
                float stip = smoothstep(n - 0.14, n + 0.14, dens);
                float a = dens >= 0.999 ? 1.0 : lerp(pow(dens, 0.85), stip, min(1.0, _Grain * 0.5));
                clip(a - 0.01);
                // paintStreak: short strands combed along phi
                float ia = floor((az + PI) / 0.006);
                float sy = phi / 0.03, ib = floor(sy), sf = sy - ib;
                float streak = lerp(h11(ia * 157.0 + ib * 113.0), h11(ia * 157.0 + (ib + 1.0) * 113.0), sf * sf * (3.0 - 2.0 * sf));
                float sk = lerp(1.0, 0.82 + 0.36 * streak, _Streaks);
                Light L = GetMainLight();
                float ndl = clamp(dot(normalize(i.nW), L.direction) * 0.5 + 0.6, 0.35, 1.0);
                half3 col = (_Color.rgb * ndl * max(0.6h, (half3)L.color) + _Color.rgb * SampleSH(normalize(i.nW)) * 0.25h) * sk;
                return half4(col, a);
            }
            ENDHLSL
        }
    }
    FallBack Off
}
