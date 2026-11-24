# The AetherStrand Codex

The codex is the progress hub for the hair work: every archetype's reference, its render history, the open issues, and the archetype backlog. It is a private claude.ai artifact with its own database. Jaycee reads it and approves styles there; Claude sessions keep it current.

- **Artifact:** https://claude.ai/artifact/UgaDpPX55iNKX2uSNbwNvE
- **Database:** the artifact's own store, written with the `ArtifactData` tool (load it with ToolSearch: `select:ArtifactData`). Every call takes `url` = the artifact link above.
- **Images:** artifact assets, uploaded with the `Artifact` tool (`asset: true`). Rows store the 32-hex asset id; the page shows it at `/_blob/<id>`.
- **Who can write:** the artifact's owner and its Editors (`write: "admin"` on the root). A session acting for Jaycee can write.

Only the database changes when work moves. Do not republish the page to add a render, an issue or a status. Republish only to change the page's design, and then from the newest version (read it with `Artifact` `action: "read"` first).

## Collections

| Collection | Doc id | Fields |
|---|---|---|
| `styles` | archetype id from `ARCHETYPE_METADATA` (e.g. `undercut-fade`) | `name`, `inspiration`, `status`, `order`, `refAsset`, `latestRender`, `alias`, `notes`, `updatedAt` |
| `renders` | `r-<style>-<n>` (n counts up per style) | `styleId`, `asset`, `note`, `at`, `by` |
| `issues` | `i###` (next free number) | `styleId` (a style id, or `shared` for a shared root cause), `text`, `status` (`open` or `fixed`), `opened`, `fixedAt`, `source` (`Jaycee` or `Claude`), `order` |
| `chronicle` | `c###` (next free number) | `at`, `kind` (`render`, `status`, `issue`, `note`), `text`, `styleId` (optional), `asset` (optional), `by` |
| `backlog` | `b###` (next free number) | `kind` (`add`, `fix`, `remove`), `name`, `reason`, `status` (`open` or `done`), `date`, `source` |
| `meta` | `state` | `focus` (one line: what is on the loom now), `updatedAt`, `by` |

Times are ISO 8601 UTC strings (`2026-11-24T21:20:00.000Z`). `alias` is the nickname Jaycee used for a style in a review (e.g. "the fade"). The page also writes documents with random ids when Jaycee adds issues, renders or backlog items from the page; keep using the numbered scheme for your own and never reuse an existing id.

### Status flow

`Queued` → `Working` → `Ready for review` → `Approved for Tobin` → `In Unity`

- `Working`: a session is iterating on the style.
- `Ready for review`: the latest render and the reference are ready for Jaycee to compare. The style shows on the page under "Awaiting your judgment".
- `Approved for Tobin`: only Jaycee sets this, by pressing Approve on the page. Never set it yourself.
- `In Unity`: the style has been tested on Tobin in Unity.
- "Send back" on the page returns a style to `Working`; read its new issues before the next pass.

## Recipes

Before any write to a document that already exists, read it (`get`) and pass its `version` as `if_version`. If a pinned write fails, re-read and redo it rather than overwriting someone's change. Use one `batch` call when you write more than a couple of documents.

### Add a render

1. Copy the PNG into your scratchpad (the upload tool reads only the scratchpad and the working directory), then upload it:
   ```
   Artifact { url: "<codex url>", asset: true, file_path: "<scratchpad>/undercut-fade-pass3.png" }
   ```
   Keep the returned asset id (32 hex characters).
2. Read the style and list its renders to find the next `n`:
   ```
   ArtifactData { action: "get", url, collection: "styles", doc_id: "undercut-fade" }
   ArtifactData { action: "query", url, collection: "renders", query: { where: [["styleId", "==", "undercut-fade"]] } }
   ```
3. Write all three in one batch:
   ```
   ArtifactData { action: "batch", url, writes: [
     { op: "set", collection: "renders", doc_id: "r-undercut-fade-2",
       data: { styleId: "undercut-fade", asset: "<id>", note: "Sideburns now end at mid-ear; fade painted on the scalp.", at: "<now>", by: "Claude" } },
     { op: "update", collection: "styles", doc_id: "undercut-fade", if_version: <v>,
       data: { latestRender: "<id>", updatedAt: "<now>" } },
     { op: "set", collection: "chronicle", doc_id: "c0NN",
       data: { at: "<now>", kind: "render", styleId: "undercut-fade", asset: "<id>", text: "New render of Undercut Fade: sideburns now end at mid-ear.", by: "Claude" } }
   ] }
   ```
   The note says what changed since the last render, in one sentence Jaycee can read on a phone.

### Mark a style ready for review

When a style matches its reference well enough for Jaycee's eye, add its render (above), then:
```
{ op: "update", collection: "styles", doc_id: "<id>", if_version: <v>, data: { status: "Ready for review", updatedAt: "<now>" } }
{ op: "set", collection: "chronicle", doc_id: "c0NN", data: { at: "<now>", kind: "status", styleId: "<id>", text: "<Name> moved to Ready for review.", by: "Claude" } }
```

### Other status changes

Same shape as above with the new `status`. Set `Working` when a pass starts on a `Queued` style, and `In Unity` after a Tobin test in Unity passes. Leave `Approved for Tobin` to Jaycee.

### Record an issue

```
{ op: "set", collection: "issues", doc_id: "i0NN",
  data: { styleId: "<id or shared>", text: "<what is wrong, one sentence>", status: "open", opened: "<now>", source: "Claude", order: NN } }
```
Use `source: "Jaycee"` when you are recording something Jaycee said. Add a `chronicle` entry with `kind: "issue"` for anything Jaycee should notice.

### Mark an issue fixed

```
{ op: "update", collection: "issues", doc_id: "i0NN", if_version: <v>, data: { status: "fixed", fixedAt: "<now>" } }
```
Mark it fixed only when a render shows the fix. Put that render in the same batch, so the evidence and the claim land together.

### Update what is on the loom

```
ArtifactData { action: "update", url, collection: "meta", doc_id: "state", if_version: <v>,
  data: { focus: "Undercut Fade pass 3: spiky top from the clump tool.", updatedAt: "<now>", by: "Claude" } }
```

### Backlog

Add a style to create, mend or retire (`remove` is for duplicates only, and needs Jaycee's word before the code changes):
```
{ op: "set", collection: "backlog", doc_id: "b0NN", data: { kind: "add", name: "Braided Mohawk", reason: "...", status: "open", date: "<now>", source: "Claude" } }
```
When an `add` lands in `hairBuilder.ts`, also create its `styles` document (id = archetype id, `order` = its position in `ARCHETYPE_METADATA`, `status: "Working"`) and set the backlog item to `done`.

## Checking your writes

Read back what you wrote with one `list` or `query`. To see what a view-only visitor sees, add `as_level: "view"`. Don't write test documents.
