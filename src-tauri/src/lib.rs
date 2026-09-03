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
  /// Connected outputs are driven by more than one GPU, so a window can move between devices.
  outputs_span_gpus: bool,
  /// Connected outputs whose pixel density implies different compositor scale factors.
  mixed_scales: bool,
}

/// One connected output, as far as the kernel describes it before any toolkit starts.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OutputFacts {
  /// Index of the DRM card driving this output.
  card: u32,
  width_px: u32,
  width_mm: u32,
}

/// The integer scale a compositor is likely to pick for an output, by the usual 96 dpi rule.
/// `None` when the kernel reports no usable physical size, which rules the output out rather
/// than letting a bogus density decide the renderer.
#[cfg(target_os = "linux")]
fn estimate_output_scale(output: OutputFacts) -> Option<u32> {
  if output.width_px == 0 || output.width_mm == 0 {
    return None;
  }
  let dpi = f64::from(output.width_px) / (f64::from(output.width_mm) / 25.4);
  Some(((dpi / 96.0).round() as u32).max(1))
}

#[cfg(target_os = "linux")]
fn outputs_span_multiple_gpus(outputs: &[OutputFacts]) -> bool {
  let mut cards: Vec<u32> = outputs.iter().map(|output| output.card).collect();
  cards.sort_unstable();
  cards.dedup();
  cards.len() > 1
}

#[cfg(target_os = "linux")]
fn has_mixed_output_scales(outputs: &[OutputFacts]) -> bool {
  let mut seen: Vec<u32> = outputs.iter().filter_map(|o| estimate_output_scale(*o)).collect();
  seen.sort_unstable();
  seen.dedup();
  seen.len() > 1
}

/// WebKitGTK negotiates DMABUF buffers with a single render device, and the buffers can go
/// unpresented when the compositor has to scan them out on a different one -- leaving a window
/// that renders black or stops taking input, typically after a resize moves it between outputs.
///
/// That needs displays actually attached to more than one GPU, or outputs at different scales,
/// which forces the same reallocation. Anything short of that keeps GPU rendering: the
/// compatibility path costs real performance, so it is reserved for setups that can hit the bug
/// rather than every machine that merely has a second GPU installed. Either choice can be
/// overridden explicitly.
#[cfg(target_os = "linux")]
fn choose_linux_renderer(facts: RendererFacts) -> LinuxRenderer {
  if let Some(forced) = facts.forced {
    return if forced { LinuxRenderer::Compatibility } else { LinuxRenderer::Gpu };
  }

  // Only when a window can actually cross between devices: a second GPU that drives no display
  // never presents anything, so its mere presence is no reason to give up GPU rendering.
  if facts.wayland && facts.nvidia && facts.outputs_span_gpus {
    return LinuxRenderer::Compatibility;
  }

  // Outputs at different scales make the toolkit reallocate buffers whenever a window crosses
  // between them, which is the other way the same rendering path drops frames or loses its
  // input region -- and it needs no second GPU to happen.
  if facts.wayland && facts.mixed_scales {
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

/// Reads connected outputs straight from DRM: the connector directory names the card driving it,
/// the preferred mode gives pixel width, and EDID byte 21 the physical width in centimetres.
#[cfg(target_os = "linux")]
fn read_connected_outputs() -> Vec<OutputFacts> {
  let Ok(entries) = std::fs::read_dir("/sys/class/drm") else {
    return Vec::new();
  };

  let mut outputs = Vec::new();
  for entry in entries.filter_map(|entry| entry.ok()) {
    let path = entry.path();
    if std::fs::read_to_string(path.join("status")).map(|s| s.trim() != "connected").unwrap_or(true) {
      continue;
    }

    let card = entry
      .file_name()
      .to_string_lossy()
      .strip_prefix("card")
      .and_then(|rest| rest.split('-').next().and_then(|index| index.parse().ok()))
      .unwrap_or(u32::MAX);
    let width_px = std::fs::read_to_string(path.join("modes"))
      .ok()
      .and_then(|modes| modes.lines().next().map(str::to_owned))
      .and_then(|mode| mode.split_once('x').and_then(|(width, _)| width.trim().parse().ok()))
      .unwrap_or(0);
    let width_mm = std::fs::read(path.join("edid"))
      .ok()
      .filter(|edid| edid.len() > 21)
      .map(|edid| u32::from(edid[21]) * 10)
      .unwrap_or(0);

    outputs.push(OutputFacts { card, width_px, width_mm });
  }
  outputs
}

#[cfg(target_os = "linux")]
fn detect_renderer_facts() -> RendererFacts {
  let outputs = read_connected_outputs();
  RendererFacts {
    forced: std::env::var("ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING")
      .ok()
      .and_then(|value| parse_bool_env(&value)),
    wayland: std::env::var_os("WAYLAND_DISPLAY").is_some()
      || std::env::var("XDG_SESSION_TYPE")
        .map(|value| value.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false),
    nvidia: std::path::Path::new("/sys/module/nvidia").exists(),
    outputs_span_gpus: outputs_span_multiple_gpus(&outputs),
    mixed_scales: has_mixed_output_scales(&outputs),
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
      "[Robo-Boy] compatibility rendering enabled (wayland={}, nvidia={}, outputs_span_gpus={}, \
       mixed_scales={}); set ROBOBOY_DESKTOP_COMPATIBILITY_RENDERING=0 to force GPU rendering",
      facts.wayland, facts.nvidia, facts.outputs_span_gpus, facts.mixed_scales
    );
  }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_runtime() {}

#[cfg(all(test, target_os = "linux"))]
mod tests {
  use super::{
    choose_linux_renderer, estimate_output_scale, has_mixed_output_scales, outputs_span_multiple_gpus,
    parse_bool_env, LinuxRenderer, OutputFacts, RendererFacts,
  };

  /// A 27-inch 4K panel and a 24-inch 1080p one: the everyday mixed-scale desk.
  const UHD_27: OutputFacts = OutputFacts { card: 0, width_px: 3840, width_mm: 597 };
  const FHD_24: OutputFacts = OutputFacts { card: 0, width_px: 1920, width_mm: 527 };

  const HYBRID_WAYLAND: RendererFacts = RendererFacts {
    forced: None,
    wayland: true,
    nvidia: true,
    outputs_span_gpus: true,
    mixed_scales: false,
  };

  #[test]
  fn starts_multi_gpu_wayland_sessions_on_the_compatibility_path() {
    assert_eq!(choose_linux_renderer(HYBRID_WAYLAND), LinuxRenderer::Compatibility);
  }

  #[test]
  fn keeps_gpu_rendering_where_the_dmabuf_path_is_not_known_to_fail() {
    let x11 = RendererFacts { wayland: false, ..HYBRID_WAYLAND };
    let one_card_drives_the_displays = RendererFacts { outputs_span_gpus: false, ..HYBRID_WAYLAND };
    let without_nvidia = RendererFacts { nvidia: false, ..HYBRID_WAYLAND };

    for facts in [x11, one_card_drives_the_displays, without_nvidia] {
      assert_eq!(choose_linux_renderer(facts), LinuxRenderer::Gpu, "{facts:?}");
    }
  }

  #[test]
  fn starts_mixed_scale_wayland_desks_on_the_compatibility_path() {
    // No second GPU involved: differing output scales are enough on their own.
    let mixed =
      RendererFacts { nvidia: false, outputs_span_gpus: false, mixed_scales: true, ..HYBRID_WAYLAND };
    let mixed_on_x11 = RendererFacts { wayland: false, ..mixed };

    assert_eq!(choose_linux_renderer(mixed), LinuxRenderer::Compatibility);
    assert_eq!(choose_linux_renderer(mixed_on_x11), LinuxRenderer::Gpu);
  }

  #[test]
  fn a_second_gpu_counts_only_when_it_drives_a_display() {
    let on_one_card = [UHD_27, FHD_24];
    let across_cards = [UHD_27, OutputFacts { card: 1, ..FHD_24 }];

    assert!(!outputs_span_multiple_gpus(&on_one_card));
    assert!(outputs_span_multiple_gpus(&across_cards));
    // A hybrid machine with nothing plugged into the second card keeps GPU rendering.
    assert!(!outputs_span_multiple_gpus(&[UHD_27]));
  }

  #[test]
  fn reads_output_scale_from_pixel_density() {
    assert_eq!(estimate_output_scale(UHD_27), Some(2));
    assert_eq!(estimate_output_scale(FHD_24), Some(1));
  }

  #[test]
  fn ignores_outputs_the_kernel_cannot_measure() {
    let no_size = OutputFacts { card: 0, width_px: 3840, width_mm: 0 };
    let no_mode = OutputFacts { card: 0, width_px: 0, width_mm: 597 };

    assert_eq!(estimate_output_scale(no_size), None);
    assert_eq!(estimate_output_scale(no_mode), None);
    // One measurable output and one unmeasurable is not evidence of mixed scales.
    assert!(!has_mixed_output_scales(&[UHD_27, no_size]));
  }

  #[test]
  fn spots_only_genuinely_differing_scales() {
    assert!(has_mixed_output_scales(&[UHD_27, FHD_24]));
    assert!(!has_mixed_output_scales(&[FHD_24, FHD_24]));
    assert!(!has_mixed_output_scales(&[UHD_27]));
    assert!(!has_mixed_output_scales(&[]));
  }

  #[test]
  fn an_explicit_choice_wins_over_detection() {
    let forced_on =
      RendererFacts { forced: Some(true), wayland: false, nvidia: false, outputs_span_gpus: false, mixed_scales: false };
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
