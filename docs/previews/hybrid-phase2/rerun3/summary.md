# Hybrid proof, 2026-11-25 23:15

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7884 tris. Hybrid mass seated on skin: 2370/4006 vertices found skin, 2310 moved; largest push out 15.0 web-mm, in 15.0 web-mm.

## Ear isolation

Panels, left to right then down: all | paint only | mass + paint | mass flat grey, no paint | locks + cards + paint | nothing (skin).

- Paint _Color sRGB 0.443, 0.398, 0.366 (linear 0.165, 0.132, 0.110)
- Main light key: colour 1.000, 0.976, 0.941 x intensity 0.812, direction to light (-0.324, 0.724, 0.609) (web paint uses (-0.4, 0.8, 0.6) normalised, colour 1)
- Ambient (SH) on the left side of the head: 0.020, 0.022, 0.024 (the Unity paint adds 0.25 x this; the web adds none)
- Ambient mode Trilight, intensity 1.000

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.31 / 1.45 (none 0.19 / 0.21) | 1.48 (none 0.37) | 1.12 | see TAA row | 0.0196 (raw 0.0298, peak 0.0452) | 0 | 0 (0) | 16.13 (7.33 / 8.87) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.32 / 1.49 (none 0.19 / 0.21) | 1.43 (none 0.37) | 1.13 | see TAA row | 0.0227 (raw 0.0330, peak 0.0487) | 0 | 0 (0) | 17.11 (7.18 / 9.91) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.25 / 1.36 (none 0.19 / 0.21) | 1.38 (none 0.37) | 1.06 | see TAA row | 0.0230 (raw 0.0332, peak 0.0478) | 0 | 0 (0) | 17.04 (7.16 / 9.93) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.25 / 0.28 (none 0.19 / 0.21) | 0.43 (none 0.37) | 0.06 | see TAA row | 0.0034 (raw 0.0137, peak 0.0259) | 0 | 0 (0) | 17.07 (7.19 / 9.95) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.85 / 0.92 (none 0.17 / 0.18) | 1.02 (none 0.36) | 0.68 | see TAA row | 0.0027 (raw 0.0066, peak 0.0087) | 0 | 0 (0) | 16.19 (7.35 / 8.85) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.89 / 1.02 (none 0.17 / 0.18) | 1.06 (none 0.36) | 0.73 | see TAA row | 0.0031 (raw 0.0069, peak 0.0088) | 0 | 0 (0) | 17.14 (7.20 / 9.96) |
| 1080p | clip + dither + TAA | close | Baseline | 1.17 / 1.31 (none 0.11 / 0.12) | 1.27 (none 0.26) | 1.06 | 13.5 / 32.0 / 70 | 0.0211 (raw 0.0324, peak 0.0481) | 0 | 0 (0) | 16.30 (7.40 / 8.88) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.18 / 1.32 (none 0.11 / 0.12) | 1.25 (none 0.26) | 1.07 | 12.0 / 32.0 / 60 | 0.0242 (raw 0.0355, peak 0.0503) | 0 | 0 (0) | 17.27 (7.29 / 9.95) |
| 1080p | clip + dither + TAA | mid | Baseline | 0.77 / 0.88 (none 0.09 / 0.10) | 0.85 (none 0.23) | 0.68 | 17.1 / 44.0 / 88 | 0.0030 (raw 0.0081, peak 0.0102) | 0 | 0 (0) | 16.17 (7.32 / 8.88) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.74 / 0.85 (none 0.09 / 0.10) | 0.89 (none 0.23) | 0.65 | 15.3 / 42.0 / 94 | 0.0034 (raw 0.0085, peak 0.0109) | 0 | 0 (0) | 16.94 (7.11 / 9.89) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.78 / 1.95 (none 0.26 / 0.29) | 1.89 (none 0.47) | 1.52 | see TAA row | 0.0203 (raw 0.0306, peak 0.0469) | 0 | 0 (0) | 16.20 (7.32 / 8.88) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.66 / 1.81 (none 0.26 / 0.29) | 1.81 (none 0.47) | 1.40 | see TAA row | 0.0231 (raw 0.0335, peak 0.0474) | 0 | 0 (0) | 17.00 (7.14 / 9.92) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.02 / 1.18 (none 0.24 / 0.25) | 1.25 (none 0.45) | 0.78 | see TAA row | 0.0028 (raw 0.0068, peak 0.0088) | 0 | 0 (0) | 16.17 (7.35 / 8.88) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.00 / 1.09 (none 0.24 / 0.25) | 1.19 (none 0.45) | 0.76 | see TAA row | 0.0032 (raw 0.0072, peak 0.0090) | 0 | 0 (0) | 17.09 (7.14 / 9.98) |
| 1440p | clip + dither + TAA | close | Baseline | 1.47 / 1.66 (none 0.13 / 0.14) | 1.53 (none 0.31) | 1.34 | 13.5 / 32.0 / 68 | 0.0215 (raw 0.0327, peak 0.0478) | 0 | 0 (0) | 16.08 (7.32 / 8.85) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.43 / 1.58 (none 0.13 / 0.14) | 1.54 (none 0.31) | 1.30 | 12.1 / 32.0 / 60 | 0.0248 (raw 0.0359, peak 0.0500) | 0 | 0 (0) | 17.12 (7.17 / 9.98) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.84 / 0.94 (none 0.11 / 0.12) | 0.94 (none 0.26) | 0.74 | 17.1 / 44.0 / 86 | 0.0030 (raw 0.0079, peak 0.0099) | 0 | 0 (0) | 16.17 (7.32 / 8.85) |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.84 / 0.95 (none 0.11 / 0.12) | 1.01 (none 0.26) | 0.73 | 15.3 / 42.0 / 88 | 0.0035 (raw 0.0083, peak 0.0107) | 0 | 0 (0) | 17.09 (7.14 / 9.95) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
