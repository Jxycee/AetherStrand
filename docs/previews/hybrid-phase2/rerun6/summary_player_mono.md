# Hybrid proof, 2026-11-26 13:16 (standalone player, release build)

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7865 tris. Hybrid mass conformed to skull: 3755/3997 vertices moved over 0.2 web-mm; largest push out 26.2 web-mm, in 30.9 web-mm.

## Depth prepass

Hybrid at rest, 1080p close. Changed = hair pixels whose linear luminance moved over 0.02 against the matrix render; holes = hair pixels that now show what is behind the hair. Priming restored to Disabled afterwards.

| alpha | variant | hair px | changed % | holes % | mean abs diff (linear lum) |
|---|---|---|---|---|---|
| MSAA 4x + A2C | matrix render | 677280 | 0 | 0 | 0 |
| MSAA 4x + A2C | depth texture | 677280 | 0.00 | 0.00 | 0.0000 |
| MSAA 4x + A2C | priming forced | 677280 | 0.00 | 0.00 | 0.0000 |
| clip | matrix render | 673636 | 0 | 0 | 0 |
| clip | depth texture | 673636 | 0.00 | 0.00 | 0.0000 |
| clip | priming forced | 673636 | 0.00 | 0.00 | 0.0000 |

Images: depth_<alpha>.png = matrix render | depth texture | priming forced (tone mapped); depth_<alpha>_diff_x8.png = |last variant - matrix| x 8. Where priming made no difference at all, URP may have turned it off for this camera (it does with some MSAA set-ups), which this check cannot see.

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.31 / 1.55 (none 0.14 / 0.16) | 1.35 (none 0.24) | 1.17 | see TAA row | 0.0203 (raw 0.0305, peak 0.0467) | 0 | 0 (0) | 8.88 (5.39 / 3.40) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.21 / 1.34 (none 0.14 / 0.16) | 1.27 (none 0.24) | 1.07 | see TAA row | 0.0224 (raw 0.0326, peak 0.0485) | 0 | 0 (0) | 9.77 (5.25 / 4.36) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.20 / 1.38 (none 0.14 / 0.16) | 1.27 (none 0.24) | 1.06 | see TAA row | 0.0224 (raw 0.0326, peak 0.0467) | 0 | 0 (0) | 9.61 (5.22 / 4.36) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.18 / 0.19 (none 0.14 / 0.16) | 0.28 (none 0.24) | 0.03 | see TAA row | 0.0025 (raw 0.0127, peak 0.0238) | 0 | 0 (0) | 9.80 (5.24 / 4.43) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.81 / 1.05 (none 0.11 / 0.12) | 0.96 (none 0.25) | 0.70 | see TAA row | 0.0028 (raw 0.0066, peak 0.0085) | 0 | 0 (0) | 8.70 (5.36 / 3.34) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.80 / 0.94 (none 0.11 / 0.12) | 0.92 (none 0.25) | 0.69 | see TAA row | 0.0031 (raw 0.0069, peak 0.0091) | 0 | 0 (0) | 9.75 (5.23 / 4.44) |
| 1080p | clip + dither + TAA | close | Baseline | 1.11 / 1.27 (none 0.05 / 0.06) | 1.14 (none 0.19) | 1.06 | 13.2 / 32.0 / 68 | 0.0213 (raw 0.0326, peak 0.0480) | 0 | 0 (0) | 8.77 (5.34 / 3.30) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.20 / 1.41 (none 0.05 / 0.06) | 1.15 (none 0.19) | 1.15 | 12.0 / 32.0 / 60 | 0.0244 (raw 0.0357, peak 0.0511) | 0 | 0 (0) | 9.64 (5.22 / 4.41) |
| 1080p | clip + dither + TAA | mid | Baseline | 0.67 / 0.77 (none 0.04 / 0.08) | 0.73 (none 0.15) | 0.63 | 16.9 / 44.0 / 86 | 0.0030 (raw 0.0081, peak 0.0106) | 0 | 0 (0) | 8.58 (5.31 / 3.27) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.70 / 0.83 (none 0.04 / 0.08) | 0.76 (none 0.15) | 0.66 | 15.2 / 42.0 / 94 | 0.0033 (raw 0.0084, peak 0.0112) | 0 | 0 (0) | 9.64 (5.22 / 4.36) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.73 / 1.90 (none 0.20 / 0.29) | 1.76 (none 0.37) | 1.53 | see TAA row | 0.0205 (raw 0.0308, peak 0.0469) | 0 | 0 (0) | 8.94 (5.34 / 3.63) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.57 / 1.74 (none 0.20 / 0.29) | 1.66 (none 0.37) | 1.37 | see TAA row | 0.0230 (raw 0.0334, peak 0.0489) | 0 | 0 (0) | 9.98 (5.22 / 4.85) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 0.94 / 1.03 (none 0.17 / 0.17) | 1.13 (none 0.31) | 0.78 | see TAA row | 0.0029 (raw 0.0069, peak 0.0086) | 0 | 0 (0) | 8.79 (5.34 / 3.33) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.01 / 1.56 (none 0.17 / 0.17) | 1.12 (none 0.31) | 0.84 | see TAA row | 0.0032 (raw 0.0072, peak 0.0092) | 0 | 0 (0) | 9.74 (5.22 / 4.43) |
| 1440p | clip + dither + TAA | close | Baseline | 1.62 / 2.00 (none 0.07 / 0.08) | 1.71 (none 0.18) | 1.54 | 13.2 / 32.0 / 68 | 0.0218 (raw 0.0329, peak 0.0484) | 0 | 0 (0) | 8.76 (5.37 / 3.33) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.63 / 1.83 (none 0.07 / 0.08) | 1.38 (none 0.18) | 1.56 | 12.0 / 32.0 / 62 | 0.0247 (raw 0.0359, peak 0.0503) | 0 | 0 (0) | 9.77 (5.25 / 4.43) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.81 / 1.41 (none 0.05 / 0.06) | 0.95 (none 0.14) | 0.76 | 16.9 / 44.0 / 86 | 0.0031 (raw 0.0079, peak 0.0101) | 0 | 0 (0) | 8.73 (5.34 / 3.33) |
| 1440p | clip + dither + TAA | mid | Hybrid | 1.25 / 1.50 (none 0.05 / 0.06) | 1.36 (none 0.14) | 1.20 | 15.2 / 42.0 / 92 | 0.0035 (raw 0.0083, peak 0.0107) | 0 | 0 (0) | 9.92 (5.22 / 4.55) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
