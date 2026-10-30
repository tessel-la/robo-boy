# Robo-Boy content library

Open **Library** in the connection switcher, next to **Workspace layouts** and **Manage panels**.
The entry screen also has a Library button. Browse Official or add a custom HTTPS catalog, import
JSON files, or select a local robot repository folder. You can select entries or import a whole source.
Every import is reviewed and creates independent local snapshots. Opening a workspace, Pad or BT is
an explicit action after import.

The bundled Panda and generic inspection collections provide a workspace, passive JointState readout
Pad and a readiness condition BT. They are examples, not hardware-validated configurations. Review
ROS topics, frames, message types and payloads before using them with a robot.

The Genesis control collection is based on exported workspace, Pad and BT files. It preserves the
four-panel workspace (3D, TF tree, Camera and Pad), the three servo joysticks, and the separate
**Move Genesis X Y** BT. The BT publishes one `TwistStamped` velocity command with X/Y values of
0.1 m/s; it does not request a 0.1 m displacement. The Pad and BT use
`/arm_1/servo_node/delta_twist_cmds`. Frame, timestamp and servo requirements depend on the robot
configuration. The workspace does not specify a camera topic or enable a URDF layer. Importing
the collection does not run the controls or BT; the BT is available separately through **Open BT**.

## Publish a collection

1. Export a collection from Library, or a workspace/Pad/BT from its existing menu. A workspace
   collection includes its referenced Pads, BT snapshots and 3D settings.
2. Commit the JSON to your robot repository. Use a stable namespaced package `id`, SemVer `version`,
   `title`, `entryDocument` and `documents`; see `generic/panda-inspection/1.0.0.json` for a complete example.
   Workspace `layoutId` and `treeId` reference package document IDs. Include every referenced document.
3. Add an entry to a schema-version-1 `catalog.json` (or `roboboy-library.json` for local folders).
   Each entry has `id`, `title`, `kind` (`pad`, `behaviorTree`, `workspace` or `collection`), `version`,
   `url` and the lowercase hexadecimal `sha256` of the **exact file bytes**. Collections also list
   `kinds` so filtering works before download. Optional fields: `description` and `tags`.
4. Run `sha256sum generic/panda-inspection/1.0.0.json` after the last edit/formatting change. Update the
   entry's hash. Keep published releases immutable; publish changes with a new version/path.
5. Run `npm run check:content-library -- library/catalog.json` from the Robo-Boy repository.
   CI uses the same document validators as import review.
6. Share an HTTPS raw catalog URL (GitHub blob links are normalized). Serve public JSON with CORS
   for browser/desktop access. Relative package URLs resolve against the catalog URL. A cloned
   repository also works offline using **Add folder**; local manifest paths cannot leave that folder.

Official releases live in [Robo-Boy Catalog](https://github.com/tessel-la/robo-boy-catalog), grouped
by simulator (`genesis/`, `microduck/`) with shared examples under `generic/`. This directory keeps
an offline starter snapshot; the catalog repository owns new releases. Online refresh reads
`main/catalog.json` from that repository. Community catalogs cannot mark
entries as Official. There is no account service, upload server or Git client inside Robo-Boy;
sharing online means publishing JSON in your own repository/hosting and sharing its catalog URL.
Executable external panels continue to use the separate panel inventory and permission review.

## Local folders

Choose the library folder, e.g. `library/` or a robot's `panda/` folder. A manifest makes package
identity, grouping and updates explicit. Without one, exported Pad/BT/workspace files are discovered;
unrelated JSON is ignored. Old workspace exports can resolve Pads from adjacent Pad export files
when their IDs are unambiguous. Missing or ambiguous dependencies fail before any import.

Folder access is a snapshot granted by the browser picker. Refresh requires selecting the folder
again; Robo-Boy does not scan arbitrary paths or watch the checkout. Maximums: 3000 selected files,
200 JSON files, 32 MiB JSON total, 5 MiB per JSON file, 100 catalog entries.

## What is discovered automatically?

| Input | Action | Discovery |
| --- | --- | --- |
| An exported Pad, BT, workspace or collection JSON | **Import files** | Reads the supported document format; no catalog required. |
| A folder of exports, including a cloned robot repository | **Add folder** | Recursively inspects the selected files for supported exports. With a `catalog.json` or `roboboy-library.json`, uses its entries and verifies their hashes instead. |
| A library catalog hosted on GitHub or HTTPS | **Add catalog** | Reads the catalog and its referenced packages; GitHub blob links to the catalog are accepted. |
| A GitHub repository homepage | — | Does not crawl the repository. Supply its catalog file URL or clone it and use **Add folder**. |

Discovery identifies supported JSON structures, not arbitrary robot configuration files. Recognized
content is reviewed before import. Adding a source does not automatically import or activate it.
