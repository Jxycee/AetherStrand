# Hybrid proof, 2026-11-26 12:08 (editor play mode)

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
| MSAA 4x + A2C | matrix render | 677750 | 0 | 0 | 0 |
| MSAA 4x + A2C | depth texture | 677750 | 0.00 | 0.00 | 0.0000 |
| MSAA 4x + A2C | priming forced | 677750 | 0.00 | 0.00 | 0.0000 |
| clip | matrix render | 673286 | 0 | 0 | 0 |
| clip | depth texture | 673286 | 0.00 | 0.00 | 0.0000 |
| clip | priming forced | 673286 | 0.00 | 0.00 | 0.0000 |

Images: depth_<alpha>.png = matrix render | depth texture | priming forced (tone mapped); depth_<alpha>_diff_x8.png = |last variant - matrix| x 8. Where priming made no difference at all, URP may have turned it off for this camera (it does with some MSAA set-ups), which this check cannot see.

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.33 / 1.47 (none 0.19 / 0.21) | 1.50 (none 0.38) | 1.14 | see TAA row | 0.0203 (raw 0.0305, peak 0.0464) | 0 | 0 (0) | 12.20 (7.39 / 4.88) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.31 / 1.44 (none 0.19 / 0.21) | 1.46 (none 0.38) | 1.12 | see TAA row | 0.0225 (raw 0.0328, peak 0.0477) | 0 | 0 (0) | 12.97 (7.16 / 5.81) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.24 / 1.36 (none 0.19 / 0.21) | 1.41 (none 0.38) | 1.06 | see TAA row | 0.0227 (raw 0.0329, peak 0.0488) | 0 | 0 (0) | 13.07 (7.18 / 5.93) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.23 / 0.25 (none 0.19 / 0.21) | 0.41 (none 0.38) | 0.04 | see TAA row | 0.0025 (raw 0.0128, peak 0.0238) | 0 | 0 (0) | 12.99 (7.14 / 5.86) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.83 / 0.93 (none 0.16 / 0.19) | 1.06 (none 0.37) | 0.67 | see TAA row | 0.0028 (raw 0.0067, peak 0.0086) | 0 | 0 (0) | 12.15 (7.34 / 4.78) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.86 / 0.96 (none 0.16 / 0.19) | 1.05 (none 0.37) | 0.69 | see TAA row | 0.0031 (raw 0.0070, peak 0.0091) | 0 | 0 (0) | 13.11 (7.16 / 5.94) |
| 1080p | clip + dither + TAA | close | Baseline | 1.18 / 1.34 (none 0.10 / 0.12) | 1.22 (none 0.28) | 1.08 | 13.3 / 32.0 / 70 | 0.0213 (raw 0.0326, peak 0.0486) | 0 | 0 (0) | 12.25 (7.45 / 4.82) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.21 / 1.39 (none 0.10 / 0.12) | 1.30 (none 0.28) | 1.10 | 12.0 / 32.0 / 58 | 0.0241 (raw 0.0354, peak 0.0498) | 0 | 0 (0) | 13.15 (7.23 / 5.92) |
| 1080p | clip + dither + TAA | mid | Baseline | 1.16 / 1.36 (none 0.09 / 0.10) | 1.27 (none 0.34) | 1.07 | 16.9 / 44.0 / 84 | 0.0030 (raw 0.0081, peak 0.0106) | 0 | 0 (0) | 12.27 (7.39 / 4.91) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.85 / 1.59 (none 0.09 / 0.10) | 0.95 (none 0.34) | 0.76 | 15.2 / 42.0 / 92 | 0.0034 (raw 0.0085, peak 0.0111) | 0 | 0 (0) | 13.06 (7.17 / 5.92) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.83 / 2.23 (none 0.26 / 0.29) | 1.95 (none 0.56) | 1.57 | see TAA row | 0.0207 (raw 0.0310, peak 0.0470) | 0 | 0 (0) | 12.24 (7.39 / 4.85) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 2.03 / 2.17 (none 0.26 / 0.29) | 2.15 (none 0.56) | 1.77 | see TAA row | 0.0233 (raw 0.0336, peak 0.0485) | 0 | 0 (0) | 13.12 (7.23 / 5.89) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.00 / 1.11 (none 0.24 / 0.25) | 1.20 (none 0.47) | 0.75 | see TAA row | 0.0029 (raw 0.0069, peak 0.0087) | 0 | 0 (0) | 12.18 (7.35 / 4.79) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.05 / 1.57 (none 0.24 / 0.25) | 1.37 (none 0.47) | 0.81 | see TAA row | 0.0032 (raw 0.0071, peak 0.0092) | 0 | 0 (0) | 13.03 (7.17 / 5.89) |
| 1440p | clip + dither + TAA | close | Baseline | 1.47 / 1.65 (none 0.13 / 0.14) | 1.58 (none 0.32) | 1.34 | 13.3 / 32.0 / 70 | 0.0216 (raw 0.0328, peak 0.0480) | 0 | 0 (0) | 12.18 (7.35 / 4.88) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.41 / 1.55 (none 0.13 / 0.14) | 1.50 (none 0.32) | 1.28 | 12.0 / 32.0 / 58 | 0.0249 (raw 0.0361, peak 0.0509) | 0 | 0 (0) | 12.97 (7.14 / 5.92) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.86 / 1.00 (none 0.10 / 0.12) | 1.01 (none 0.26) | 0.75 | 16.9 / 44.0 / 86 | 0.0031 (raw 0.0080, peak 0.0102) | 0 | 0 (0) | 12.18 (7.32 / 4.82) |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.82 / 0.95 (none 0.10 / 0.12) | 0.97 (none 0.26) | 0.72 | 15.2 / 42.0 / 90 | 0.0035 (raw 0.0083, peak 0.0107) | 0 | 0 (0) | 13.12 (7.17 / 5.86) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
