# Hybrid proof, 2026-11-26 10:07

GPU: NVIDIA GeForce RTX 5070 (Direct3D11), Unity 6000.6.5f1. Locks baseline 160746 tris, hybrid 160962 tris + mass 7884 tris. Hybrid mass conformed to skull: 3764/4006 vertices moved over 0.2 web-mm; largest push out 26.2 web-mm, in 30.9 web-mm.

## Ear isolation

Panels, left to right then down: all | paint only | mass + paint | mass flat grey, no paint | locks + cards + paint | nothing (skin).

- Paint _Color sRGB 0.247, 0.220, 0.200 (linear 0.050, 0.040, 0.033)
- Main light key: colour 1.000, 0.976, 0.941 x intensity 0.812, direction to light (-0.324, 0.724, 0.609) (web paint uses (-0.4, 0.8, 0.6) normalised, colour 1)
- Ambient (SH) on the left side of the head: 0.020, 0.022, 0.024 (the Unity paint adds 0.25 x this; the web adds none)
- Ambient mode Trilight, intensity 1.000

| res | alpha | camera | hair | GPU ms/frame (median / p95, FTM) | burst ms/render | hair GPU cost ms | overdraw mean/p95/max | shimmer (hair only) | pops | NaN/inf px (none) | solver+mesh CPU ms (solver / mesh) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1080p | MSAA 4x + A2C | close | Baseline | 1.31 / 1.45 (none 0.19 / 0.21) | 1.50 (none 0.41) | 1.12 | see TAA row | 0.0195 (raw 0.0297, peak 0.0447) | 0 | 0 (0) | 16.24 (7.43 / 8.86) |
| 1080p | MSAA 4x + A2C | close | Hybrid | 1.28 / 1.41 (none 0.19 / 0.21) | 1.48 (none 0.41) | 1.09 | see TAA row | 0.0226 (raw 0.0328, peak 0.0481) | 0 | 0 (0) | 17.19 (7.23 / 9.95) |
| 1080p | MSAA 4x + A2C | close | HybridLocks | 1.23 / 1.35 (none 0.19 / 0.21) | 1.39 (none 0.41) | 1.04 | see TAA row | 0.0228 (raw 0.0330, peak 0.0472) | 0 | 0 (0) | 17.07 (7.19 / 9.93) |
| 1080p | MSAA 4x + A2C | close | HybridMass | 0.25 / 0.27 (none 0.19 / 0.21) | 0.42 (none 0.41) | 0.06 | see TAA row | 0.0029 (raw 0.0131, peak 0.0248) | 0 | 0 (0) | 17.03 (7.14 / 9.92) |
| 1080p | MSAA 4x + A2C | mid | Baseline | 0.87 / 0.97 (none 0.17 / 0.19) | 1.07 (none 0.39) | 0.70 | see TAA row | 0.0027 (raw 0.0065, peak 0.0087) | 0 | 0 (0) | 16.22 (7.39 / 8.88) |
| 1080p | MSAA 4x + A2C | mid | Hybrid | 0.88 / 0.95 (none 0.17 / 0.19) | 1.01 (none 0.39) | 0.71 | see TAA row | 0.0030 (raw 0.0069, peak 0.0088) | 0 | 0 (0) | 17.11 (7.16 / 9.95) |
| 1080p | clip + dither + TAA | close | Baseline | 1.18 / 1.34 (none 0.11 / 0.12) | 1.26 (none 0.27) | 1.08 | 13.5 / 32.0 / 70 | 0.0210 (raw 0.0323, peak 0.0474) | 0 | 0 (0) | 16.16 (7.37 / 8.82) |
| 1080p | clip + dither + TAA | close | Hybrid | 1.19 / 1.35 (none 0.11 / 0.12) | 1.33 (none 0.27) | 1.09 | 12.1 / 32.0 / 60 | 0.0240 (raw 0.0353, peak 0.0498) | 0 | 0 (0) | 17.09 (7.20 / 9.89) |
| 1080p | clip + dither + TAA | mid | Baseline | 0.75 / 0.82 (none 0.09 / 0.10) | 0.84 (none 0.24) | 0.66 | 17.1 / 44.0 / 88 | 0.0029 (raw 0.0080, peak 0.0102) | 0 | 0 (0) | 16.30 (7.45 / 8.88) |
| 1080p | clip + dither + TAA | mid | Hybrid | 0.78 / 0.85 (none 0.09 / 0.10) | 0.89 (none 0.24) | 0.69 | 15.3 / 42.0 / 94 | 0.0034 (raw 0.0084, peak 0.0109) | 0 | 0 (0) | 17.15 (7.20 / 9.95) |
| 1440p | MSAA 4x + A2C | close | Baseline | 1.88 / 2.26 (none 0.26 / 0.29) | 2.02 (none 0.46) | 1.61 | see TAA row | 0.0201 (raw 0.0305, peak 0.0463) | 0 | 0 (0) | 16.27 (7.45 / 8.88) |
| 1440p | MSAA 4x + A2C | close | Hybrid | 1.74 / 2.13 (none 0.26 / 0.29) | 1.84 (none 0.46) | 1.48 | see TAA row | 0.0230 (raw 0.0334, peak 0.0469) | 0 | 0 (0) | 17.09 (7.17 / 9.95) |
| 1440p | MSAA 4x + A2C | mid | Baseline | 1.45 / 1.68 (none 0.23 / 0.26) | 1.61 (none 0.45) | 1.22 | see TAA row | 0.0028 (raw 0.0068, peak 0.0088) | 0 | 0 (0) | 16.39 (7.48 / 8.88) |
| 1440p | MSAA 4x + A2C | mid | Hybrid | 1.43 / 1.60 (none 0.23 / 0.26) | 1.61 (none 0.45) | 1.20 | see TAA row | 0.0032 (raw 0.0072, peak 0.0090) | 0 | 0 (0) | 17.15 (7.23 / 9.95) |
| 1440p | clip + dither + TAA | close | Baseline | 1.59 / 2.00 (none 0.13 / 0.14) | 1.54 (none 0.30) | 1.45 | 13.5 / 32.0 / 68 | 0.0214 (raw 0.0325, peak 0.0473) | 0 | 0 (0) | 16.30 (7.45 / 8.85) |
| 1440p | clip + dither + TAA | close | Hybrid | 1.43 / 1.80 (none 0.13 / 0.14) | 1.85 (none 0.30) | 1.30 | 12.1 / 32.0 / 60 | 0.0246 (raw 0.0358, peak 0.0495) | 0 | 0 (0) | 16.94 (7.14 / 9.89) |
| 1440p | clip + dither + TAA | mid | Baseline | 0.86 / 0.94 (none 0.10 / 0.11) | 0.97 (none 0.25) | 0.75 | 17.1 / 44.0 / 86 | 0.0030 (raw 0.0079, peak 0.0099) | 0 | 0 (0) | 16.17 (7.39 / 8.85) |
| 1440p | clip + dither + TAA | mid | Hybrid | 0.86 / 0.99 (none 0.10 / 0.11) | 0.96 (none 0.25) | 0.76 | 15.3 / 42.0 / 90 | 0.0035 (raw 0.0083, peak 0.0106) | 0 | 0 (0) | 17.03 (7.14 / 9.95) |

Notes: hair GPU cost = median GPU frame time with hair minus without (FrameTimingManager), or the burst figure when FTM is off. Burst = wall time of 16 back-to-back renders of one frame, then a GPU sync, divided by 16. Overdraw = rasterised hair layers per covered pixel, clipped fragments included (an upper bound). Shimmer = mean |f(t+1) - 2 f(t) + f(t-1)| of linear luminance over the frame, minus the no-hair run: smooth motion scores low, flicker and pops score high. Pops = frames whose shimmer is over 3x the run's median. NaN/inf px = sampled pixels (every 2nd row and column) that were not finite, over the run, with the first frame; they count as black in the shimmer. TAA here has camera motion vectors only (the hair mesh is written on the CPU), so hair that moves with the head can ghost.
