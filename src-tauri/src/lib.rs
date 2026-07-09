#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  configure_linux_webkit_runtime();

  const DESKTOP_UI_ZOOM: f64 = 0.9;

  let debug_page_load = std::env::var_os("ROBOBOY_DESKTOP_DEBUG").is_some();

  tauri::Builder::default()
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
      if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        if let Err(error) = webview.set_zoom(DESKTOP_UI_ZOOM) {
          eprintln!("[Robo-Boy] failed to set desktop UI zoom: {error}");
        }
      }

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
fn configure_linux_webkit_runtime() {
  // WebKitGTK 2.52 can crash its WebKitWebProcess with SIGBUS on some
  // AppImage + GPU driver combinations, showing only a white window.
  // Disabling the DMABUF renderer keeps the AppImage on the safer rendering
  // path while respecting a user-provided override.
  if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
  }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_runtime() {}
