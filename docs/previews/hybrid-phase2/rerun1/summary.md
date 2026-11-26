# Hybrid proof, 2026-11-25 20:45

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7884 tris.

| res | alpha | camera | hair | GPU ms/frame (median, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.76 (none 0.20) | 1.82 (none 0.39) | 1.56 | see TAA row | 0.0198 (raw 0.0300, peak 0.0458) | 0 | 1 from f28 (0) | 16.24 |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.71 (none 0.20) | 1.78 (none 0.39) | 1.51 | see TAA row | 0.0227 (raw 0.0329, peak 0.0477) | 0 | 0 (0) | 17.07 |
| 1080p | MSAA 4x + A2C | mid | Baseline | 1.28 (none 0.18) | 0.98 (none 0.36) | 1.10 | see TAA row | 0.0027 (raw 0.0066, peak 0.0086) | 0 | 0 (0) | 16.16 |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 1.33 (none 0.18) | 1.48 (none 0.36) | 1.15 | see TAA row | 0.0031 (raw 0.0069, peak 0.0088) | 0 | 0 (0) | 16.97 |
| 1080p | clip + dither + TAA | close | Baseline | 1.28 (none 0.12) | 1.27 (none 0.27) | 1.16 | 13.5 / 32.0 / 68 | 0.0211 (raw 0.0324, peak 0.0479) | 0 | 0 (0) | 16.24 |
| 1080p | clip + dither + TAA | close | Hybrid | 1.54 (none 0.12) | 1.71 (none 0.27) | 1.42 | 12.0 / 32.0 / 58 | 0.0243 (raw 0.0356, peak 0.0492) | 0 | 0 (0) | 17.21 |
| 1080p | clip + dither + TAA | mid | Baseline | 1.23 (none 0.10) | 1.33 (none 0.23) | 1.13 | 17.1 / 44.0 / 86 | 0.0029 (raw 0.0080, peak 0.0101) | 0 | 0 (0) | 16.31 |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.84 (none 0.10) | 0.93 (none 0.23) | 0.74 | 15.3 / 42.0 / 94 | 0.0034 (raw 0.0085, peak 0.0109) | 0 | 0 (0) | 17.18 |
| 1440p | MSAA 4x + A2C | close | Baseline | 2.12 (none 0.27) | 2.20 (none 0.48) | 1.85 | see TAA row | 0.0202 (raw 0.0305, peak 0.0461) | 0 | 0 (0) | 16.36 |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.72 (none 0.27) | 2.08 (none 0.48) | 1.45 | see TAA row | 0.0233 (raw 0.0337, peak 0.0496) | 0 | 0 (0) | 17.18 |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.41 (none 0.25) | 1.47 (none 0.46) | 1.16 | see TAA row | 0.0028 (raw 0.0068, peak 0.0089) | 0 | 0 (0) | 16.11 |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.11 (none 0.25) | 1.60 (none 0.46) | 0.86 | see TAA row | 0.0032 (raw 0.0072, peak 0.0090) | 0 | 0 (0) | 17.03 |
| 1440p | clip + dither + TAA | close | Baseline | 1.87 (none 0.14) | 1.83 (none 0.28) | 1.73 | 13.5 / 32.0 / 70 | 0.0212 (raw 0.0324, peak 0.0474) | 0 | 1 from f4 (0) | 16.20 |
| 1440p | clip + dither + TAA | close | Hybrid | 1.74 (none 0.14) | 1.79 (none 0.28) | 1.60 | 12.1 / 32.0 / 58 | 0.0248 (raw 0.0359, peak 0.0506) | 0 | 1 from f126 (0) | 17.12 |
| 1440p | clip + dither + TAA | mid | Baseline | 0.91 (none 0.12) | 0.94 (none 0.27) | 0.79 | 17.1 / 44.0 / 86 | 0.0030 (raw 0.0079, peak 0.0099) | 0 | 0 (0) | 16.20 |
| 1440p | clip + dither + TAA | mid | Hybrid | 1.37 (none 0.12) | 1.50 (none 0.27) | 1.25 | 15.3 / 42.0 / 88 | 0.0035 (raw 0.0084, peak 0.0106) | 0 | 0 (0) | 17.06 |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
