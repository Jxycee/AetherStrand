# Hybrid proof, 2026-11-25 19:09

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7884 tris.

| res | alpha | camera | hair | GPU ms/frame (median, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | solver+mesh CPU ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.38 (none 0.20) | 1.47 (none 0.40) | 1.18 | see TAA row | NaN (raw NaN, peak NaN) | 0 | 16.31 |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.36 (none 0.20) | 1.79 (none 0.40) | 1.16 | see TAA row | 0.0227 (raw 0.0329, peak 0.0477) | 0 | 17.02 |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.84 (none 0.18) | 1.05 (none 0.35) | 0.66 | see TAA row | 0.0027 (raw 0.0066, peak 0.0086) | 0 | 16.21 |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.91 (none 0.18) | 1.09 (none 0.35) | 0.74 | see TAA row | 0.0031 (raw 0.0069, peak 0.0088) | 0 | 17.21 |
| 1080p | clip + dither + TAA | close | Baseline | 1.17 (none 0.12) | 1.22 (none 0.27) | 1.05 | 13.5 / 32.0 / 68 | 0.0211 (raw 0.0324, peak 0.0479) | 0 | 16.28 |
| 1080p | clip + dither + TAA | close | Hybrid | 1.19 (none 0.12) | 1.24 (none 0.27) | 1.08 | 12.0 / 32.0 / 58 | 0.0243 (raw 0.0356, peak 0.0492) | 0 | 17.17 |
| 1080p | clip + dither + TAA | mid | Baseline | 0.76 (none 0.10) | 0.88 (none 0.34) | 0.66 | 17.1 / 44.0 / 86 | 0.0029 (raw 0.0080, peak 0.0101) | 0 | 16.28 |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.77 (none 0.10) | 0.87 (none 0.34) | 0.67 | 15.3 / 42.0 / 94 | 0.0034 (raw 0.0085, peak 0.0109) | 0 | 17.21 |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.86 (none 0.29) | 2.12 (none 0.52) | 1.57 | see TAA row | 0.0202 (raw 0.0305, peak 0.0461) | 0 | 16.36 |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.74 (none 0.29) | 1.89 (none 0.52) | 1.46 | see TAA row | 0.0233 (raw 0.0337, peak 0.0496) | 0 | 17.18 |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.09 (none 0.24) | 1.23 (none 0.47) | 0.85 | see TAA row | 0.0028 (raw 0.0068, peak 0.0089) | 0 | 16.17 |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.44 (none 0.24) | 1.65 (none 0.47) | 1.20 | see TAA row | 0.0032 (raw 0.0072, peak 0.0090) | 0 | 17.06 |
| 1440p | clip + dither + TAA | close | Baseline | 1.49 (none 0.14) | 1.54 (none 0.29) | 1.35 | 13.5 / 32.0 / 70 | NaN (raw NaN, peak NaN) | 0 | 16.20 |
| 1440p | clip + dither + TAA | close | Hybrid | 1.44 (none 0.14) | 1.49 (none 0.29) | 1.30 | 12.1 / 32.0 / 58 | NaN (raw NaN, peak NaN) | 0 | 17.03 |
| 1440p | clip + dither + TAA | mid | Baseline | 0.85 (none 0.11) | 0.98 (none 0.29) | 0.74 | 17.1 / 44.0 / 86 | 0.0030 (raw 0.0079, peak 0.0099) | 0 | 16.14 |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.83 (none 0.11) | 1.03 (none 0.29) | 0.72 | 15.3 / 42.0 / 88 | 0.0035 (raw 0.0084, peak 0.0106) | 0 | 17.09 |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
