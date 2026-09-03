# Adding A Custom Panel

How to get a panel you wrote into a running Robo-Boy, in the web app and in the packaged desktop app,
without publishing it anywhere. [External panels](external-panels.md) is the reference for the panel SDK,
the manifest, capabilities, and the sandbox; this guide is the workflow around it.

Throughout, `my-roboboy-panel` is a panel repository beside the Robo-Boy checkout and
`com.example.my-panel` is its manifest ID.

## Four Kinds Of Panel

Robo-Boy treats a panel differently depending on where it came from, which decides who may remove it and
what happens when the app is updated.

| Kind                     | Comes from                                        | Removable in the manager | Survives an app update              |
| ------------------------ | ------------------------------------------------- | ------------------------ | ----------------------------------- |
| **Official**             | The published catalog Robo-Boy ships a source for | Yes                      | Yes, it stays installed             |
| **Remotely installed**   | Any other remote catalog you configure            | Yes                      | Yes, it stays installed             |
| **Bundled with a build** | Staged into the app at build time                 | No, only switched off    | Only while the build still ships it |
| **Local development**    | A directory on your machine                       | Not applicable           | Not applicable, it is rebuilt       |

Official panels are ordinary remote panels; the only difference is that Robo-Boy ships their source
pre-configured. Bundled panels are the answer to "make this panel part of my build", and local development
panels are the answer to "let me iterate on it right now".

## What A Panel Repository Must Contain

```text
my-roboboy-panel/
  package.json
  roboboy.panel.json     manifest: ID, version, entryPoint, integrity, compatibility, capabilities, permissions
  src/index.ts
  dist/index.js          built bundle the manifest's entryPoint points at
```

The manifest's `integrity` must match the built bundle: every install verifies the SHA-256 before the panel
is written anywhere, and a mismatch fails the install rather than loading the code. Keep the repository
outside Robo-Boy; sources list repositories explicitly, so nothing scans or executes unrelated directories.
Field-by-field manifest rules are in [External panels](external-panels.md).

## Web

### Iterating locally

```bash
npm run dev:panels
```

This stages the panels named by the source configuration into a generated public tree, then runs the dev
server against it. Rebuild the panel's `dist/` and rerun to pick up changes. Plain `npm run dev` deliberately
serves the tracked empty registry and no external panels.

### Installing into a deployment

The deployment's panel manager runs on the server, so it can install from a directory. Mount the repository
into its workspace and name it in a source:

```yaml
# deployment-local Compose overlay
services:
  panel-manager:
    volumes:
      - ../my-roboboy-panel:/panel-workspace/my-roboboy-panel:ro
```

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "type": "local",
      "name": "my-workspace",
      "root": "/panel-workspace",
      "rootEnv": "ROBOBOY_PANEL_WORKSPACE",
      "repositories": ["my-roboboy-panel"]
    }
  ],
  "selection": { "mode": "all" }
}
```

Point `ROBOBOY_PANEL_SOURCES_FILE` at that configuration and recreate the manager. It resolves the source,
verifies the bundle, and writes the deployment registry the web app reads.

### How the web app finds and loads it

The app reads `/panels/installed.json` from its own origin, resolves each `entryPoint` relative to that
registry, and refuses any entry point that is not same-origin or does not carry its version as an immutable
path segment. Bundles load lazily: nothing is fetched until a panel is added to the workspace. The bytes are
verified against the manifest again at load time, then run inside a sandboxed frame.

## Desktop

The packaged app has no deployment behind it. It keeps panels in its **own storage** and reads only that, so
a panel reaches it in one of two ways: bundled into the build, or installed at runtime from a remote catalog.

> A local directory source cannot be installed at runtime on desktop. The app has no filesystem access to
> your working copy, so bundling is the supported route for a panel that is not published anywhere.

### Bundling a panel into the build

Create `local-panel-sources.json` in the Robo-Boy checkout. It is ignored by Git, so a machine can bundle
panels that are not committed anywhere:

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "type": "local",
      "name": "local-workspace",
      "root": "..",
      "rootEnv": "ROBOBOY_PANEL_WORKSPACE",
      "repositories": ["my-roboboy-panel"]
    }
  ],
  "selection": { "mode": "all" }
}
```

Staging prefers that file when it exists and falls back to the tracked configuration otherwise, so no build
command changes. Then build the desktop app and its installer:

```bash
npm run build:tauri:panels
npm run tauri build -- --bundles deb
```

`build:tauri:panels` stages the panels into a generated public tree and builds the frontend from it, so the
bundles ship inside the binary. Use `-- --config <path>` on any `*:panels` command to stage a different
selection. Staging prints which configuration it used.

### What happens on first run

The app copies bundled panels into its own storage, verifying each bundle against its manifest exactly as a
remote install does. They are kept apart from panels installed through the manager: a manager plan describes
only externally installed panels and cannot remove a bundled one. The seed mirrors the build on every run,
so a panel added to a build appears and one dropped from a build disappears.

### Installing from a catalog at runtime

**Manage installations…** installs from remote catalogs. The desktop app performs those downloads with a
native HTTP client rather than from the page, because catalog assets are commonly served without CORS
headers; the bytes are still origin-checked and SHA-256 verified before anything is written. Panels
installed this way persist across app updates.

## Enabling And Disabling

Every panel can be switched off from **Manage installations…**, whatever its origin, and switching one off
never removes it. Activation is a per-user preference stored in the browser or app profile; it is not part of
the desired state the manager applies, so it does not travel to another machine or deployment. Only removal
distinguishes the kinds: official and remotely installed panels can be removed, bundled ones cannot.

## When Robo-Boy Is Updated

- Panels installed through the manager stay installed; a new app version reads the same storage.
- Bundled panels are whatever the new build ships. A panel dropped from the build disappears on the next
  start; that is the intended way to retire one.
- A panel whose ID matches both a bundled and an installed copy resolves to the installed one, since that
  version was asked for explicitly.
- Panels are checked against the app's version and the Panel API version at load. A panel whose
  `compatibility` range excludes the new app is reported as incompatible instead of loaded.

## Developing Without Publishing

1. Build the panel's `dist/` and update `integrity` in its manifest.
2. Web: `npm run dev:panels`, or mount it into a deployment's manager as above.
3. Desktop: keep it in `local-panel-sources.json` and use the `*:panels` build commands.
4. Publish only when the panel should reach machines that do not have its repository: point a remote source
   at the catalog and the panel becomes an ordinary remotely installed panel.

Nothing above requires a remote catalog, an account, or a registry entry.
