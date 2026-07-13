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

    // Check if yt-dlp is available on PATH
    let yt_dlp_available = tokio::process::Command::new("yt-dlp")
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
