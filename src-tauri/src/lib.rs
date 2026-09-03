#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  configure_linux_webkit_runtime();

  const DESKTOP_UI_ZOOM: f64 = 0.9;

  let debug_page_load = std::env::var_os("ROBOBOY_DESKTOP_DEBUG").is_some();

  tauri::Builder::default()
    // Panel installation runs in the app, but the official inventory serves manifests and
    // bundles as GitHub release assets, which send no CORS headers and are therefore
    // unreachable from the webview. This client performs those requests natively instead.
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      use tauri::Manager;

      if let Some(webview_window) = app.get_webview_window("main") {
        if let Err(error) = webview_window.set_zoom(DESKTOP_UI_ZOOM) {
          eprintln!("[Robo-Boy] failed to set desktop UI zoom: {error}");
        }
      }

      Ok(())
    })
    .on_page_load(move |webview, payload| {
      if debug_page_load {
        eprintln!(
          "[Robo-Boy] page load {:?}: {}",
          payload.event(),
          payload.url()
        );

        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
          let webview = webview.clone();
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(750));

            if let Err(error) = webview.eval_with_callback(
              r#"
              JSON.stringify({
                readyState: document.readyState,
                appStarted: Boolean(window.__ROBOBOY_APP_STARTED),
                bodyText: (document.body && document.body.innerText || '').slice(0, 240),
                scripts: Array.from(document.scripts).map((script) => ({
                  src: script.src,
                  type: script.type,
                  defer: script.defer,
                })),
                bootErrors: window.__ROBOBOY_BOOT_ERRORS || [],
              })
            "#,
              |result| {
                eprintln!("[Robo-Boy] webview probe: {result}");
              },
            ) {
              eprintln!("[Robo-Boy] webview probe failed: {error}");
            }
          });
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxRenderer {
  /// Let WebKitGTK use its accelerated DMABUF path.
  Gpu,
  /// Keep WebKitGTK off the DMABUF path, which some GPU setups never present.
  Compatibility,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy)]
struct RendererFacts {
  /// ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING, when set to something conclusive.
  forced: Option<bool>,
  wayland: bool,
  nvidia: bool,
  gpu_count: usize,
}

/// WebKitGTK negotiates DMABUF buffers with a single render device. On a Wayland session driven
/// by more than one GPU with the proprietary NVIDIA driver loaded -- a laptop with an external
/// GPU, or a discrete card feeding an external monitor -- the buffers it hands the compositor can
/// go unpresented, leaving a window that renders black or stops responding, typically after a
/// resize moves the surface between outputs. Those setups start on the compatibility path instead;
/// everything else keeps GPU rendering. Either choice can be overridden explicitly.
#[cfg(target_os = "linux")]
fn choose_linux_renderer(facts: RendererFacts) -> LinuxRenderer {
  if let Some(forced) = facts.forced {
    return if forced { LinuxRenderer::Compatibility } else { LinuxRenderer::Gpu };
  }

  if facts.wayland && facts.nvidia && facts.gpu_count > 1 {
    return LinuxRenderer::Compatibility;
  }

  LinuxRenderer::Gpu
}

#[cfg(target_os = "linux")]
fn parse_bool_env(value: &str) -> Option<bool> {
  match value.trim().to_ascii_lowercase().as_str() {
    "1" | "true" | "yes" | "on" => Some(true),
    "0" | "false" | "no" | "off" => Some(false),
    _ => None,
  }
}

#[cfg(target_os = "linux")]
fn count_drm_cards() -> usize {
  std::fs::read_dir("/sys/class/drm")
    .map(|entries| {
      entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
          let name = entry.file_name();
          let name = name.to_string_lossy();
          name.len() > 4 && name.starts_with("card") && name[4..].chars().all(|c| c.is_ascii_digit())
        })
        .count()
    })
    .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn detect_renderer_facts() -> RendererFacts {
  RendererFacts {
    forced: std::env::var("ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING")
      .ok()
      .and_then(|value| parse_bool_env(&value)),
    wayland: std::env::var_os("WAYLAND_DISPLAY").is_some()
      || std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false),
    nvidia: std::path::Path::new("/sys/module/nvidia").exists(),
    gpu_count: count_drm_cards(),
  }
}

#[cfg(target_os = "linux")]
fn configure_linux_webkit_runtime() {
  // Last resort for sessions where the window renders but never takes input: run through
  // XWayland. Deliberately opt-in, since it gives up Wayland-native output scaling.
  if std::env::var("ROBOBOY_DESKTOP_FORCE_X11")
    .ok()
    .and_then(|value| parse_bool_env(&value))
    .unwrap_or(false)
    && std::env::var_os("GDK_BACKEND").is_none()
  {
    std::env::set_var("GDK_BACKEND", "x11");
    eprintln!("[Robo-Boy] rendering through XWayland (ROBOBOY_DESKTOP_FORCE_X11)");
  }

  let facts = detect_renderer_facts();
  if choose_linux_renderer(facts) != LinuxRenderer::Compatibility {
    return;
  }

  // Never override a choice the user already made for this session.
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    eprintln!(
      "[Robo-Boy] compatibility rendering enabled (wayland={}, nvidia={}, gpus={}); \
       set ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING=0 to force GPU rendering",
      facts.wayland, facts.nvidia, facts.gpu_count
    );
  }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_runtime() {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
  use super::{choose_linux_renderer, parse_bool_env, LinuxRenderer, RendererFacts};

  const HYBRID_WAYLAND: RendererFacts = RendererFacts {
    forced: None,
    wayland: true,
    nvidia: true,
    gpu_count: 2,
  };

  #[test]
  fn starts_multi_gpu_wayland_sessions_on_the_compatibility_path() {
    assert_eq!(choose_linux_renderer(HYBRID_WAYLAND), LinuxRenderer::Compatibility);
  }

  #[test]
  fn keeps_gpu_rendering_where_the_dmabuf_path_is_not_known_to_fail() {
    let x11 = RendererFacts { wayland: false, ..HYBRID_WAYLAND };
    let single_gpu = RendererFacts { gpu_count: 1, ..HYBRID_WAYLAND };
    let without_nvidia = RendererFacts { nvidia: false, ..HYBRID_WAYLAND };

    for facts in [x11, single_gpu, without_nvidia] {
      assert_eq!(choose_linux_renderer(facts), LinuxRenderer::Gpu, "{facts:?}");
    }
  }

  #[test]
  fn an_explicit_choice_wins_over_detection() {
    let forced_on = RendererFacts { forced: Some(true), wayland: false, nvidia: false, gpu_count: 1 };
    let forced_off = RendererFacts { forced: Some(false), ..HYBRID_WAYLAND };

    assert_eq!(choose_linux_renderer(forced_on), LinuxRenderer::Compatibility);
    assert_eq!(choose_linux_renderer(forced_off), LinuxRenderer::Gpu);
  }

  #[test]
  fn reads_only_conclusive_boolean_settings() {
    assert_eq!(parse_bool_env("1"), Some(true));
    assert_eq!(parse_bool_env(" ON "), Some(true));
    assert_eq!(parse_bool_env("0"), Some(false));
    assert_eq!(parse_bool_env("off"), Some(false));
    assert_eq!(parse_bool_env("maybe"), None);
  }
}
