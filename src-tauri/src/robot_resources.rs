//! Read-only mesh transport for Tauri desktop and mobile. The selected server can be local,
//! remote, or on a custom port; no browser CORS headers are required on that server.
use std::time::Duration;
use tauri::http::{Request, Response};
use tauri_plugin_http::reqwest::{self, Url};

fn allowed(base: &Url, url: &Url) -> bool {
  let directory = format!("{}/", base.path().trim_end_matches('/'));
  let path = url.path().to_ascii_lowercase();
  matches!(base.scheme(), "http" | "https")
    && base.username().is_empty() && base.password().is_none()
    && url.username().is_empty() && url.password().is_none()
    && base.origin() == url.origin() && url.path().starts_with(&directory)
    && !path.contains("%2f") && !path.contains("%5c")
}

fn reply(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
  Response::builder().status(status)
    .header("Content-Security-Policy", "default-src 'none'; sandbox")
    .header("X-Content-Type-Options", "nosniff")
    .header("Content-Type", content_type)
    .body(body).unwrap()
}

pub async fn fetch(request: Request<Vec<u8>>, renderer_origin: Option<&str>) -> Response<Vec<u8>> {
  let Some(origin) = renderer_origin.filter(|origin| *origin != "null") else {
    return reply(403, "text/plain", vec![]);
  };
  if request.headers().get("origin").and_then(|value| value.to_str().ok()) != Some(origin) {
    return reply(403, "text/plain", vec![]);
  }
  let mut response = if request.method() != "GET" { reply(405, "text/plain", vec![]) }
  else { match fetch_inner(request).await {
    Ok(response) => response,
    Err(error) => {
      eprintln!("[robot-resource] {error}");
      reply(502, "text/plain", vec![])
    }
  }};
  if let Ok(value) = origin.parse() { response.headers_mut().insert("Access-Control-Allow-Origin", value); }
  response
}

async fn fetch_inner(request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>> {
  let uri = Url::parse(&request.uri().to_string())?;
  let params: std::collections::HashMap<_, _> = uri.query_pairs().into_owned().collect();
  let (Some(base), Some(target)) = (params.get("base"), params.get("url")) else {
    return Ok(reply(403, "text/plain", vec![]));
  };
  let (Ok(base), Ok(mut target)) = (Url::parse(base), Url::parse(target)) else {
    return Ok(reply(403, "text/plain", vec![]));
  };
  let client = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .timeout(Duration::from_secs(30)).build()?;
  for _ in 0..=5 {
    if !allowed(&base, &target) { return Ok(reply(403, "text/plain", vec![])); }
    let mut response = client.get(target.clone()).send().await?;
    let status = response.status().as_u16();
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
      if let Some(location) = response.headers().get("location") {
        target = target.join(location.to_str()?)?;
        continue;
      }
    }
    let content_type = response.headers().get("content-type")
      .and_then(|value| value.to_str().ok()).unwrap_or("application/octet-stream").to_owned();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
      if body.len() + chunk.len() > 128 * 1024 * 1024 {
        return Ok(reply(413, "text/plain", vec![]));
      }
      body.extend_from_slice(&chunk);
    }
    return Ok(reply(status, &content_type, body));
  }
  Ok(reply(502, "text/plain", vec![]))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};

  #[test]
  fn native_get_reads_a_non_cors_server_on_a_custom_port() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
      let (mut socket, _) = listener.accept().unwrap();
      let mut request = [0; 4096];
      let size = socket.read(&mut request).unwrap();
      let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
      assert!(request.starts_with("get /meshes/arm.obj "));
      assert!(!request.contains("authorization:"));
      assert!(!request.contains("cookie:"));
      socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 4\r\nConnection: close\r\n\r\nmesh").unwrap();
    });
    let mut uri = Url::parse("robot-resource://localhost/resource").unwrap();
    uri.query_pairs_mut().append_pair("base", &base).append_pair("url", &format!("{base}/meshes/arm.obj"));
    let request = Request::builder().uri(uri.as_str())
      .header("origin", "tauri://localhost").header("cookie", "private=value")
      .header("authorization", "Bearer private").body(vec![]).unwrap();
    let response = tauri::async_runtime::block_on(fetch(request, Some("tauri://localhost")));
    assert_eq!(response.status(), 200);
    assert_eq!(response.body(), b"mesh");
    assert_eq!(response.headers()["access-control-allow-origin"], "tauri://localhost");
    server.join().unwrap();
  }

  #[test]
  fn untrusted_or_missing_origins_cannot_use_native_transport() {
    for origin in [None, Some("null"), Some("https://untrusted.example")] {
      let mut request = Request::builder().uri("robot-resource://localhost/resource");
      if let Some(origin) = origin { request = request.header("origin", origin); }
      let response = tauri::async_runtime::block_on(fetch(request.body(vec![]).unwrap(), Some("tauri://localhost")));
      assert_eq!(response.status(), 403);
    }
  }

  #[test]
  fn resource_scope_preserves_host_port_and_path() {
    for host in ["10.8.0.1", "localhost", "127.0.0.1", "[::1]", "robot.local"] {
      let base = Url::parse(&format!("http://{host}:18000/assets")).unwrap();
      assert!(allowed(&base, &base.join("/assets/visual/arm.obj?rev=2").unwrap()));
      assert!(!allowed(&base, &base.join("/other/arm.obj").unwrap()));
      let other_port = Url::parse(&format!("http://{host}:8000/assets/arm.obj")).unwrap();
      assert!(!allowed(&base, &other_port));
    }
    let base = Url::parse("https://robot.local:18443/").unwrap();
    for target in ["file:///etc/passwd", "https://other.local/a.obj", "https://user:pass@robot.local:18443/a.obj"] {
      assert!(!allowed(&base, &Url::parse(target).unwrap()));
    }
  }
}
