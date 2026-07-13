mod http_server;

use http_server::{build_router, AppState};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

const PORT: u16 = 7860;
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() {
    // Generate a random session token on startup
    let session_token = Uuid::new_v4().to_string();

    // Check if yt-dlp is available: prefer the copy bundled with the installer
    // (engine/bin/yt-dlp[.exe] next to the daemon executable), fall back to PATH.
    let bundled_yt_dlp = http_server::bundled_bin_dir().map(|d| {
        #[cfg(target_os = "windows")]
        {
            d.join("yt-dlp.exe")
        }
        #[cfg(not(target_os = "windows"))]
        {
            d.join("yt-dlp")
        }
    });
    let yt_dlp_cmd = match bundled_yt_dlp {
        Some(ref p) if p.exists() => p.to_string_lossy().to_string(),
        _ => "yt-dlp".to_string(),
    };
    let yt_dlp_available = tokio::process::Command::new(&yt_dlp_cmd)
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let state = Arc::new(AppState {
        version: VERSION.to_string(),
        session_token: session_token.clone(),
        yt_dlp_available,
        jobs: Arc::new(RwLock::new(HashMap::new())),
    });

    let app = build_router(Arc::clone(&state));

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PORT));
    println!("AIScripter daemon starting on http://127.0.0.1:{PORT}");
    println!("Session token: {session_token}");
    println!("yt-dlp available: {yt_dlp_available}");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind port 7860");
    axum::serve(listener, app)
        .await
        .expect("Server error");
}
