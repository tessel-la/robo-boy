# User Guide

## Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/36b90514-79a6-42c4-9a92-b5231c9d16f3" width="50%" controls></video>
</div>

## Connect To A Robot

Open Robo-Boy and submit the connection form. Quick Connect and Domain ID use the current Robo-Boy host's proxy routes. When you select **Host or IP**, the host entered on the connection screen is used as the ROS backend host for rosbridge, video, and mesh endpoints. Use **Ports** when rosbridge, video, or mesh resources are listening somewhere other than the defaults.

Successful Host or IP connections are saved on the landing page as recent machines, including the service ports used for that machine. Use a recent entry to reconnect, or remove it from the list when it is no longer useful.

After rosbridge connects, the main control view discovers available ROS resources and enables the camera, 3D, behavior-tree, and control-pad interfaces.

## Shared Control

Connections start read-only. Open **Read-only** in the top bar and select **Request control** before
using pads or running a tree. One session controls the whole robot endpoint; other sessions retain
telemetry and editing. The menu shows the owner, blocked-command reasons, release, and transfer.
A persistent tree keeps its reservation across disconnects; reconnect and select **Manage running tree**
to pause, resume, or stop it before sending other commands.
See [Shared robot control](robot-control.md) for leases, recovery, and deployment requirements.
An optional robot-side policy can require ROS approval of each request. When configured,
the control menu shows its status; only the robot's native ROS operator can enable access.

## Main Views

### Camera

Robo-Boy discovers image topics and displays the selected stream through `web_video_server`. Camera requests use the active runtime endpoint, either the `/video_stream` proxy route or the selected backend host.

Use **Refresh** in the camera toolbar when a camera publisher starts after connecting, or to retry a failed stream. It updates the topic list for all camera panels without reopening them and reconnects the refreshed panel's stream. The button remains available when the topic list is empty. Your topic and quality choices are preserved; a selected topic that disappears is marked unavailable instead of silently switching cameras. Refresh failures keep the previous list and display a retry message.

**Auto** fits stream resolution to the panel. **Low**, **Medium**, and **High** trade detail for bandwidth; **Original** requests full-size frames. Camera topic discovery and refresh are read-only operations. Topic and quality controls sit above the image and wrap within narrow panels.

### 3D Visualization

The 3D view can display:

- TF frames
- Point clouds
- Laser scans
- Pose stamped or odometry data
- Camera information
- URDF robot models

Use the visualization settings to select a fixed frame, choose topics, configure render options, and add or remove visualizations. The configuration is saved in browser storage.

The fixed frame defaults to **Auto**: the view anchors to `world`, `map`, or `odom` when the robot publishes one of them, otherwise to the root of the TF tree. Picking a frame explicitly keeps it as long as it exists in the tree. The **Frames** list toggles individual TF frames, **Show all frames** follows the live tree (frames that appear later are added automatically), and the sliders button next to the list opens the frame display settings: axes, labels, parent links, axes size, and label size.

Navigation: drag to orbit, scroll to zoom, and pan with a middle- or right-button drag or by holding `Ctrl`, `Shift`, or `⌘` while dragging (the cursor turns into a hand). On touch screens, one finger orbits and two fingers pan and pinch-zoom.

### Data Explorer

The Data Explorer lists the robot's topics, services, actions and nodes with their publisher, subscriber, client and server counts, measures the traffic of topics you watch, shows message contents and interface schemas, draws who talks to whom, and collects diagnostics, logs and your own topic health rules. From a topic you can open Time Series, 3D, Camera, TF tree or recording settings. Endpoint counts, delivery settings and host-side rates need the ROS inspection companion, which the Docker stack starts; see [Data Explorer](data-explorer.md) for what each measurement means and how to deploy the companion.

### Behavior Trees

The behavior-tree editor provides sequence, selector, and parallel control nodes plus ROS action, service, and topic nodes. Use ROS discovery to populate the palette, configure node parameters, connect nodes from parent to child, and run or stop the tree from the toolbar.

Enable **Keep running** before pressing Run when execution must continue after the browser is closed or disconnected. The ROS stack owns that run, publishes live status, and lets Robo-Boy reattach after login. A running-tree control appears in the app chrome; use it to jump back to the session or stop it. Leave the toggle off for the original browser-owned, session-only execution mode.

Trees are stored in the current browser and can be imported or exported as JSON.

## Custom Control Pads

The lower control area starts empty. Use the `+` button to:

- Clone the built-in dual-joystick and heartbeat template.
- Create a control pad from an empty grid.
- Open a control pad saved in this browser.
- Import a versioned control-pad JSON file.

The editor supports virtual joystick, physical gamepad, button, D-pad, toggle, slider, camera, plot, and heartbeat components. Add a physical-gamepad component to an empty or existing custom pad when you want to use an Xbox, PlayStation, or Logitech controller. It publishes its complete axes and button state as `sensor_msgs/Joy`; each of its 17 standard buttons can also run an independent topic publish, service call, or action on press and release. The live controller drawing follows both sticks and highlights active buttons. Browsers expose a newly connected controller only after you press one of its buttons.

Choose automatic controller detection for normal use, or force Xbox, PlayStation, or Logitech labels and stick placement. If the controller reports a non-standard browser mapping, Robo-Boy warns you to verify its indices before driving.

Saved pads belong to the current browser profile. Export important layouts before clearing site data.

## Themes

Open the theme selector to choose a built-in theme or create a custom palette. Custom themes and the current selection are stored in the browser.

<div align="center">
  <video src="https://github.com/user-attachments/assets/3f28cc2b-b9e9-46fa-b36c-69324dec5664" width="30%" controls></video>
</div>

## Local Data

Robo-Boy has no user account or application database. Custom themes, gamepads, behavior trees, panel sizing, and visualization settings are stored in `localStorage`. Data is isolated by browser, profile, and site origin. Persistent behavior-tree executions are transient ROS runtime sessions; they are not stored as user data and end if the ROS stack restarts.
