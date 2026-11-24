# Setup

```
npm install --legacy-peer-deps
npm run dev
```

The app runs at http://localhost:3000.

## Why `--legacy-peer-deps`

A plain `npm install` stops with `ERESOLVE`: the project pins `esbuild@^0.25` as a dev dependency, while Vite 8 lists
`esbuild@^0.27 || ^0.28` as an optional peer. Nothing in the project imports esbuild directly (Vite 8 bundles with
Rolldown), so the older version is harmless and `--legacy-peer-deps` installs everything correctly.

The clean fix is to change `"esbuild": "^0.25.0"` to `"^0.28.0"` in package.json, then run `npm install` and
`npm run build` to confirm. It hasn't been made yet because it needs that install to verify.
