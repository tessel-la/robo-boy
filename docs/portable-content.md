# Portable content files

Robo-Boy imports editable copies of Pads, Behavior Trees and workspace layouts. Use the existing
**Import pad**, BT **Import**, or **Workspace layouts → Import** actions. A review lists what will
be created before anything is saved. Cancelling, replacing the selected file, closing its owner,
switching connection, or locking the BT editor cancels the pending operation.

- **Pads:** import copies into the Pad library, then explicitly select or edit one. Import does not
  switch the controls already displayed in a workspace.
- **Behavior Trees:** open a fresh copy in the editor after reviewing the replacement of unsaved editor
  changes. Save it to keep it. Embedded subtrees remain snapshots; links to saved source trees and
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

The import foundation also accepts this package envelope:

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

Package schema version, document format version and release version are separate. Release IDs are
never reused as local authoring IDs. This first format does not yet accept compatibility ranges,
requirements or bindings: unknown package fields fail explicitly rather than silently ignoring a
constraint. Packages that combine workspaces and BTs wait for the shared transactional repository.

Files are limited to 5 MiB, 100 documents/layouts, 100 panels per layout, 500 Pad components, and
500 nodes/1000 edges per tree. Subtrees are limited to ten nested levels. JSON depth, total value
count, finite numbers, graph identities/edges/cycles and known component configuration are checked
before import. Custom Pad handlers are not supported in portable files.

## Ownership and persistence

`features/library` owns bounded file/envelope parsing and the shared themed review. Domain codecs
live under `customGamepad`, `behaviorTree`, and `workspace`; BT structural validation is shared with
the assistant from the BT domain. `MainControlView` remains the workspace coordinator.

The existing feature stores remain authoritative. Pad imports validate the entire collection before
one localStorage write. Workspace imports prepare all documents first, check current storage, write
fresh resources, and expose saved layouts last. A failed write rolls back completed writes when their
values still match the import's writes, preserving another writer's changes. Existing malformed or
unsupported stores are preserved and reported. Storage is reread after review, so edits completed
while the dialog was open are retained.

This is a guarded synchronous batch, **not a crash-atomic or cross-tab transaction**. An interrupted
process can leave unused fresh resources. Shared IndexedDB document storage and revision-checked
transactions are the next persistence phase. Catalog browsing, provenance, updates and online publishing
will build on that phase; this change adds no network source or executable-panel installation path.
