# Backend compatibility

Open **Robot control** in the workspace toolbar to see the app version, the connected ROS stack's
Robo-Boy version, its ROS distribution, and its installed rosbridge version. A warning icon in the
toolbar marks differing or unverified versions. Each connection reports its own backend.

Use the same Robo-Boy release for the app and the ROS stack. The app compares the complete release
version, including prerelease suffixes. Matching releases show **Versions match**.
Different releases show **Version mismatch**, with guidance to align them. This is
an advisory check: it does not acquire control or change the gateway's command authorization.

## Deployment

The ROS image copies the release-please-managed root `package.json` at build time. Rebuild and
recreate `ros-stack` after upgrading its source. Updating only the web app or desktop app does not
update the backend image's reported version. A gateway started from a source checkout reads that
checkout's root `package.json` instead.

The gateway reads `ROS_DISTRO` from its runtime environment and resolves rosbridge's installed
`package.xml` through the active ament package index, including overlays. It reads metadata once
when starting and adds a `backend` object to the existing version-1 `/roboboy/control/status`:

```json
{
  "stackVersion": "0.20.0-alpha",
  "rosDistro": "jazzy",
  "rosbridgeVersion": "2.3.0"
}
```

These are diagnostic values. Reporting them needs no control lease, new port, ROS service, or
proxy route. The gateway owns the status topic and rejects clients that try to publish to it.
Backend metadata expires with connection status and is cleared on disconnect or replacement.

## Limitations

Older stacks do not report these fields. Missing or malformed release metadata shows **Unverified**;
missing runtime fields show **Not reported**. Diagnostics never invalidate
otherwise valid control status. An unreachable gateway also leaves the existing command block in
place.

A release match does not prove compatibility with every robot interface, overlay, or ROS package.
ROS distributions and rosbridge versions are shown for diagnosis; they are not compared against
an invented support matrix. Different release versions can work together, but may lack features
or use different contracts. Unreleased changes made under the same package version cannot be
distinguished by this check.

## Verification

The unit tests cover build metadata, missing metadata, release comparison, and connection cleanup.
The gateway socket tests verify observer access and spoof rejection. Run the browser scenarios with:

```sh
npm run e2e -- e2e/backend-compatibility.spec.ts e2e/robot-control.spec.ts
```

To include real web and desktop connection paths, start a disposable ROS stack from the current
source and set its public gateway port. These cases read status and disconnect without requesting
control or sending robot commands:

```sh
ROBOBOY_TEST_BACKEND_PORT=19090 npm run e2e -- e2e/backend-compatibility.spec.ts
```

The real-stack cases default to expecting Jazzy. Set `ROBOBOY_TEST_ROS_DISTRO` for another
distribution. Desktop cases exercise the renderer's native-shell endpoint selection in a browser;
they do not launch a packaged Electron or Tauri binary.
