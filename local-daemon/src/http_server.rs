use axum::{
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Queued,
    Processing,
    Complete,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub url: String,
    pub status: JobState,
    pub percent: u8,
    pub error: Option<String>,
    pub funscript: Option<String>,
    pub script_source: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub version: String,
    pub session_token: String,
    pub yt_dlp_available: bool,
    pub jobs: Arc<RwLock<HashMap<String, Job>>>,
}

// ── Request/response shapes ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct TriggerRequest {
    url: String,
}

#[derive(Serialize)]
struct StatusResponse {
    version: String,
    session_token: String,
    yt_dlp_available: bool,
}

#[derive(Serialize)]
struct TriggerResponse {
    job_id: String,
}

#[derive(Serialize)]
struct JobResponse {
    id: String,
    status: JobState,
    percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    script_source: Option<String>,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// ── Auth middleware helper ─────────────────────────────────────────────────────

fn check_token(headers: &HeaderMap, session_token: &str) -> bool {
    if let Some(val) = headers.get("x-aiscripter-token") {
        if let Ok(s) = val.to_str() {
            return s == session_token;
        }
    }
    false
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn handle_status(State(state): State<Arc<AppState>>) -> Json<StatusResponse> {
    Json(StatusResponse {
        version: state.version.clone(),
        session_token: state.session_token.clone(),
        yt_dlp_available: state.yt_dlp_available,
    })
}

async fn handle_trigger(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<TriggerRequest>,
) -> Response {
    if !check_token(&headers, &state.session_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse { error: "Invalid or missing X-AIScripter-Token".into() }),
        )
            .into_response();
    }

    if body.url.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "url is required".into() }),
        )
            .into_response();
    }

    let job_id = Uuid::new_v4().to_string();
    let job = Job {
        id: job_id.clone(),
        url: body.url.clone(),
        status: JobState::Queued,
        percent: 0,
        error: None,
        funscript: None,
        script_source: None,
    };

    {
        let mut jobs = state.jobs.write().await;
        jobs.insert(job_id.clone(), job);
    }

    // Spawn engine task
    let state_clone = Arc::clone(&state);
    let url = body.url.clone();
    let id = job_id.clone();
    tokio::spawn(async move {
        run_engine(state_clone, id, url).await;
    });

    (StatusCode::OK, Json(TriggerResponse { job_id })).into_response()
}

async fn handle_get_job(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !check_token(&headers, &state.session_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse { error: "Invalid or missing X-AIScripter-Token".into() }),
        )
            .into_response();
    }

    let jobs = state.jobs.read().await;
    match jobs.get(&job_id) {
        Some(job) => (
            StatusCode::OK,
            Json(JobResponse {
                id: job.id.clone(),
                status: job.status.clone(),
                percent: job.percent,
                error: job.error.clone(),
                script_source: job.script_source.clone(),
            }),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse { error: "Job not found".into() }),
        )
            .into_response(),
    }
}

async fn handle_get_funscript(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !check_token(&headers, &state.session_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse { error: "Invalid or missing X-AIScripter-Token".into() }),
        )
            .into_response();
    }

    let jobs = state.jobs.read().await;
    match jobs.get(&job_id) {
        Some(job) if job.status == JobState::Complete => {
            let script = job.funscript.clone().unwrap_or_else(|| {
                r#"{"version":"1.0","inverted":false,"range":90,"actions":[]}"#.to_string()
            });
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                script,
            )
                .into_response()
        }
        Some(_) => (
            StatusCode::CONFLICT,
            Json(ErrorResponse { error: "Job not complete yet".into() }),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse { error: "Job not found".into() }),
        )
            .into_response(),
    }
}

// ── Engine runner (calls the Python engine subprocess) ───────────────────────

async fn run_engine(state: Arc<AppState>, job_id: String, url: String) {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

    // Determine engine binary: prefer frozen PyInstaller bundle next to exe,
    // fall back to `python engine.py` in working directory.
    let engine_exe = {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));
        let frozen = exe_dir.as_ref().map(|d| {
            #[cfg(target_os = "windows")]
            { d.join("engine").join("engine.exe") }
            #[cfg(not(target_os = "windows"))]
            { d.join("engine").join("engine") }
        });
        frozen.filter(|p| p.exists())
    };

    // Mark as processing
    {
        let mut jobs = state.jobs.write().await;
        if let Some(job) = jobs.get_mut(&job_id) {
            job.status = JobState::Processing;
            job.percent = 5;
        }
    }

    let result: Result<String, String> = async {
        let (program, args) = if let Some(ref exe) = engine_exe {
            (
                exe.to_string_lossy().to_string(),
                vec!["--url".to_string(), url.clone()],
            )
        } else {
            (
                "python".to_string(),
                vec!["engine.py".to_string(), "--url".to_string(), url.clone()],
            )
        };

        let mut child = tokio::process::Command::new(&program)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch engine: {e}"))?;

        // Stream stderr: parse PROGRESS:nn lines to update job percent in real time.
        // WARNING: lines are logged prominently so the daemon operator can see fallbacks.
        let stderr = child.stderr.take().expect("stderr was piped");
        let state_p = Arc::clone(&state);
        let id_p = job_id.clone();
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(rest) = line.strip_prefix("PROGRESS:") {
                    if let Ok(pct) = rest.trim().parse::<u8>() {
                        let mut jobs = state_p.jobs.write().await;
                        if let Some(job) = jobs.get_mut(&id_p) {
                            if job.status == JobState::Processing {
                                job.percent = pct;
                            }
                        }
                    }
                } else if line.starts_with("WARNING:") {
                    eprintln!("[engine WARNING] {}", line);
                }
                eprintln!("[engine] {}", line);
            }
        });

        // Collect stdout (the funscript JSON written by the engine).
        let stdout = child.stdout.take().expect("stdout was piped");
        let mut stdout_buf = Vec::new();
        BufReader::new(stdout)
            .read_to_end(&mut stdout_buf)
            .await
            .map_err(|e| format!("Failed to read engine stdout: {e}"))?;

        let status = child
            .wait()
            .await
            .map_err(|e| format!("Engine process error: {e}"))?;

        // Wait for stderr drainer to finish before returning.
        let _ = stderr_task.await;

        if !status.success() {
            return Err(format!(
                "Engine exited with code {}",
                status.code().unwrap_or(-1)
            ));
        }

        let json_str = String::from_utf8_lossy(&stdout_buf).trim().to_string();
        Ok(json_str)
    }
    .await;

    let mut jobs = state.jobs.write().await;
    if let Some(job) = jobs.get_mut(&job_id) {
        match result {
            Ok(funscript) => {
                // Extract metadata.source from the funscript JSON so the UI can
                // show a warning badge when the audio-RMS fallback was used.
                let source: Option<String> = serde_json::from_str::<serde_json::Value>(&funscript)
                    .ok()
                    .and_then(|v| {
                        v.get("metadata")
                            .and_then(|m| m.get("source"))
                            .and_then(|s| s.as_str())
                            .map(|s| s.to_string())
                    });
                if source.as_deref() == Some("audio_rms") {
                    eprintln!(
                        "[daemon WARNING] Job {job_id}: script generated via audio_rms fallback \
                         (video download or optical-flow failed)"
                    );
                }
                job.status = JobState::Complete;
                job.percent = 100;
                job.funscript = Some(funscript);
                job.script_source = source;
            }
            Err(msg) => {
                job.status = JobState::Error;
                job.error = Some(msg);
            }
        }
    }
}

// ── Router builder ────────────────────────────────────────────────────────────

pub fn build_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            "https://hapticos.org".parse().unwrap(),
            "http://localhost:7860".parse().unwrap(),
            "http://127.0.0.1:7860".parse().unwrap(),
        ])
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);

    Router::new()
        .route("/status", get(handle_status))
        .route("/api/jobs/trigger", post(handle_trigger))
        .route("/api/jobs/:id", get(handle_get_job))
        .route("/api/jobs/:id/funscript", get(handle_get_funscript))
        .layer(cors)
        .with_state(state)
}
