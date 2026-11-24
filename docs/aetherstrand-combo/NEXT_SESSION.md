# Next session brief (lean)

Rules: at most 1-2 agents at a time, ~4-5 renders per iteration, 3-4 iterations per style, reports under 100 words. Styles range from realistic to anime (mostly "realistic anime"): extra realism where it matters visually, a clean game look where full realism is unreachable. When a style needs workaround after workaround, build the proper tool into the web generator and the plugin.

State: PR #1 (branch `hair-archetypes-2026-11-24` -> `main`) holds 4 new untuned styles (pixie-cut, twin-buns, mohawk-warrior, low-side-ponytail), per-archetype block files (`tools/hair-blocks/`, `compose.py`), recipes, parity tools, docs. `main` has 20 archetypes. A cloud Claude is adding 3 more on its own branch + PR.

Do in order:
1. When the cloud PR is up, check conflicts with PR #1 (mainly `src/engine/hairBuilder.ts`, `src/types/hair.ts`, metadata / preset map / params regions; PR #1 composes branches from `tools/hair-blocks` via `// ARCH-BEGIN/END` markers, the cloud branch likely adds inline branches). Report conflicts and a merge plan in under 150 words. Do not merge without the owner's OK.
2. Wait for the owner's notes before tuning anything.
3. Web-generator-as-test-bed plan: put the Tobin head in the web viewer, port the head fit, push-out hull (ear and neck exclusion, hug) and eye-clear into TypeScript, add a web-vs-Unity parity test; see `docs/aetherstrand-combo/web-tobin-plan.md` if written.
