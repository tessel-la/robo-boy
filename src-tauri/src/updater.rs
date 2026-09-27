//! Updates for the packaged Tauri shell.
//!
//! The page decides whether to update and to which release; everything that has to be trusted
//! happens here. The release is looked up again over this process's own certificate-checked
//! connection, the installer is fetched only from GitHub's hosts, checked against the SHA-256 GitHub
//! publishes for it, and installed only from the path this module wrote. The page never hands over a
//! path or a checksum.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_http::reqwest;

const REPOSITORY: &str = "tessel-la/robo-boy";
/// The installers a Tauri install can update itself from: the stable names every release publishes.
const INSTALLERS: [&str; 4] = [
  "Robo-Boy-windows-x64-setup.exe",
  "Robo-Boy-macos-universal.dmg",
  "Robo-Boy-linux-amd64.deb",
  "Robo-Boy-linux-x86_64.rpm",
];
const DOWNLOAD_HOSTS: [&str; 3] = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
const MAX_SIZE: u64 = 1 << 30;

#[derive(Default)]
pub struct UpdateState {
  cancel: AtomicBool,
  /// The installer this module downloaded and checked; the only file it will install.
  verified: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Clone)]
pub struct Target {
  shell: &'static str,
  os: &'static str,
  arch: &'static str,
  package: &'static str,
}

#[derive(Serialize, Clone)]
struct Progress {
  received: u64,
  total: u64,
}

fn arch() -> &'static str {
  if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" }
}

fn update_dir() -> PathBuf {
  std::env::temp_dir().join("robo-boy-update")
}

/// How this copy was installed, or nothing when it cannot replace itself: a development build, a
/// phone (the store or the installer file updates it), or a Linux copy no package manager owns.
#[tauri::command]
pub fn update_target() -> Option<Target> {
  if cfg!(debug_assertions) {
    return None;
  }
  platform_target()
}

#[cfg(target_os = "windows")]
fn platform_target() -> Option<Target> {
  Some(Target { shell: "tauri", os: "windows", arch: arch(), package: "nsis" })
}

#[cfg(target_os = "macos")]
fn platform_target() -> Option<Target> {
  Some(Target { shell: "tauri", os: "macos", arch: arch(), package: "dmg" })
}

#[cfg(target_os = "linux")]
fn platform_target() -> Option<Target> {
  let exe = std::env::current_exe().ok()?;
  let owned = |program: &str, flag: &str| {
    std::process::Command::new(program)
      .arg(flag)
      .arg(&exe)
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  };
  let package = if owned("dpkg-query", "-S") {
    "deb"
  } else if owned("rpm", "-qf") {
    "rpm"
  } else {
    return None;
  };
  Some(Target { shell: "tauri", os: "linux", arch: arch(), package })
}

#[cfg(mobile)]
fn platform_target() -> Option<Target> {
  None
}

fn is_release_tag(tag: &str) -> bool {
  tag
    .strip_prefix("robo-boy-v")
    .map(|version| {
      version.starts_with(|c: char| c.is_ascii_digit())
        && version.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    })
    .unwrap_or(false)
}

fn discard() {
  let _ = std::fs::remove_dir_all(update_dir());
}

#[tauri::command]
pub async fn update_download(app: AppHandle, state: State<'_, UpdateState>, tag: String, name: String) -> Result<(), String> {
  state.cancel.store(false, Ordering::SeqCst);
  *state.verified.lock().map_err(|_| "The updater is busy.")? = None;
  let path = fetch_verified(&tag, &name, &state.cancel, |received, total| {
    let _ = app.emit("roboboy://update-progress", Progress { received, total });
  })
  .await?;
  *state.verified.lock().map_err(|_| "The updater is busy.")? = Some(path);
  Ok(())
}

/// Looks the installer up on GitHub, downloads it only from GitHub's hosts and keeps it only if it
/// matches the size and SHA-256 GitHub publishes. Reports progress at most every 100 ms, and once
/// more at the end.
async fn fetch_verified(tag: &str, name: &str, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
  if !is_release_tag(tag) || !INSTALLERS.contains(&name) {
    return Err("That is not a Robo-Boy installer.".into());
  }

  let client = reqwest::Client::builder()
    .user_agent("Robo-Boy-updater")
    .redirect(reqwest::redirect::Policy::custom(|attempt| {
      let allowed = attempt.url().scheme() == "https" && DOWNLOAD_HOSTS.contains(&attempt.url().host_str().unwrap_or(""));
      if attempt.previous().len() > 5 || !allowed { attempt.stop() } else { attempt.follow() }
    }))
    .build()
    .map_err(|error| error.to_string())?;

  let offline = |_| "GitHub could not be reached to download the update.".to_string();
  let described = client
    .get(format!("https://api.github.com/repos/{REPOSITORY}/releases/tags/{tag}"))
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .map_err(offline)?
    .error_for_status()
    .map_err(|error| format!("GitHub did not describe release {tag} ({error})."))?
    .text()
    .await
    .map_err(offline)?;
  let release: serde_json::Value = serde_json::from_str(&described).map_err(|_| format!("GitHub described release {tag} in a way Robo-Boy does not understand."))?;
  let asset = release["assets"]
    .as_array()
    .and_then(|assets| assets.iter().find(|asset| asset["name"].as_str() == Some(name)))
    .ok_or_else(|| format!("Release {tag} has no {name}."))?;
  let sha256 = asset["digest"]
    .as_str()
    .and_then(|digest| digest.strip_prefix("sha256:"))
    .filter(|hex| hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()))
    .ok_or_else(|| format!("Release {tag} publishes no checksum for {name}."))?
    .to_ascii_lowercase();
  let url = asset["browser_download_url"]
    .as_str()
    .filter(|url| url.starts_with(&format!("https://github.com/{REPOSITORY}/releases/download/{tag}/")))
    .ok_or_else(|| format!("Release {tag} names an unexpected address for {name}."))?;
  let size = asset["size"].as_u64().filter(|size| *size > 0 && *size <= MAX_SIZE).ok_or("The installer is not a size Robo-Boy expects.")?;

  discard();
  std::fs::create_dir_all(update_dir()).map_err(|error| error.to_string())?;
  let path = update_dir().join(name);
  let mut response = client.get(url).send().await.map_err(offline)?;
  if !response.url().host_str().map(|host| DOWNLOAD_HOSTS.contains(&host)).unwrap_or(false) {
    return Err("The installer was redirected away from GitHub; nothing was installed.".into());
  }
  if let Err(error) = response.error_for_status_ref() {
    return Err(format!("GitHub did not send the installer ({error})."));
  }

  let result: Result<(u64, String), String> = async {
    use std::io::Write;
    let mut file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut reported = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(offline)? {
      if cancel.load(Ordering::SeqCst) {
        return Err("The download was cancelled.".into());
      }
      received += chunk.len() as u64;
      if received > size {
        return Err("The installer is larger than GitHub says it is; nothing was installed.".into());
      }
      hasher.update(&chunk);
      file.write_all(&chunk).map_err(|error| error.to_string())?;
      if reported.elapsed() > Duration::from_millis(100) {
        reported = Instant::now();
        progress(received, size);
      }
    }
    file.flush().map_err(|error| error.to_string())?;
    Ok((received, format!("{:x}", hasher.finalize())))
  }
  .await;
  let (received, digest) = result.inspect_err(|_| discard())?;
  progress(received, size);
  if received != size || digest != sha256 {
    discard();
    return Err("The download does not match the release (its checksum differs), so nothing was installed. Try again.".into());
  }
  Ok(path)
}

#[tauri::command]
pub fn update_cancel(state: State<'_, UpdateState>) {
  state.cancel.store(true, Ordering::SeqCst);
}

fn verified(state: &State<'_, UpdateState>) -> Result<PathBuf, String> {
  state
    .verified
    .lock()
    .map_err(|_| "The updater is busy.".to_string())?
    .clone()
    .ok_or_else(|| "There is no checked installer.".to_string())
}

/// Installs the checked download and restarts into it.
#[tauri::command]
pub fn update_install(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
  install(&app, &verified(&state)?)
}

/// Hands the checked download to the system, for when installing in place is not possible.
#[tauri::command]
pub fn update_open_installer(state: State<'_, UpdateState>) -> Result<(), String> {
  let path = verified(&state)?;
  let opener = if cfg!(target_os = "windows") { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
  std::process::Command::new(opener).arg(&path).spawn().map(|_| ()).map_err(|error| error.to_string())
}

/// Opens a release's page in the system browser: only ever this repository's, named by its tag.
#[tauri::command]
pub fn update_open_release_page(tag: String) -> Result<(), String> {
  if !is_release_tag(&tag) {
    return Err("That is not a Robo-Boy release.".into());
  }
  let url = format!("https://github.com/{REPOSITORY}/releases/tag/{tag}");
  let mut command = if cfg!(target_os = "windows") {
    let mut command = std::process::Command::new("rundll32");
    command.arg("url.dll,FileProtocolHandler");
    command
  } else {
    std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" })
  };
  command.arg(url).spawn().map(|_| ()).map_err(|error| error.to_string())
}

/// Tauri's NSIS installer: /P runs it with a progress bar and no questions, /R starts the app again
/// when it is done. It replaces files the running app holds open, so the app leaves first.
#[cfg(target_os = "windows")]
fn install(app: &AppHandle, path: &Path) -> Result<(), String> {
  std::process::Command::new(path).args(["/P", "/R"]).spawn().map_err(|error| format!("The installer could not start: {error}"))?;
  app.exit(0);
  Ok(())
}

/// Replaces the running app's bundle with the one inside the disk image, keeping the old bundle
/// until the new one is in place so a failure puts everything back, then opens the new one.
#[cfg(target_os = "macos")]
fn install(app: &AppHandle, path: &Path) -> Result<(), String> {
  use std::process::Command;
  let bundle = std::env::current_exe()
    .map_err(|error| error.to_string())?
    .ancestors()
    .find(|ancestor| ancestor.extension().map(|extension| extension == "app").unwrap_or(false))
    .map(Path::to_path_buf)
    .ok_or("Robo-Boy is not running from an app bundle.")?;
  let mount = update_dir().join("mount");
  std::fs::create_dir_all(&mount).map_err(|error| error.to_string())?;
  let attached = Command::new("hdiutil")
    .args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"])
    .arg(&mount)
    .arg(path)
    .status()
    .map(|status| status.success())
    .unwrap_or(false);
  if !attached {
    return Err("The disk image could not be opened. Open the installer instead.".into());
  }
  let replaced = (|| -> Result<(), String> {
    let source = std::fs::read_dir(&mount)
      .map_err(|error| error.to_string())?
      .filter_map(Result::ok)
      .map(|entry| entry.path())
      .find(|entry| entry.extension().map(|extension| extension == "app").unwrap_or(false))
      .ok_or("The disk image holds no app.")?;
    let staged = bundle.with_extension("app-update");
    let previous = bundle.with_extension("app-previous");
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&previous);
    let copied = Command::new("ditto").arg(&source).arg(&staged).status().map(|status| status.success()).unwrap_or(false);
    if !copied {
      let _ = std::fs::remove_dir_all(&staged);
      return Err("The new version could not be copied next to this one. Open the installer instead.".into());
    }
    std::fs::rename(&bundle, &previous).map_err(|_| "Robo-Boy could not replace itself here. Open the installer instead.".to_string())?;
    if std::fs::rename(&staged, &bundle).is_err() {
      let _ = std::fs::rename(&previous, &bundle);
      return Err("Robo-Boy could not replace itself here. Open the installer instead.".into());
    }
    let _ = std::fs::remove_dir_all(&previous);
    Ok(())
  })();
  let _ = Command::new("hdiutil").args(["detach", "-quiet"]).arg(&mount).status();
  replaced?;
  Command::new("open").arg("-n").arg(&bundle).spawn().map_err(|error| error.to_string())?;
  app.exit(0);
  Ok(())
}

/// Installs the package through the system's own password prompt, then restarts into it.
#[cfg(target_os = "linux")]
fn install(app: &AppHandle, path: &Path) -> Result<(), String> {
  let is_rpm = path.extension().map(|extension| extension == "rpm").unwrap_or(false);
  let manager: &[&str] = if is_rpm { &["/usr/bin/dnf", "install", "-y"] } else { &["/usr/bin/apt-get", "install", "-y"] };
  let status = std::process::Command::new("pkexec")
    .args(manager)
    .arg(path)
    .status()
    .map_err(|_| "This system has no way to ask for administrator rights (pkexec). Open the installer instead.".to_string())?;
  match status.code() {
    Some(0) => app.restart(),
    // pkexec answers 126 when the prompt is dismissed and 127 when authentication fails.
    Some(126) | Some(127) => Err("Installing needs administrator approval, and it was not given.".into()),
    code => Err(format!("The package manager could not install the update (exit {}). Open the installer instead.", code.unwrap_or(-1))),
  }
}

#[cfg(mobile)]
fn install(_app: &AppHandle, _path: &Path) -> Result<(), String> {
  Err("Robo-Boy on a phone is updated from its installer.".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_only_app_release_tags() {
    assert!(is_release_tag("robo-boy-v0.13.0-alpha"));
    assert!(is_release_tag("robo-boy-v1.2.3"));
    for tag in ["panel-sdk-v2.2.0", "robo-boy-v", "robo-boy-vX", "robo-boy-v1.0.0/../x", "robo-boy-v1.0.0?x", "v1.0.0"] {
      assert!(!is_release_tag(tag), "{tag}");
    }
  }

  #[test]
  fn refuses_anything_but_an_app_installer() {
    let cancel = AtomicBool::new(false);
    let refused = tauri::async_runtime::block_on(fetch_verified("robo-boy-v0.13.0-alpha", "../../etc/passwd", &cancel, |_, _| {}));
    assert_eq!(refused.unwrap_err(), "That is not a Robo-Boy installer.");
  }

  /// Downloads a real installer from the latest-but-one release and checks it against GitHub's
  /// digest. Needs the network: `cargo test -- --ignored`.
  #[test]
  #[ignore]
  fn downloads_and_verifies_a_real_release() {
    let cancel = AtomicBool::new(false);
    let mut reports = 0;
    let path = tauri::async_runtime::block_on(fetch_verified("robo-boy-v0.13.0-alpha", "Robo-Boy-linux-amd64.deb", &cancel, |_, _| reports += 1)).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 3_869_458);
    assert!(reports >= 1);
    discard();
  }
}
