# Hybrid proof, 2026-11-26 12:34 (editor play mode)

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7865 tris. Hybrid mass conformed to skull: 3755/3997 vertices moved over 0.2 web-mm; largest push out 26.2 web-mm, in 30.9 web-mm.

## Ear isolation

Panels, left to right then down: all | paint only | mass + paint | mass flat grey, no paint | locks + cards + paint | nothing (skin).

- Paint _Color sRGB 0.247, 0.220, 0.200 (linear 0.050, 0.040, 0.033)
- Main light key: colour 1.000, 0.976, 0.941 x intensity 0.812, direction to light (-0.324, 0.724, 0.609) (web paint uses (-0.4, 0.8, 0.6) normalised, colour 1)
- Ambient (SH) on the left side of the head: 0.020, 0.022, 0.024 (the Unity paint adds 0.25 x this; the web adds none)
- Ambient mode Trilight, intensity 1.000

## Depth prepass

Hybrid at rest, 1080p close. Changed = hair pixels whose linear luminance moved over 0.02 against the matrix render; holes = hair pixels that now show what is behind the hair. Priming restored to Disabled afterwards.

| alpha | variant | hair px | changed % | holes % | mean abs diff (linear lum) |
|---|---|---|---|---|---|
| MSAA 4x + A2C | matrix render | 680643 | 0 | 0 | 0 |
| MSAA 4x + A2C | depth texture | 680643 | 0.00 | 0.00 | 0.0000 |
| MSAA 4x + A2C | priming forced | 680643 | 0.00 | 0.00 | 0.0000 |
| clip | matrix render | 673286 | 0 | 0 | 0 |
| clip | depth texture | 673286 | 0.00 | 0.00 | 0.0000 |
| clip | priming forced | 673286 | 0.00 | 0.00 | 0.0000 |

Images: depth_<alpha>.png = matrix render | depth texture | priming forced (tone mapped); depth_<alpha>_diff_x8.png = |last variant - matrix| x 8. Where priming made no difference at all, URP may have turned it off for this camera (it does with some MSAA set-ups), which this check cannot see.

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.45 / 1.98 (none 0.19 / 0.21) | 1.52 (none 0.48) | 1.27 | see TAA row | 0.0202 (raw 0.0304, peak 0.0463) | 0 | 0 (0) | 8.75 (5.37 / 3.34) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.38 / 1.83 (none 0.19 / 0.21) | 1.81 (none 0.48) | 1.20 | see TAA row | 0.0224 (raw 0.0326, peak 0.0475) | 0 | 0 (0) | 9.58 (5.22 / 4.34) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.26 / 1.39 (none 0.19 / 0.21) | 1.43 (none 0.48) | 1.07 | see TAA row | 0.0225 (raw 0.0328, peak 0.0486) | 0 | 0 (0) | 9.57 (5.23 / 4.33) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.25 / 0.27 (none 0.19 / 0.21) | 0.40 (none 0.48) | 0.06 | see TAA row | 0.0025 (raw 0.0128, peak 0.0238) | 0 | 0 (0) | 9.63 (5.25 / 4.35) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.86 / 1.00 (none 0.17 / 0.18) | 0.99 (none 0.37) | 0.69 | see TAA row | 0.0028 (raw 0.0067, peak 0.0086) | 0 | 0 (0) | 8.70 (5.37 / 3.25) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.88 / 1.00 (none 0.17 / 0.18) | 1.05 (none 0.37) | 0.71 | see TAA row | 0.0031 (raw 0.0069, peak 0.0090) | 0 | 0 (0) | 9.70 (5.26 / 4.38) |
| 1080p | clip + dither + TAA | close | Baseline | 1.21 / 1.36 (none 0.11 / 0.12) | 1.31 (none 0.30) | 1.10 | 13.3 / 32.0 / 70 | 0.0213 (raw 0.0326, peak 0.0486) | 0 | 0 (0) | 8.76 (5.39 / 3.30) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.25 / 1.67 (none 0.11 / 0.12) | 1.30 (none 0.30) | 1.15 | 12.0 / 32.0 / 58 | 0.0241 (raw 0.0354, peak 0.0498) | 0 | 0 (0) | 9.74 (5.25 / 4.43) |
| 1080p | clip + dither + TAA | mid | Baseline | 0.73 / 0.84 (none 0.09 / 0.10) | 0.84 (none 0.31) | 0.64 | 16.9 / 44.0 / 84 | 0.0030 (raw 0.0081, peak 0.0106) | 0 | 0 (0) | 8.70 (5.37 / 3.27) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.80 / 1.35 (none 0.09 / 0.10) | 0.91 (none 0.31) | 0.70 | 15.2 / 42.0 / 92 | 0.0034 (raw 0.0085, peak 0.0111) | 0 | 0 (0) | 9.64 (5.22 / 4.46) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.79 / 2.00 (none 0.27 / 0.30) | 1.97 (none 0.47) | 1.51 | see TAA row | 0.0205 (raw 0.0309, peak 0.0469) | 0 | 0 (0) | 8.70 (5.34 / 3.39) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.76 / 2.06 (none 0.27 / 0.30) | 1.87 (none 0.47) | 1.49 | see TAA row | 0.0231 (raw 0.0335, peak 0.0483) | 0 | 0 (0) | 9.58 (5.22 / 4.36) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.41 / 1.59 (none 0.23 / 0.26) | 1.62 (none 0.41) | 1.18 | see TAA row | 0.0029 (raw 0.0069, peak 0.0087) | 0 | 0 (0) | 8.67 (5.37 / 3.27) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.10 / 1.48 (none 0.23 / 0.26) | 1.31 (none 0.41) | 0.87 | see TAA row | 0.0032 (raw 0.0071, peak 0.0092) | 0 | 0 (0) | 9.64 (5.22 / 4.39) |
| 1440p | clip + dither + TAA | close | Baseline | 1.57 / 2.02 (none 0.13 / 0.14) | 1.56 (none 0.30) | 1.44 | 13.3 / 32.0 / 70 | 0.0216 (raw 0.0328, peak 0.0480) | 0 | 0 (0) | 8.73 (5.37 / 3.30) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.73 / 1.94 (none 0.13 / 0.14) | 1.88 (none 0.30) | 1.60 | 12.0 / 32.0 / 58 | 0.0249 (raw 0.0361, peak 0.0509) | 0 | 0 (0) | 9.61 (5.25 / 4.36) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.83 / 0.93 (none 0.10 / 0.11) | 0.98 (none 0.36) | 0.72 | 16.9 / 44.0 / 86 | 0.0031 (raw 0.0080, peak 0.0102) | 0 | 0 (0) | 8.64 (5.37 / 3.27) |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.88 / 1.44 (none 0.10 / 0.11) | 1.12 (none 0.36) | 0.78 | 15.2 / 42.0 / 90 | 0.0035 (raw 0.0083, peak 0.0107) | 0 | 0 (0) | 9.67 (5.22 / 4.49) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
