# Hybrid proof, 2026-11-26 11:10 (standalone player, release build)

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7884 tris. Hybrid mass conformed to skull: 3764/4006 vertices moved over 0.2 web-mm; largest push out 26.2 web-mm, in 30.9 web-mm.

## Depth prepass

Hybrid at rest, 1080p close. Changed = hair pixels whose linear luminance moved over 0.02 against the matrix render; holes = hair pixels that now show what is behind the hair. Priming restored to Disabled afterwards.

| alpha | variant | hair px | changed % | holes % | mean abs diff (linear lum) |
|---|---|---|---|---|---|
| MSAA 4x + A2C | matrix render | 661405 | 0 | 0 | 0 |
| MSAA 4x + A2C | depth texture | 661405 | 0.00 | 0.00 | 0.0000 |
| MSAA 4x + A2C | priming forced | 661405 | 0.00 | 0.00 | 0.0000 |
| clip | matrix render | 658985 | 0 | 0 | 0 |
| clip | depth texture | 658985 | 0.00 | 0.00 | 0.0000 |
| clip | priming forced | 658985 | 0.00 | 0.00 | 0.0000 |

Images: depth_<alpha>.png = matrix render | depth texture | priming forced (tone mapped); depth_<alpha>_diff_x8.png = |last variant - matrix| x 8. Where priming made no difference at all, URP may have turned it off for this camera (it does with some MSAA set-ups), which this check cannot see.

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.26 / 1.45 (none 0.14 / 0.16) | 1.32 (none 0.26) | 1.11 | see TAA row | 0.0198 (raw 0.0300, peak 0.0453) | 0 | 0 (0) | 16.29 (7.36 / 8.89) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.26 / 1.75 (none 0.14 / 0.16) | 1.30 (none 0.26) | 1.11 | see TAA row | 0.0224 (raw 0.0326, peak 0.0474) | 0 | 0 (0) | 17.17 (7.27 / 9.88) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.20 / 1.59 (none 0.14 / 0.16) | 1.60 (none 0.26) | 1.05 | see TAA row | 0.0224 (raw 0.0327, peak 0.0463) | 0 | 0 (0) | 17.47 (7.33 / 10.15) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.18 / 0.19 (none 0.14 / 0.16) | 0.27 (none 0.26) | 0.03 | see TAA row | 0.0029 (raw 0.0131, peak 0.0248) | 0 | 0 (0) | 17.64 (7.31 / 10.36) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.76 / 0.87 (none 0.11 / 0.12) | 0.93 (none 0.21) | 0.65 | see TAA row | 0.0027 (raw 0.0065, peak 0.0085) | 0 | 0 (0) | 16.42 (7.39 / 8.99) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.76 / 0.86 (none 0.11 / 0.12) | 0.92 (none 0.21) | 0.66 | see TAA row | 0.0031 (raw 0.0069, peak 0.0088) | 0 | 0 (0) | 17.58 (7.31 / 10.27) |
| 1080p | clip + dither + TAA | close | Baseline | 1.07 / 1.21 (none 0.05 / 0.06) | 1.11 (none 0.14) | 1.02 | 13.5 / 32.0 / 68 | 0.0209 (raw 0.0321, peak 0.0466) | 0 | 0 (0) | 16.48 (7.37 / 9.00) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.13 / 1.34 (none 0.05 / 0.06) | 1.13 (none 0.14) | 1.08 | 12.2 / 32.0 / 60 | 0.0243 (raw 0.0356, peak 0.0504) | 0 | 0 (0) | 17.58 (7.32 / 10.28) |
| 1080p | clip + dither + TAA | mid | Baseline | 0.65 / 0.74 (none 0.04 / 0.07) | 0.70 (none 0.17) | 0.61 | 17.1 / 44.0 / 86 | 0.0029 (raw 0.0080, peak 0.0103) | 0 | 0 (0) | 16.42 (7.29 / 9.19) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.68 / 0.78 (none 0.04 / 0.07) | 0.75 (none 0.17) | 0.64 | 15.3 / 42.0 / 94 | 0.0034 (raw 0.0085, peak 0.0109) | 0 | 0 (0) | 17.27 (7.26 / 9.98) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.63 / 1.84 (none 0.20 / 0.27) | 1.78 (none 0.33) | 1.43 | see TAA row | 0.0200 (raw 0.0304, peak 0.0457) | 0 | 0 (0) | 16.54 (7.35 / 9.25) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.57 / 1.77 (none 0.20 / 0.27) | 1.67 (none 0.33) | 1.37 | see TAA row | 0.0231 (raw 0.0334, peak 0.0485) | 0 | 0 (0) | 17.27 (7.29 / 9.95) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 0.94 / 1.05 (none 0.17 / 0.18) | 1.10 (none 0.31) | 0.78 | see TAA row | 0.0028 (raw 0.0067, peak 0.0087) | 0 | 0 (0) | 16.17 (7.29 / 8.82) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 0.91 / 1.00 (none 0.17 / 0.18) | 1.08 (none 0.31) | 0.74 | see TAA row | 0.0032 (raw 0.0072, peak 0.0090) | 0 | 0 (0) | 17.27 (7.29 / 9.86) |
| 1440p | clip + dither + TAA | close | Baseline | 1.38 / 1.59 (none 0.07 / 0.08) | 1.41 (none 0.23) | 1.31 | 13.5 / 32.0 / 68 | 0.0214 (raw 0.0325, peak 0.0472) | 0 | 0 (0) | 16.17 (7.29 / 8.82) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.50 / 1.81 (none 0.07 / 0.08) | 1.42 (none 0.23) | 1.43 | 12.2 / 32.0 / 62 | 0.0246 (raw 0.0357, peak 0.0499) | 0 | 0 (0) | 17.33 (7.29 / 9.95) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.75 / 0.85 (none 0.05 / 0.05) | 0.81 (none 0.19) | 0.71 | 17.0 / 44.0 / 86 | 0.0030 (raw 0.0079, peak 0.0098) | 0 | 0 (0) | 16.48 (7.35 / 9.06) |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.75 / 0.84 (none 0.05 / 0.05) | 0.84 (none 0.19) | 0.71 | 15.4 / 42.0 / 92 | 0.0035 (raw 0.0084, peak 0.0106) | 0 | 0 (0) | 17.64 (7.29 / 10.35) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
