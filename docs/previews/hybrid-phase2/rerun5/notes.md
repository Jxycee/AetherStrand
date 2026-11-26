# Rerun 5 notes (hand checks, beside summary.md)

Commit tested: 3e5b11d. Editor play mode, same set-up as rerun 4. The player build backend is Mono (Mono2x).
The `close_*` images were rendered by a one-off editor script at MSAA 4x + A2C, not by the proof runner.

## Shader compile
All passes of both shaders compile for D3D11, including the Built-in fallback SubShader, with A2C off and on.
One warning: `AetherStrand_ScalpPaint.shader:92 pow(f, e) will not work for negative f` (`pow(dens, 0.9)`;
the function returns early when `dens <= 0.002`, so it cannot be negative).

## Hairline speckle (close_tips_hairline.png, close_fadecap_test.png, close_tips_r4_vs_r5.png)
Dot clouds are still there at the hairline and temple, essentially the same as rerun 4 (r4 left, r5 right).
They stay with the paint hidden, are not from the mass, and show with A2C on or off. Removing only the
fade-cap triangles (vertex alpha 0.15 to 0.45) removes them (close_fadecap_test.png, before | after).
So they come from the fade-cap screen-space dither in `AetherTipMargin`, which is always clipped and was not
part of the issue #6 change.

## Paint (close_paint_ear_nape.png, close_paint_frames_x4.png)
Reads as short fibres, not dots. close_paint_ear_nape.png is hair + paint | paint only. At the hairline the
fibres are very evenly spaced (comb-like). close_paint_frames_x4.png is three consecutive frames, old paint
shader (top) and new (bottom).

Paint shimmer, paint only (hair hidden, head at rest, proof close camera path, frames 45 to 105). Mean
|f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the pixels the new paint changes; same mask for all three.
The old paint is the 783176e shader with its old values (feather 0.07, grain 0.5, stretch 1, cell 0.004).

| res | bare skin | old paint | new paint |
|---|---|---|---|
| 1080p | 0.0067 | 0.0280 | 0.0216 |
| 1440p | 0.0069 | 0.0280 | 0.0242 |

This is a measurement and frame inspection; the video was not watched in real time.
