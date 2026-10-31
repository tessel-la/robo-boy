# Portable content files

Robo-Boy imports editable copies of Pads, Behavior Trees and workspace layouts. Use the existing
**Import pad**, BT **Import**, or **Workspace layouts → Import** actions. A review lists what will
be created before anything is saved. Cancelling, replacing the selected file, closing its owner,
switching connection, or locking the BT editor cancels the pending operation.

- **Pads:** import copies into the Pad library, then explicitly select or edit one. Import does not
  switch the controls already displayed in a workspace.
- **Behavior Trees:** save the imported tree and open it in the editor after reviewing the replacement of unsaved
  editor changes. Find it later in **Saved Trees**. Embedded subtrees remain snapshots; links to saved source trees and
  execution/highlight state are removed. Import never starts execution.
- **Workspaces:** add saved layouts without applying them. Layout IDs, panel IDs, geometry references,
  included Pad references and 3D storage slots are remapped together. Repeated imports are independent.
  Existing exports include the referenced built-in and custom Pads. For older files that omitted a Pad,
  the review reports when its installed definition is copied; missing definitions cause an error.

Robot compatibility is not checked by file import. Review topics, frames, interfaces and payloads in
an editor before use. Offline structural validation does not require a robot connection. The preview
is text only: it does not mount operational panels, install external code, acquire control or run ROS
operations. Existing runtime and control-lease checks continue to own execution.

Workspace imports and exports omit ROS topic approvals and external panels' opaque state. Install/enable
required external panels through **Manage panels**, then configure them locally. Built-in panel configuration
and ROS payloads can contain user-entered values and URLs; review exported JSON before sharing it.

## File formats

Existing Pad `{ "version": "1.0.0", "layouts": [...] }`, BT
`{ "version": "1.0.0", "tree": {...} }`, workspace v1/v2 bundles and legacy arrays of saved
workspace layouts remain readable. A missing wrapper version on older Pad/BT files is accepted.
Exports keep those established wrappers. Unsupported future versions fail without writes.

Library and the existing file importers also accept this package envelope:

```json
{
  "schemaVersion": 1,
  "id": "example.drive",
  "version": "1.0.0",
  "title": "Drive Pad",
  "entryDocument": "pad/drive",
  "documents": [
    {
      "id": "pad/drive",
      "kind": "pad",
      "formatVersion": 1,
      "data": {
        "id": "drive",
        "name": "Drive Pad",
        "gridSize": { "width": 8, "height": 6 },
        "cellSize": 40,
        "components": [],
        "rosConfig": { "defaultTopic": "/joy", "defaultMessageType": "sensor_msgs/msg/Joy" },
        "metadata": { "created": "2026-10-29", "modified": "2026-10-29", "version": "1.0.0" }
      }
    }
  ]
}
```

The Pad importer accepts only Pad documents. The BT importer accepts one `behaviorTree` document
with embedded subtrees. The workspace importer accepts `workspace` and `pad` documents, with a
workspace entry document; workspace bodies use the saved-layout shape. A packaged Pad reference
(`panel.layoutId`) names its **package document ID**, e.g. `pad/drive`. Every referenced Pad must be
included. Document IDs are unique within the package; Pad body IDs must also be unique.

Package schema version, document format version and release version are separate. Library supports
mixed workspace/Pad/BT collections and optional `description`, `author`, `license`, `tags` and
`compatibility: { "roboboy": ">=0.19.0-0 <1.0.0" }`. Unsupported or incompatible versions fail
before writes. The narrow existing Pad/BT/workspace importers keep their established scope; use
Library for mixed collections. Review can remap declared topic, service, action and frame fields;
arbitrary text and ROS message payloads are never rewritten.

## Browsing, importing and sharing libraries

Open **Library** in the connection menu next to **Workspace layouts** and **Manage panels**, or
from the entry screen. The existing Pad, BT and layout menus keep their focused file import actions.

- **Saved** lists each saved or imported layout, Pad and behavior tree by name. Select an item to open it.
  Imported behavior trees also appear in the BT editor’s **Saved Trees** menu and node palette.
- **Browse → Official** includes offline starter collections and refreshes from
  [Robo-Boy Catalog](https://github.com/tessel-la/robo-boy-catalog). Published content is grouped
  by simulator, with shared examples under `generic/`.
- **Import → Online catalog…** accepts public HTTPS JSON catalogs, including GitHub raw/blob URLs. Downloads use
  no credentials or redirects, validate hashes over exact bytes, and validate every document body.
- **Import → Folder…** reads a robot repository/library folder. A manifest can group related documents;
  legacy exports are also discovered, with unambiguous adjacent Pad dependencies included.
- **Import** on a preview reviews one collection; **Select multiple** and **Import all** handle batches.
  Review offers optional topic/frame changes and commits the complete selection together. Import
  saves snapshots without opening panels or changing controls. Opening a document is a separate action.
- Imported Pads are reusable templates; customize one to create an editable Pad. BTs open fresh editor
  copies. Workspaces open with new panel/layout IDs and preserve their Pad/BT/3D dependencies. Live
  control panels require a robot connection; entry-screen opening uses the existing local replay mode.
- **Export collection** includes dependencies. **Saved options → Export all** creates a portable backup. Collection export, rename,
  archive and restore are under **Details & collection**. Import that JSON on another origin/device. Local collection names are
  included when exporting. Online sharing uses your own repository/hosting; see the
  [library publishing guide](../library/README.md).
- Refreshing a source checks for updates; **Review newer release** imports a new version alongside the saved one.
  Existing copies are not overwritten. Folder refresh asks you to select the folder again.
- **Archive collection** hides it but preserves workspace references. Enable **Saved options → Show archived collections** to export or restore it. Removing a catalog does not remove imported copies.

Browser, Electron and Tauri use the same JSON catalog flow. Hosts must permit CORS; private
repositories requiring credentials are outside this flow. The folder picker works with local clones.
Source catalogs and verified releases are cached for offline browsing/import after download. Each
operation is bounded; folder import accepts up to 3000 files / 200 JSON / 32 MiB total.

Files are limited to 5 MiB, 100 documents/layouts, 100 panels per layout, 500 Pad components, and
500 nodes/1000 edges per tree. Subtrees are limited to ten nested levels. JSON depth, total value
count, finite numbers, graph identities/edges/cycles and known component configuration are checked
before import. Custom Pad handlers are not supported in portable files.

## Ownership and persistence

`features/library` owns bounded file/envelope parsing and the shared themed review. Domain codecs
live under `customGamepad`, `behaviorTree`, and `workspace`; BT structural validation is shared with
the assistant from the BT domain. `MainControlView` remains the workspace coordinator.

The existing feature stores remain authoritative for authored edits and existing file import menus.
Library aggregates them without migration. Reusable collections, their package-local dependencies,
provenance, sources and exact downloaded releases live in the origin-local IndexedDB database
`robo-boy-content-library`. A native readwrite transaction commits selected collections together;
ID collisions, cancellation and write failures abort the batch. Metadata edits compare revisions
inside the transaction to reject stale changes from another window. Same-window events and a
BroadcastChannel refresh other views. Archived snapshots remain resolvable, avoiding cross-window
workspace-reference deletion races.

App owns the Library lifecycle and hydrates templates before mounting a connection workspace.
The coordinator receives only explicit document-open requests. Domain codecs own body validation,
3D normalization and BT execution-state removal. The existing external-panel manager and Library
share management header chrome and the SHA-256 implementation, while their apply/storage lifecycles
stay separate: importing JSON does not install code, grant panel permissions or contact ROS.

Existing localStorage file imports keep their guarded synchronous batch and rollback checks; those
legacy writes are not crash-atomic or cross-tab transactions. Library import is transactional within
IndexedDB, while explicitly opening a workspace still uses the existing workspace localStorage stores.
Browser storage is isolated by origin/profile; switching URL or desktop profile does not migrate it.
