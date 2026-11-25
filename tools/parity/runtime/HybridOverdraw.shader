// Scratch (NOT game code): counts rasterised hair layers for HybridProofRunner. Additive, no depth write, depth-tested
// against the opaque body, both faces. Counts every fragment the hair geometry rasterises, including ones the hair
// shader would clip away (their shading still runs), so it is an upper bound on hair overdraw.
Shader "Hidden/AetherStrand/ParityOverdraw"
{
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent" "RenderType" = "Transparent" }
        Pass
        {
            Tags { "LightMode" = "UniversalForward" }
            ZWrite Off
            ZTest LEqual
            Cull Off
            Blend One One
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionCS : SV_POSITION; };
            Varyings Vert(Attributes a) { Varyings o; o.positionCS = TransformObjectToHClip(a.positionOS.xyz); return o; }
            half4 Frag(Varyings i) : SV_Target { return half4(1.0 / 32.0, 0, 0, 0); }
            ENDHLSL
        }
    }
}
