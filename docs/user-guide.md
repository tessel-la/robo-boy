# User Guide

## Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/36b90514-79a6-42c4-9a92-b5231c9d16f3" width="50%" controls></video>
</div>

## Connect To A Robot

Open Robo-Boy and submit the connection form. Quick Connect and Domain ID use the current Robo-Boy host's proxy routes. When you select **Host or IP**, the host entered on the connection screen is used as the ROS backend host for rosbridge, video, and mesh endpoints.

After rosbridge connects, the main control view discovers available ROS resources and enables the camera, 3D, behavior-tree, and control-pad interfaces.

## Main Views

### Camera

Robo-Boy discovers image topics and displays the selected stream through `web_video_server`. Camera requests use the active runtime endpoint, either the `/video_stream` proxy route or the selected backend host.

### 3D Visualization

The 3D view can display:

- TF frames
- Point clouds
- Laser scans
- Pose stamped or odometry data
- Camera information
- URDF robot models

Use the visualization settings to select a fixed frame, choose topics, configure render options, and add or remove visualizations. The configuration is saved in browser storage.

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

The editor supports joystick, button, D-pad, toggle, slider, camera, plot, and heartbeat components. Each ROS-aware component can be assigned a topic, message type, field mapping, and component-specific options.

Saved pads belong to the current browser profile. Export important layouts before clearing site data.

## Themes

Open the theme selector to choose a built-in theme or create a custom palette. Custom themes and the current selection are stored in the browser.

<div align="center">
  <video src="https://github.com/user-attachments/assets/3f28cc2b-b9e9-46fa-b36c-69324dec5664" width="30%" controls></video>
</div>

## Local Data

Robo-Boy has no user account or application database. Custom themes, gamepads, behavior trees, panel sizing, and visualization settings are stored in `localStorage`. Data is isolated by browser, profile, and site origin. Persistent behavior-tree executions are transient ROS runtime sessions; they are not stored as user data and end if the ROS stack restarts.
