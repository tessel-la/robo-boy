# iOS Application

The iOS app is the same React application as the web and desktop builds, wrapped in Tauri's iOS
shell. Like the desktop app, it neither bundles nor starts ROS: it connects to a ROS 2 stack
running on another computer, over the network.

## A Mac Is Required

Apple's toolchain only runs on macOS, so the whole iOS path — building, signing, and installing —
has to happen there. On Linux and Windows the `ios` subcommand is not even present in the Tauri CLI:

```
error: unrecognized subcommand 'ios'
```

Everything in this repository that iOS needs is committed and platform-independent, so a Mac only
has to clone the branch and run the commands below. Without one, rent a hosted Mac for the build
step: see [Building Without A Mac](#building-without-a-mac), which is how the app is built today.

## Prerequisites

On the Mac, once:

1. **Xcode** from the App Store, opened once to accept its licence, then
   `xcode-select --install` for the command line tools.
2. **Rust**, plus the iOS targets:

   ```bash
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
   ```

3. **CocoaPods**: `brew install cocoapods`.
4. **Node**, then `npm ci` in this repository.

Code signing is mandatory on iOS, even to run on your own phone. Tauri reads the team from
`APPLE_DEVELOPMENT_TEAM`; the value is the ten-character Team ID from
[developer.apple.com](https://developer.apple.com/account) under Membership details, or from
Xcode → Settings → Accounts → Manage Certificates.

```bash
export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX
```

A free Apple ID is enough to run the app on your own device; the signature then expires after seven
days and the app has to be reinstalled. A paid Apple Developer account signs for a year and can
distribute through TestFlight.

## Generate The Xcode Project

```bash
npm run ios:init
```

This writes `src-tauri/gen/apple/`, an Xcode project generated from `src-tauri/tauri.conf.json`, the
app icons in `src-tauri/icons/ios/`, and `src-tauri/Info.ios.plist`. It is generated output and is
not tracked by git — rerun the command after changing any of those inputs, and never edit the
generated project by hand.

## Run It

On a simulator, which shares the Mac's network and so can reach a robot on the LAN:

```bash
npm run ios:dev
```

On a physical device, connected by cable and unlocked:

```bash
npm run ios:dev -- --host
```

`--host` picks the LAN address the phone will use to reach the Vite dev server and passes it as
`TAURI_DEV_HOST`; `config/vite.config.ts` binds and serves HMR on that address. The Mac and the
phone have to be on the same network.

If Xcode needs to be involved — to pick a signing team interactively, or to read a build error in
full — open the generated project instead:

```bash
npm run ios:dev -- --open
```

## Install On A Phone

`npm run ios:dev -- --host` already installs and launches a debug build on the connected device, and
is the quickest way to try the app.

For a build that runs without a laptop attached:

```bash
npm run ios:build
```

The signed `.ipa` is written under `src-tauri/gen/apple/build/`. Install it with Xcode's Devices and
Simulators window (Window → Devices and Simulators → drag the `.ipa` onto Installed Apps), or upload
it to TestFlight with a paid account.

On first launch, iOS asks for permission to find devices on the local network. **Allow it** — every
connection Robo-Boy makes is to the ROS computer, so declining leaves the app unable to connect at
all. If it was declined, turn it back on under Settings → Privacy & Security → Local Network →
Robo-Boy. A free-account signature also has to be trusted once, under Settings → General → VPN &
Device Management.

## Connecting To ROS

The phone is not the ROS computer, so **Quick Connect will not work**: it uses `localhost`, which on
a phone means the phone. Open the advanced connection options, choose **Host or IP**, and enter the
ROS computer's LAN or VPN address. From there the contract is the same as the desktop app's, on the
same ports:

| Service              | Default endpoint   |
| -------------------- | ------------------ |
| rosbridge            | `ws://HOST:9090`   |
| web_video_server     | `http://HOST:8080` |
| Optional mesh server | `http://HOST:8000` |

Two things on the ROS side decide whether this works:

- rosbridge and `web_video_server` must listen on the machine's network interface rather than only
  on `127.0.0.1`. The `ros-stack` Compose service already publishes both.
- A firewall on the ROS computer has to allow ports 9090 and 8080 from the phone.

## Building Without A Mac

The `iOS Build` workflow builds the app on a GitHub-hosted macOS runner, so no Mac of your own is
involved. It produces `ios-unsigned`, an artifact holding `Robo-Boy-unsigned.ipa` (about 5 MB),
downloadable from the run's summary page.

It runs on any pull request that changes `src-tauri/` or the workflow itself, and on demand from the
repository's **Actions** tab → **iOS Build** → **Run workflow**. GitHub only lists a workflow for
manual runs once it is on the default branch, so on a branch the pull request is how to run it.

The runner holds no signing certificate, and Xcode will not build an app for a device without
deciding how to sign it, so the workflow patches the generated project to sign nothing at all
(`CODE_SIGN_STYLE = Manual` with no team, written into the XcodeGen spec and regenerated — an
xcconfig cannot do it, because it applies at the project level and XcodeGen writes the team on the
target). Compiling and linking then succeed; only Tauri's final export step fails, which is
expected, and the app is taken from Xcode's derived data and zipped into an `.ipa` by hand.

**A consequence worth knowing:** the artifact is a real arm64 device build with the right
`Info.plist`, but it carries no signature, so iOS will not install it as-is. Which step comes next
depends on the account you have:

- **No Apple Developer account.** Re-sign the `.ipa` with your own free Apple ID and install it,
  using [Sideloadly](https://sideloadly.io) on Windows or macOS, or
  [AltServer-Linux](https://github.com/NyaMisty/AltServer-Linux) on Linux. The signature lasts seven
  days, after which the app has to be reinstalled.
- **A paid Apple Developer account ($99/year).** Add the distribution certificate and provisioning
  profile to the repository's secrets and sign in the workflow instead of stripping signing out of
  it, then upload to TestFlight. The app installs on the phone straight from TestFlight with no
  computer involved, and the signature lasts a year. This repository does not do that yet.

Nothing in that route needs the local `ios:*` commands, but it is also slower to iterate on than a
real Mac: every change is a full CI run.

## App Transport Security

iOS refuses plaintext `http://` and `ws://` by default, which is all rosbridge and
`web_video_server` speak. `src-tauri/Info.ios.plist` sets `NSAllowsLocalNetworking`, which lifts
that restriction for private and link-local addresses only — LAN addresses and VPN addresses such as
`10.x.x.x` are covered, and the rest of the app keeps App Transport Security.

Reaching a robot across the public internet in the clear is not covered and would need
`NSAllowsArbitraryLoadsInWebContent` added to the same file. Prefer a VPN, whose addresses are
private and already allowed.

## What Differs From Desktop

The iOS shell reaches the robot exactly as the desktop shell does — a direct connection to the
chosen host, resolved in `src/runtime/runtimeConfig.tsx`. Only the chrome differs:

- The desktop window is undecorated, so the app draws its own title bar and resize edges. A phone
  has no window controls, so `drawsOwnWindowChrome()` keeps `TitleBar` out of the mobile shell.
- `main.tsx` marks the document `data-shell="mobile"` and opts the viewport into the full screen, so
  the app lays out between the status bar and the home indicator rather than under them.

## Known Rough Edges

The app builds, and its `Info.plist` has been checked against a packaged artifact. Nothing below has
been exercised on a device yet:

- **Status bar contrast.** The system draws the status bar over the app's own themed background and
  picks its text colour from the phone's light/dark setting, not from the Robo-Boy theme. A light
  phone running a dark Robo-Boy theme may read poorly.
- **Panel installation.** External panels install through the same in-app path as desktop, over
  Tauri's native HTTP client. It is untested on iOS.
- **Voice control** needs iOS 14.3 or later, which is where `getUserMedia` arrived in `WKWebView`.
  The app's minimum is 14.0, so on 14.0 to 14.2 everything else works and the voice pad does not.
