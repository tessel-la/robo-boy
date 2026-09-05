# Android Application

The Android app is the same React controller as Robo-Boy web and desktop, wrapped in Tauri's
Android shell. It does not bundle ROS. The phone connects directly to rosbridge, the video server,
and the optional mesh server running on the robot or ROS computer.

## Prerequisites

Install these once:

- Android Studio with JDK 17.
- Android SDK Platform 36, Build Tools 36.0.0, and NDK 27.0.12077973 from **Tools → SDK Manager**.
- Node.js 20 or newer.
- Rust, with the ARM64 Android target used by current phones and Wear OS devices:

  ```bash
  rustup target add aarch64-linux-android
  ```

  Add `x86_64-linux-android` as well when using an x86_64 emulator.

Then install the JavaScript dependencies from the repository root:

```bash
npm ci
```

The Android Studio project is committed at `src-tauri/gen/android`. Do not run `android:init` after
cloning: that command is only for deliberately regenerating the native project after a Tauri
upgrade and can replace its manifest and Gradle settings.

## Run On Your Android Phone

1. On the phone, enable **Developer options** and **USB debugging**.
2. Connect it by USB, unlock it, and accept the computer's debugging key.
3. Check that it appears:

   ```bash
   adb devices
   ```

4. From the repository root, let Tauri open the generated project and development server:

   ```bash
   npm run android:dev -- --open
   ```

5. In Android Studio choose the phone and the `app` run configuration, then press **Run**.

For a bundled APK that does not need the development server:

```bash
npm run android:build -- --debug --target aarch64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The debug APK is signed with Android's development key. Production Play Store delivery needs a
private release signing key and is intentionally not configured in this sandbox.

## Connect To ROS

On a phone, **Quick Connect** points to the phone itself and normally cannot find ROS. Open the
advanced connection options, choose **Host or IP**, and enter the ROS computer's LAN or VPN address.

| Service              | Default endpoint   |
| -------------------- | ------------------ |
| rosbridge            | `ws://HOST:9090`   |
| web_video_server     | `http://HOST:8080` |
| Optional mesh server | `http://HOST:8000` |

Android blocks plaintext network traffic in release apps by default. Robo-Boy explicitly permits
it because the standard ROS endpoints above are plaintext and the host is selected at runtime.
Use a trusted LAN or VPN; do not expose these unauthenticated services directly to the internet.
The ROS computer's firewall must allow the selected ports from the phone.

The microphone permission supports the hold-to-talk controls. Android asks for it only when a voice
control is used; denying it leaves the rest of Robo-Boy usable.

## CI APK

The **Android Build** workflow builds the same project on every pull request and push to `main`.
Its `robo-boy-android-debug` artifact contains a signed, installable APK and needs no repository
secrets. Download the artifact from the workflow run, unzip it, and install it with `adb install`.

## Wear OS Direction

The shared runtime already treats every Android WebView as a mobile shell, so it omits desktop
window controls, respects system insets, rotates, and keeps ROS state out of the native activity.
That makes a future Wear OS client able to reuse the connection and ROS layers.

Do not publish this phone APK as a watch app yet. Wear OS delivery should add a dedicated watch
module (with `android.hardware.type.watch`) and a small round-screen control surface. The current
camera, 3D, and behavior-tree workspace is too dense for a watch; a useful first watch surface would
contain connection status, emergency stop, and a few large command buttons while the phone retains
configuration and visualization.
