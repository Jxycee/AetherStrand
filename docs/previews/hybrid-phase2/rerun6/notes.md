# Rerun 6 notes (hand checks, beside summary.md)

Commit tested: afe2d28.

## Burst and compile
- Package Manager shows com.unity.burst **2.0.0** (built into Unity 6000.6, a dependency of the package; it satisfies
  1.8.12). `AETHERSTRAND_BURST` is defined for AetherStrand.Runtime. Both kernels are listed in the player's
  `lib_burst_generated`.
- Editor timing: Burst compilation on, safety checks off, synchronous compilation on (safety checks and synchronous
  compilation were put back afterwards).
- No Burst compile errors. Both shaders: all D3D11 variants compile with no messages (the ScalpPaint pow warning is gone).
- One C# warning:
  `Runtime\AetherStrandWebSolver.cs(946,44): warning CS0219: The variable 'THICK_SCALE' is assigned but its value is never used`

## Speed
- `summary.md` = editor play mode. `summary_player_mono.md` = standalone release player, Mono.
- `split_mono_burst.txt` / `split_mono_noburst.txt`: same player with a temporary timer (`HybridSplitTimer.cs.txt`),
  second one launched with `--burst-disable-compilation`. "Upload" is the Mesh.Set* and bounds calls repeated on the same
  arrays, and "build" is the lock mesh update minus that. It does not include the later GPU buffer upload.
- **IL2CPP: not measured.** The module is not installed on this PC:
  `Error building Player: Currently selected scripting backend (IL2CPP) is not installed.`
  The test project is back on Mono.

## Hairline dots (close_fadecap_test.png, close_tips_hairline.png, close_a2c_1to1_r5_vs_r6.png)
- The dot clouds are gone under MSAA 4x + A2C.
- The fade now shows **hard flat steps** (grey rectangular bands) at the hairline and temple, visible at 1:1. Likely
  cause: 4x MSAA alpha to coverage only has a few coverage levels, so a smooth gradient is quantised.
- `close_tips_hairline.png` / `close_fadecap_test.png`: same camera as rerun 5, rendered by a temporary editor script
  after 900 settle ticks, so the hair pose is close to rerun 5's but not identical. The 1:1 sheet uses proof stills.
- Clip + TAA (close_taa_r5_vs_r6.png, frame 50): 0 pixels differ by more than 8/255 from rerun 5; the same for frame 1
  and the baseline. A2C stills differ on 0.4 to 0.6 % of pixels.

## Shimmer (1080p close, MSAA 4x + A2C)
Hybrid 0.0224 (rerun 5: 0.0225), baseline 0.0202 (0.0203). Unchanged within run-to-run noise.
