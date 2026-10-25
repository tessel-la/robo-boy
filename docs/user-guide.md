# User Guide

## Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/36b90514-79a6-42c4-9a92-b5231c9d16f3" width="50%" controls></video>
</div>

## Connect To A Robot

Open Robo-Boy and use **Quick Connect** for the current Robo-Boy host's proxy routes, or **Choose another robot** to enter a host or IP address. In the desktop app's first launch, the address field is shown directly. The address identifies the ROS backend for rosbridge, video, and mesh endpoints. Expand **Connection ports** when those services use ports other than the defaults. ROS domain IDs are configured on the robot, not in Robo-Boy's connection form.

Successful Host or IP connections are saved on the landing page as recent machines, including the service ports used for that machine. Robo-Boy keeps the 20 most recent hosts; scroll the list to reach older entries. Use a recent entry to reconnect, or remove it from the list when it is no longer useful. Existing saved connections are preserved when upgrading; entries already discarded by an older version cannot be recovered.

After rosbridge connects, the main control view discovers available ROS resources and enables the camera, 3D, behavior-tree, and control-pad interfaces.

## Shared Control

Connections start read-only. Open **Read-only** in the top bar and select **Request control** before
using pads or running a tree. One session controls the whole robot endpoint; other sessions retain
telemetry and editing. The menu shows the owner, blocked-command reasons, release, and transfer.
A persistent tree keeps its reservation across disconnects; reconnect and select **Manage running tree**
to pause, resume, or stop it before sending other commands.
See [Shared robot control](robot-control.md) for leases, recovery, and deployment requirements.
An optional robot-side ROS switch can enable or disable control globally. When configured,
the control menu shows its status; only the robot's native ROS operator can enable access.
Once enabled, sessions use the normal Request control workflow.

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
- Planned paths (`nav_msgs/Path`)
- Occupancy maps (`nav_msgs/OccupancyGrid`)

Use the visualization settings to select a fixed frame, choose topics, configure render options, and add or remove visualizations. The configuration is saved in browser storage.

The fixed frame defaults to **Auto**: the view anchors to `world`, `map`, or `odom` when the robot publishes one of them, otherwise to the root of the TF tree. Picking a frame explicitly keeps it as long as it exists in the tree. The **Frames** list toggles individual TF frames, **Show all frames** follows the live tree (frames that appear later are added automatically), and the sliders button next to the list opens the frame display settings: axes, labels, parent links, axes length and width, and label size. Axes width is the diameter in scene metres and is independent of length. New panels default to 0.08 m axes length, 0.004 m axes width, 70% axes opacity, and labels without a background, a label size of 0.35 m, and 80% label opacity. Saved custom label settings are preserved.

PoseStamped and PointCloud2 layers use their message frame and acquisition timestamp. Dynamic TF is interpolated between recorded samples; a zero or omitted timestamp uses the latest TF. Missing frames, malformed data and timestamps outside the retained history hide the affected geometry. Open **Settings → Visualizations** to see the reason under that layer; incoming valid data or TF can resolve it automatically. Pose trails store positions in the selected fixed frame and reset when that frame or data source changes.

For **URDF** and **Mesh markers** layers, open **Settings → Visualizations** and use the layer's **Mesh opacity** slider (0–100%, default 100%). Each layer is independent, updates immediately without reloading meshes or subscriptions, and saves its opacity with the panel. The slider multiplies the opacity already authored in model materials or ROS marker colors; 100% restores the original appearance. Newly loaded meshes use the current setting.

To show a route and its environment, open **Settings → Visualizations → Add visualization** and choose **Path** or **Occupancy grid**. Add multiple layers for different robots or global/local plans, then select each layer's topic. ROS 1 and ROS 2 message-type spellings and namespaced topics are supported. The Data Explorer's **Open in 3D** action also opens these types.

Each path/map has a **Show layer** toggle and **Opacity** slider. Paths also have **Color** and **Line width (m)** controls; defaults are green, 0.03 m width and 100% opacity. Maps default to 70% opacity: white is free (0), black is occupied (100), intermediate probabilities are gray, and unknown cells (-1) are blue-gray. Resolution, origin translation and rotation determine the cell placement; row zero starts at the map origin. Appearance and visibility are saved with the panel and update without resubscribing.

Paths respect each pose's frame and timestamp, falling back to the path header when its pose frame is empty or its timestamp is omitted. Explicit zero timestamps use latest TF. Maps use their header's frame/timestamp. Missing transforms hide the affected layer and show its reason in the menu. Empty messages clear the previous route/map; an isolated path pose has no line to draw. Both layers follow recorded messages and playback seeks. Rendering is bounded to 10,000 poses per path, 4,194,304 cells per map, and 4,096 cells per map side (or the GPU's smaller texture limit); invalid/oversized messages show an error instead of retaining obsolete geometry.

Maps currently consume complete OccupancyGrid messages. Incremental map/costmap updates are a later feature. A latched ROS 2 map may require compatible transient-local durability in the publisher/rosbridge setup; the browser layer cannot set ROS 2 QoS through this transport. If the layer stays on “Waiting for map messages”, check those settings. These layers only subscribe and render; they do not send navigation goals or robot commands.

**Camera images in 3D:** open **Settings → Visualizations → Add visualization → Camera image**, then select an Image or CompressedImage topic. Encoded color/mono topics are offered first to reduce live bandwidth; live subscriptions request at most 10 frames/s from rosbridge. Under that layer, choose the matching **CameraInfo topic** (a discovered `camera_info` in the same camera namespace is selected automatically). Set **Image plane distance** (default 1 m), **Image opacity**, **Show layer** and **Show frustum**. Settings are saved with the panel; appearance changes do not restart image subscriptions.

Choose **Rectified** geometry for rectified images (`image_rect*` topics default to it); the layer uses projection intrinsics P and inverse rectification R. The optical frame comes from the image header and TF, so stereo baseline is not applied a second time from P. **Raw** geometry uses K and supports pinhole images with zero distortion. Images with nonzero distortion or non-pinhole models require rectification by the ROS image pipeline first. ROI/binning adjust the intrinsics; unsupported rectified ROIs with `do_rectify`, uncalibrated cameras and dimension/frame mismatches hide the layer and show a reason. Independent cropping/resizing must be accompanied by corrected CameraInfo.

**Calibration timing** defaults to matching the image timestamp exactly. A zero/omitted CameraInfo stamp is treated as timeless calibration; a zero/omitted image stamp uses the latest calibration/TF. Set a tolerance in milliseconds for approximate calibration matching, or explicitly choose **Latest (static calibration)** for fixed intrinsics published separately. TF always follows the image's acquisition timestamp. The last complete image, calibration and pose stay visible while the next image waits for calibration or TF; a sustained wait shows a stale-image notice after 500 ms. Pixels and pose change together when a complete frame is ready. Already displayed poses stay fixed until the next image or a fixed-frame change, and late images with older nonzero timestamps are ignored. This can leave a held image at an earlier robot pose while the robot continues moving. The optical convention is +X right, +Y down, +Z forward.

Raw RGB/BGR/RGBA/BGRA, mono and packed YUV images share the existing replay decoder; JPEG/PNG compressed images use the browser decoder. Raw 16-bit/float depth appears only as a stretched intensity preview on the flat plane; compressedDepth is unsupported in this 3D layer. This is an image at a chosen distance, not surface projection, occlusion estimation or depth reconstruction. Image messages/decoding are shared by source and topic across 3D layers and recorded Camera panels, with one in-flight decode, one newest pending frame and 64 calibration samples. Images are bounded to 8 megapixels, 8,192 per side, 64 MiB of pixel/encoded bytes, and the GPU texture limit. The 3D layer defaults to **Camera streamer**, using MJPEG with acquisition metadata. In its visualization settings, explicitly choose **ROS image messages** to use ROS instead; saved explicit ROS choices are preserved. Compatible Camera/3D profiles share one download and decode; Camera keeps its playback rate while 3D samples up to 10 fps. Missing metadata or an unavailable streamer produces a visible error and never switches transports automatically. ROS mode uses exactly the selected topic. To retry the streamer, switch sources away and back or change its stream quality. See [Camera streams](camera-streams.md) for backend deployment requirements and compatibility. Both camera views follow recorded messages and playback seeks without querying a live camera.

Point clouds honor XYZ field types and offsets, byte order, and organized-cloud row padding. Invalid points are skipped, and decoding is limited by the layer's maximum point count. Color-axis shaders and point-size controls remain available.

Navigation: drag to orbit, scroll to zoom, and pan with a middle- or right-button drag or by holding `Ctrl`, `Shift`, or `⌘` while dragging (the cursor turns into a hand). On touch screens, one finger orbits and two fingers pan and pinch-zoom.

### Data Explorer

The Data Explorer lists the robot's topics, services, actions and nodes with their publisher, subscriber, client and server counts, measures the traffic of topics you watch, shows message contents and interface schemas, draws who talks to whom, and collects diagnostics, logs and your own topic health rules. From a topic you can open Time Series, 3D, Camera, TF tree or recording settings. Endpoint counts, delivery settings and host-side rates need the ROS inspection companion, which the Docker stack starts; see [Data Explorer](data-explorer.md) for what each measurement means and how to deploy the companion.

In **Parameters**, select a node to inspect typed values and descriptions. Stage edits, choose **Review changes**,
then **Apply changes** with robot control. Read-only values cannot be edited, and live changes are checked before
submission. See [parameter browsing and editing](data-explorer.md#parameters) for limits and ROS stack setup.

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
