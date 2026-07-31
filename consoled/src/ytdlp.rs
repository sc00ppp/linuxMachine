//! Local yt-dlp-backed YouTube stream resolution and maintenance.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio::time::{interval, sleep, MissedTickBehavior};
use url::Url;

use crate::server::AppState;

const RESOLVE_TIMEOUT: Duration = Duration::from_secs(20);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const UPDATE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const CACHE_EXPIRY_MARGIN_SECS: u64 = 5 * 60;
const FORMAT_SELECTOR: &str =
    "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio";
const PRINT_TEMPLATE: &str = r#"{"video":{"url":%(requested_formats.0.url)j,"width":%(requested_formats.0.width)j,"height":%(requested_formats.0.height)j,"ext":%(requested_formats.0.ext)j,"codec":%(requested_formats.0.vcodec)j,"formatId":%(requested_formats.0.format_id)j},"audio":{"url":%(requested_formats.1.url)j,"ext":%(requested_formats.1.ext)j,"codec":%(requested_formats.1.acodec)j,"formatId":%(requested_formats.1.format_id)j}}"#;

#[derive(Clone)]
struct CacheEntry {
    response: ResolveResponse,
    valid_until: u64,
}

pub struct YtDlp {
    executable: String,
    cache: RwLock<HashMap<String, CacheEntry>>,
    updating: AtomicBool,
}

impl YtDlp {
    pub fn from_env() -> Self {
        Self {
            executable: std::env::var("YTDLP_PATH").unwrap_or_else(|_| "yt-dlp".to_owned()),
            cache: RwLock::new(HashMap::new()),
            updating: AtomicBool::new(false),
        }
    }

    pub fn start_auto_updates(self: Arc<Self>) {
        tokio::spawn(async move {
            self.update().await;
            let mut timer = interval(UPDATE_INTERVAL);
            timer.set_missed_tick_behavior(MissedTickBehavior::Delay);
            // interval's first tick is immediate; the startup attempt above already covered it.
            timer.tick().await;
            loop {
                timer.tick().await;
                self.update().await;
            }
        });
    }

    async fn update(&self) {
        if self
            .updating
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            while self.updating.load(Ordering::Acquire) {
                sleep(Duration::from_millis(100)).await;
            }
            return;
        }

        let result = self.run_update().await;
        self.updating.store(false, Ordering::Release);

        match result {
            Ok(message) => {
                tracing::info!(yt_dlp = %self.executable, %message, "yt-dlp update check complete")
            }
            Err(error) => {
                tracing::warn!(yt_dlp = %self.executable, %error, "yt-dlp background update failed")
            }
        }
    }

    async fn run_update(&self) -> Result<String, ProcessError> {
        let self_update = run_process(&self.executable, &["-U"], UPDATE_TIMEOUT).await?;
        if self_update.success {
            return Ok(format!(
                "standalone updater completed: {}",
                last_output_line(&self_update).unwrap_or("no output")
            ));
        }

        let combined = self_update.combined_output().to_ascii_lowercase();
        if !combined.contains("installed yt-dlp with pip") && !combined.contains("wheel from pypi")
        {
            return Err(ProcessError::Failed(
                last_output_line(&self_update)
                    .unwrap_or("yt-dlp -U failed")
                    .to_owned(),
            ));
        }

        let python = python_for(&self.executable);
        let pip_update = run_process(
            &python,
            &["-m", "pip", "install", "-U", "yt-dlp"],
            UPDATE_TIMEOUT,
        )
        .await?;
        if pip_update.success {
            Ok(format!(
                "pip-managed updater completed via {python}: {}",
                last_output_line(&pip_update).unwrap_or("no output")
            ))
        } else {
            Err(ProcessError::Failed(
                last_output_line(&pip_update)
                    .unwrap_or("pip install -U yt-dlp failed")
                    .to_owned(),
            ))
        }
    }

    async fn cached(&self, video_id: &str) -> Option<ResolveResponse> {
        let now = unix_now();
        let entry = self.cache.read().await.get(video_id).cloned();
        match entry {
            Some(entry) if entry.valid_until > now => Some(entry.response),
            Some(_) => {
                self.cache.write().await.remove(video_id);
                None
            }
            None => None,
        }
    }

    async fn resolve(self: &Arc<Self>, video_id: &str) -> Result<ResolveResponse, ResolveError> {
        if let Some(response) = self.cached(video_id).await {
            return Ok(response);
        }

        let response = match self.resolve_uncached(video_id).await {
            Err(error) if error.looks_like_extractor_breakage() => {
                tracing::warn!(%video_id, "yt-dlp extraction failed; scheduling update and one background retry");
                self.trigger_repair(video_id.to_owned());
                return Err(error);
            }
            other => other?,
        };

        self.cache_response(video_id, response.clone()).await;
        Ok(response)
    }

    fn trigger_repair(self: &Arc<Self>, video_id: String) {
        let service = Arc::clone(self);
        tokio::spawn(async move {
            service.update().await;
            match service.resolve_uncached(&video_id).await {
                Ok(response) => {
                    service.cache_response(&video_id, response).await;
                    tracing::info!(%video_id, "yt-dlp background repair succeeded");
                }
                Err(error) => {
                    tracing::warn!(%video_id, %error, "yt-dlp background retry failed");
                }
            }
        });
    }

    async fn cache_response(&self, video_id: &str, response: ResolveResponse) {
        let valid_until = response.expires_at.saturating_sub(CACHE_EXPIRY_MARGIN_SECS);
        self.cache.write().await.insert(
            video_id.to_owned(),
            CacheEntry {
                response: response.clone(),
                valid_until,
            },
        );
    }

    async fn resolve_uncached(&self, video_id: &str) -> Result<ResolveResponse, ResolveError> {
        let watch_url = format!("https://www.youtube.com/watch?v={video_id}");
        let output = run_process(
            &self.executable,
            &[
                "--no-playlist",
                "--no-warnings",
                "--skip-download",
                "-f",
                FORMAT_SELECTOR,
                "--print",
                PRINT_TEMPLATE,
                "--",
                &watch_url,
            ],
            RESOLVE_TIMEOUT,
        )
        .await
        .map_err(ResolveError::Process)?;

        if !output.success {
            return Err(ResolveError::ExtractionFailed(output.combined_output()));
        }

        parse_resolver_output(video_id, &output.stdout)
    }
}

#[derive(Deserialize)]
pub struct ResolveQuery {
    v: Option<String>,
}

pub async fn resolve(
    State(state): State<AppState>,
    query: Result<Query<ResolveQuery>, axum::extract::rejection::QueryRejection>,
) -> Response {
    let video_id = match query {
        Ok(Query(query)) => query.v.unwrap_or_default(),
        Err(_) => return ResolveError::InvalidVideoId.into_response(),
    };
    if !valid_video_id(&video_id) {
        return ResolveError::InvalidVideoId.into_response();
    }

    match state.ytdlp.resolve(&video_id).await {
        Ok(response) => Json(response).into_response(),
        Err(error) => {
            tracing::warn!(%video_id, %error, "YouTube stream resolution failed");
            error.into_response()
        }
    }
}

fn valid_video_id(value: &str) -> bool {
    static VIDEO_ID: OnceLock<Regex> = OnceLock::new();
    VIDEO_ID
        .get_or_init(|| Regex::new(r"^[A-Za-z0-9_-]{6,20}$").expect("valid video id regex"))
        .is_match(value)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResponse {
    video_id: String,
    expires_at: u64,
    video: VideoStream,
    audio: AudioStream,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoStream {
    url: String,
    mime_type: String,
    width: u32,
    height: u32,
    codec: String,
    format_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioStream {
    url: String,
    mime_type: String,
    codec: String,
    format_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintedStreams {
    video: PrintedVideo,
    audio: PrintedAudio,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintedVideo {
    url: String,
    width: Option<u32>,
    height: Option<u32>,
    ext: String,
    codec: String,
    format_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintedAudio {
    url: String,
    ext: String,
    codec: String,
    format_id: String,
}

fn parse_resolver_output(video_id: &str, bytes: &[u8]) -> Result<ResolveResponse, ResolveError> {
    let printed: PrintedStreams =
        serde_json::from_slice(bytes).map_err(|_| ResolveError::InvalidOutput)?;
    let width = printed.video.width.ok_or(ResolveError::InvalidOutput)?;
    let height = printed.video.height.ok_or(ResolveError::InvalidOutput)?;
    if width == 0 || height == 0 || height > 1_080 {
        return Err(ResolveError::InvalidOutput);
    }

    let video_expiry = stream_expiry(&printed.video.url)?;
    let audio_expiry = stream_expiry(&printed.audio.url)?;
    let expires_at = video_expiry.min(audio_expiry);
    if expires_at <= unix_now().saturating_add(CACHE_EXPIRY_MARGIN_SECS) {
        return Err(ResolveError::InvalidOutput);
    }

    Ok(ResolveResponse {
        video_id: video_id.to_owned(),
        expires_at,
        video: VideoStream {
            url: printed.video.url,
            mime_type: mime_type("video", &printed.video.ext),
            width,
            height,
            codec: printed.video.codec,
            format_id: printed.video.format_id,
        },
        audio: AudioStream {
            url: printed.audio.url,
            mime_type: mime_type("audio", &printed.audio.ext),
            codec: printed.audio.codec,
            format_id: printed.audio.format_id,
        },
    })
}

fn stream_expiry(value: &str) -> Result<u64, ResolveError> {
    let url = Url::parse(value).map_err(|_| ResolveError::InvalidOutput)?;
    if url.scheme() != "https"
        || !url
            .host_str()
            .is_some_and(|host| host.ends_with(".googlevideo.com"))
    {
        return Err(ResolveError::InvalidOutput);
    }
    url.query_pairs()
        .find(|(key, _)| key == "expire")
        .and_then(|(_, value)| value.parse().ok())
        .ok_or(ResolveError::InvalidOutput)
}

fn mime_type(kind: &str, extension: &str) -> String {
    let subtype = match extension {
        "m4a" => "mp4",
        other => other,
    };
    format!("{kind}/{subtype}")
}

#[derive(Debug)]
enum ResolveError {
    InvalidVideoId,
    Process(ProcessError),
    ExtractionFailed(String),
    InvalidOutput,
}

impl ResolveError {
    fn looks_like_extractor_breakage(&self) -> bool {
        let ResolveError::ExtractionFailed(details) = self else {
            return false;
        };
        let details = details.to_ascii_lowercase();
        [
            "unable to extract",
            "failed to extract",
            "signature extraction",
            "nsig extraction",
            "no video formats found",
            "confirm you are on the latest version",
        ]
        .iter()
        .any(|needle| details.contains(needle))
    }

    fn response_fields(&self) -> (StatusCode, &'static str, &'static str, bool) {
        match self {
            Self::InvalidVideoId => (
                StatusCode::BAD_REQUEST,
                "invalid_video_id",
                "v must be a 6-20 character YouTube video id",
                false,
            ),
            Self::Process(ProcessError::Spawn(_)) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "resolver_unavailable",
                "yt-dlp is not available on this console",
                true,
            ),
            Self::Process(ProcessError::TimedOut) => (
                StatusCode::GATEWAY_TIMEOUT,
                "resolver_timeout",
                "yt-dlp did not finish within 20 seconds",
                true,
            ),
            Self::Process(ProcessError::Failed(_)) | Self::ExtractionFailed(_) => (
                StatusCode::BAD_GATEWAY,
                "extraction_failed",
                "yt-dlp could not resolve playable streams for this video",
                true,
            ),
            Self::InvalidOutput => (
                StatusCode::BAD_GATEWAY,
                "invalid_resolver_output",
                "yt-dlp returned an unusable stream response",
                true,
            ),
        }
    }
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (_, code, _, _) = self.response_fields();
        formatter.write_str(code)
    }
}

#[derive(Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

impl IntoResponse for ResolveError {
    fn into_response(self) -> Response {
        let (status, code, message, retryable) = self.response_fields();
        (
            status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    code,
                    message,
                    retryable,
                },
            }),
        )
            .into_response()
    }
}

struct ProcessOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl ProcessOutput {
    fn combined_output(&self) -> String {
        format!(
            "{}\n{}",
            String::from_utf8_lossy(&self.stdout),
            String::from_utf8_lossy(&self.stderr)
        )
    }
}

#[derive(Debug)]
enum ProcessError {
    Spawn(String),
    TimedOut,
    Failed(String),
}

impl std::fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(error) => write!(formatter, "could not start process: {error}"),
            Self::TimedOut => formatter.write_str("process timed out"),
            Self::Failed(error) => formatter.write_str(error),
        }
    }
}

async fn run_process(
    executable: &str,
    args: &[&str],
    deadline: Duration,
) -> Result<ProcessOutput, ProcessError> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| ProcessError::Spawn(error.to_string()))?;

    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes).await;
        bytes
    });
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes).await;
        bytes
    });

    let status = match tokio::time::timeout(deadline, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => return Err(ProcessError::Failed(error.to_string())),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(ProcessError::TimedOut);
        }
    };

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    Ok(ProcessOutput {
        success: status.success(),
        stdout,
        stderr,
    })
}

fn python_for(executable: &str) -> String {
    if let Ok(configured) = std::env::var("YTDLP_PYTHON") {
        return configured;
    }

    let path = Path::new(executable);
    if path.components().count() > 1 {
        if cfg!(windows) {
            if let Some(scripts) = path.parent() {
                if scripts
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("scripts"))
                {
                    if let Some(root) = scripts.parent() {
                        let candidate = root.join("python.exe");
                        if candidate.exists() {
                            return candidate.to_string_lossy().into_owned();
                        }
                    }
                }
                let candidate = scripts.join("python.exe");
                if candidate.exists() {
                    return candidate.to_string_lossy().into_owned();
                }
            }
        } else if let Some(bin) = path.parent() {
            let candidate: PathBuf = bin.join("python3");
            if candidate.exists() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }

    if cfg!(windows) {
        "python".to_owned()
    } else {
        "python3".to_owned()
    }
}

fn last_output_line(output: &ProcessOutput) -> Option<&str> {
    let stderr = std::str::from_utf8(&output.stderr).ok();
    let stdout = std::str::from_utf8(&output.stdout).ok();
    stderr
        .and_then(|text| text.lines().rev().find(|line| !line.trim().is_empty()))
        .or_else(|| stdout.and_then(|text| text.lines().rev().find(|line| !line.trim().is_empty())))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn future_expiry() -> u64 {
        unix_now() + 21_600
    }

    #[test]
    fn video_ids_are_strictly_validated() {
        assert!(valid_video_id("jNQXAC9IVRw"));
        assert!(valid_video_id("abc_12-Z"));
        assert!(!valid_video_id("short"));
        assert!(!valid_video_id("jNQXAC9IVRw&x=1"));
        assert!(!valid_video_id("contains space"));
        assert!(!valid_video_id("abcdefghijklmnopqrstu"));
    }

    #[test]
    fn parses_dual_streams_and_uses_the_earliest_expiry() {
        let video_expiry = future_expiry();
        let audio_expiry = video_expiry - 60;
        let printed = format!(
            r#"{{"video":{{"url":"https://v1.googlevideo.com/videoplayback?expire={video_expiry}","width":1920,"height":1080,"ext":"mp4","codec":"avc1.640028","formatId":"137"}},"audio":{{"url":"https://v1.googlevideo.com/videoplayback?expire={audio_expiry}","ext":"m4a","codec":"mp4a.40.2","formatId":"140"}}}}"#
        );
        let response = parse_resolver_output("jNQXAC9IVRw", printed.as_bytes()).unwrap();
        assert_eq!(response.video.width, 1920);
        assert_eq!(response.video.height, 1080);
        assert_eq!(response.video.mime_type, "video/mp4");
        assert_eq!(response.audio.mime_type, "audio/mp4");
        assert_eq!(response.expires_at, audio_expiry);
    }

    #[test]
    fn rejects_non_google_media_urls_and_over_1080_video() {
        let expiry = future_expiry();
        let wrong_host = format!(
            r#"{{"video":{{"url":"https://example.com/v?expire={expiry}","width":1920,"height":1080,"ext":"mp4","codec":"avc1","formatId":"137"}},"audio":{{"url":"https://v1.googlevideo.com/a?expire={expiry}","ext":"m4a","codec":"mp4a","formatId":"140"}}}}"#
        );
        assert!(parse_resolver_output("jNQXAC9IVRw", wrong_host.as_bytes()).is_err());

        let too_tall = format!(
            r#"{{"video":{{"url":"https://v1.googlevideo.com/v?expire={expiry}","width":3840,"height":2160,"ext":"mp4","codec":"avc1","formatId":"313"}},"audio":{{"url":"https://v1.googlevideo.com/a?expire={expiry}","ext":"m4a","codec":"mp4a","formatId":"140"}}}}"#
        );
        assert!(parse_resolver_output("jNQXAC9IVRw", too_tall.as_bytes()).is_err());
    }

    #[test]
    fn extractor_breakage_detection_is_narrow() {
        assert!(ResolveError::ExtractionFailed(
            "ERROR: Unable to extract player response".to_owned()
        )
        .looks_like_extractor_breakage());
        assert!(!ResolveError::ExtractionFailed("Private video".to_owned())
            .looks_like_extractor_breakage());
    }

    #[tokio::test]
    async fn expired_cache_entries_are_removed() {
        let service = YtDlp::from_env();
        let expiry = future_expiry();
        let response = ResolveResponse {
            video_id: "jNQXAC9IVRw".to_owned(),
            expires_at: expiry,
            video: VideoStream {
                url: format!("https://v1.googlevideo.com/v?expire={expiry}"),
                mime_type: "video/mp4".to_owned(),
                width: 1920,
                height: 1080,
                codec: "avc1".to_owned(),
                format_id: "137".to_owned(),
            },
            audio: AudioStream {
                url: format!("https://v1.googlevideo.com/a?expire={expiry}"),
                mime_type: "audio/mp4".to_owned(),
                codec: "mp4a".to_owned(),
                format_id: "140".to_owned(),
            },
        };
        service.cache.write().await.insert(
            response.video_id.clone(),
            CacheEntry {
                response,
                valid_until: unix_now().saturating_sub(1),
            },
        );

        assert!(service.cached("jNQXAC9IVRw").await.is_none());
        assert!(!service.cache.read().await.contains_key("jNQXAC9IVRw"));
    }

    #[tokio::test]
    async fn timed_out_process_is_killed_promptly() {
        #[cfg(windows)]
        let (executable, args) = (
            "powershell",
            vec!["-NoProfile", "-Command", "Start-Sleep -Seconds 10"],
        );
        #[cfg(not(windows))]
        let (executable, args) = ("sleep", vec!["10"]);

        let started = tokio::time::Instant::now();
        let result = run_process(executable, &args, Duration::from_millis(50)).await;
        assert!(matches!(result, Err(ProcessError::TimedOut)));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
