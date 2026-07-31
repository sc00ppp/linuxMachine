use std::{
    env,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{
        header::{
            ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_LENGTH,
            CONTENT_RANGE, CONTENT_TYPE, RANGE,
        },
        HeaderMap, HeaderValue, Method, StatusCode,
    },
    response::Response,
    routing::get,
    Router,
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, SeekFrom},
    net::TcpListener,
};
use tokio_util::io::ReaderStream;

const DEFAULT_ROOT: &str = r"S:\";
const DEFAULT_BIND: &str = "0.0.0.0:8099";
/// Artwork, video and Vite's content-hashed assets never change under a given
/// name, so they can be cached forever.
const CACHE_POLICY: &str = "public, max-age=31536000, immutable";

/// HTML is the exception. The shell's entry point keeps the same name across
/// every deploy, so caching it immutably would pin the console to whichever
/// build it happened to load first — a redeploy would appear to do nothing.
const REVALIDATE_POLICY: &str = "no-cache";

fn cache_policy(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("html" | "htm") => REVALIDATE_POLICY,
        _ => CACHE_POLICY,
    }
}

#[derive(Clone)]
struct AppState {
    root: Arc<PathBuf>,
}

struct Config {
    root: PathBuf,
    bind: SocketAddr,
}

impl Config {
    fn from_env_and_args() -> Result<Option<Self>, String> {
        let mut root =
            PathBuf::from(env::var_os("MEDIASERVE_ROOT").unwrap_or_else(|| DEFAULT_ROOT.into()));
        let mut bind = env::var("MEDIASERVE_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_owned());
        let mut args = env::args_os().skip(1);

        while let Some(argument) = args.next() {
            let argument_text = argument.to_string_lossy();
            match argument_text.as_ref() {
                "-h" | "--help" => {
                    println!(
                        "Usage: mediaserve [--root PATH] [--bind ADDRESS]\n\
                         Environment: MEDIASERVE_ROOT, MEDIASERVE_BIND\n\
                         Defaults: --root {DEFAULT_ROOT} --bind {DEFAULT_BIND}"
                    );
                    return Ok(None);
                }
                "--root" => {
                    root = PathBuf::from(
                        args.next()
                            .ok_or_else(|| "--root requires a path".to_owned())?,
                    );
                }
                "--bind" => {
                    bind = args
                        .next()
                        .ok_or_else(|| "--bind requires an address".to_owned())?
                        .to_string_lossy()
                        .into_owned();
                }
                _ if argument_text.starts_with("--root=") => {
                    root = PathBuf::from(&argument_text["--root=".len()..]);
                }
                _ if argument_text.starts_with("--bind=") => {
                    bind = argument_text["--bind=".len()..].to_owned();
                }
                _ => return Err(format!("unknown argument: {argument_text}")),
            }
        }

        let bind = bind
            .parse()
            .map_err(|error| format!("invalid bind address {bind:?}: {error}"))?;
        Ok(Some(Self { root, bind }))
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end: u64,
}

enum RequestedRange {
    Full,
    Partial(ByteRange),
    Unsatisfiable,
}

fn parse_range(headers: &HeaderMap, file_length: u64) -> RequestedRange {
    let Some(value) = headers.get(RANGE) else {
        return RequestedRange::Full;
    };
    let Ok(value) = value.to_str() else {
        return RequestedRange::Unsatisfiable;
    };
    let Some(specification) = value.strip_prefix("bytes=") else {
        return RequestedRange::Unsatisfiable;
    };
    if specification.contains(',') {
        return RequestedRange::Unsatisfiable;
    }
    let Some((start_text, end_text)) = specification.split_once('-') else {
        return RequestedRange::Unsatisfiable;
    };
    if file_length == 0 || (start_text.is_empty() && end_text.is_empty()) {
        return RequestedRange::Unsatisfiable;
    }

    if start_text.is_empty() {
        let Ok(suffix_length) = end_text.parse::<u64>() else {
            return RequestedRange::Unsatisfiable;
        };
        if suffix_length == 0 {
            return RequestedRange::Unsatisfiable;
        }
        let suffix_length = suffix_length.min(file_length);
        return RequestedRange::Partial(ByteRange {
            start: file_length - suffix_length,
            end: file_length - 1,
        });
    }

    let Ok(start) = start_text.parse::<u64>() else {
        return RequestedRange::Unsatisfiable;
    };
    if start >= file_length {
        return RequestedRange::Unsatisfiable;
    }
    let end = if end_text.is_empty() {
        file_length - 1
    } else {
        let Ok(end) = end_text.parse::<u64>() else {
            return RequestedRange::Unsatisfiable;
        };
        if end < start {
            return RequestedRange::Unsatisfiable;
        }
        end.min(file_length - 1)
    };

    RequestedRange::Partial(ByteRange { start, end })
}

fn plain_response(status: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
}

fn reject_range(file_length: u64) -> Response {
    let mut response = plain_response(StatusCode::RANGE_NOT_SATISFIABLE);
    response.headers_mut().insert(
        CONTENT_RANGE,
        HeaderValue::from_str(&format!("bytes */{file_length}"))
            .expect("a decimal file length is a valid header value"),
    );
    response
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        // This server also hosts the built shell itself. A browser will happily
        // download an index.html sent as octet-stream instead of rendering it,
        // and refuses modules that do not arrive as JavaScript, so the web
        // types are not optional here.
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ico") => "image/x-icon",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn safe_relative_path(requested: &str) -> Option<&Path> {
    let path = Path::new(requested);
    if requested.is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(path)
}

async fn root_request() -> Response {
    plain_response(StatusCode::NOT_FOUND)
}

async fn serve_file(
    State(state): State<AppState>,
    AxumPath(requested): AxumPath<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return plain_response(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some(relative_path) = safe_relative_path(&requested) else {
        return plain_response(StatusCode::FORBIDDEN);
    };

    let unresolved = state.root.join(relative_path);
    let Ok(canonical_path) = tokio::fs::canonicalize(unresolved).await else {
        return plain_response(StatusCode::NOT_FOUND);
    };
    if !canonical_path.starts_with(state.root.as_ref()) {
        return plain_response(StatusCode::FORBIDDEN);
    }

    let Ok(metadata) = tokio::fs::metadata(&canonical_path).await else {
        return plain_response(StatusCode::NOT_FOUND);
    };
    if !metadata.is_file() {
        return plain_response(StatusCode::NOT_FOUND);
    }
    let file_length = metadata.len();

    let (status, start, end) = match parse_range(&headers, file_length) {
        RequestedRange::Full => (
            StatusCode::OK,
            0,
            file_length.checked_sub(1).unwrap_or_default(),
        ),
        RequestedRange::Partial(range) => (StatusCode::PARTIAL_CONTENT, range.start, range.end),
        RequestedRange::Unsatisfiable => return reject_range(file_length),
    };
    let response_length = if file_length == 0 { 0 } else { end - start + 1 };

    let mut response = if method == Method::HEAD || response_length == 0 {
        Response::new(Body::empty())
    } else {
        let Ok(mut file) = File::open(&canonical_path).await else {
            return plain_response(StatusCode::NOT_FOUND);
        };
        if file.seek(SeekFrom::Start(start)).await.is_err() {
            return plain_response(StatusCode::INTERNAL_SERVER_ERROR);
        }
        let stream = ReaderStream::new(file.take(response_length));
        Response::new(Body::from_stream(stream))
    };

    *response.status_mut() = status;
    let response_headers = response.headers_mut();
    response_headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    // The shell is served from a different port than the media, so anything it
    // reads with fetch() — the Custom TV catalog, the downloader's status — is
    // a cross-origin request. Images and video never needed this (<img> and
    // <video> are exempt), which is why the omission stayed invisible until a
    // fetch was added and failed silently.
    //
    // `*` is right here: this is a read-only server for a LAN appliance, it
    // holds nothing private, and it accepts no credentials.
    response_headers.insert(
        ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response_headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(cache_policy(&canonical_path)),
    );
    response_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static(content_type(&canonical_path)),
    );
    response_headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&response_length.to_string())
            .expect("a decimal content length is a valid header value"),
    );
    if status == StatusCode::PARTIAL_CONTENT {
        response_headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{file_length}"))
                .expect("a byte range is a valid header value"),
        );
    }
    response
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let Some(config) = Config::from_env_and_args()
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?
    else {
        return Ok(());
    };
    let root = tokio::fs::canonicalize(&config.root)
        .await
        .map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!("cannot open media root {}: {error}", config.root.display()),
            )
        })?;
    if !tokio::fs::metadata(&root).await?.is_dir() {
        return Err(format!("media root is not a directory: {}", root.display()).into());
    }

    let listener = TcpListener::bind(config.bind).await?;
    eprintln!(
        "mediaserve: serving {} on http://{}",
        root.display(),
        listener.local_addr()?
    );
    let state = AppState {
        root: Arc::new(root),
    };
    let app = Router::new()
        .route("/", get(root_request).head(root_request))
        .route("/{*path}", get(serve_file).head(serve_file))
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn parses_standard_ranges() {
        assert!(matches!(
            parse_range(&headers("bytes=10-19"), 100),
            RequestedRange::Partial(ByteRange { start: 10, end: 19 })
        ));
        assert!(matches!(
            parse_range(&headers("bytes=90-"), 100),
            RequestedRange::Partial(ByteRange { start: 90, end: 99 })
        ));
        assert!(matches!(
            parse_range(&headers("bytes=-10"), 100),
            RequestedRange::Partial(ByteRange { start: 90, end: 99 })
        ));
    }

    #[test]
    fn rejects_invalid_and_multiple_ranges() {
        assert!(matches!(
            parse_range(&headers("bytes=100-101"), 100),
            RequestedRange::Unsatisfiable
        ));
        assert!(matches!(
            parse_range(&headers("bytes=0-1,4-5"), 100),
            RequestedRange::Unsatisfiable
        ));
    }

    #[test]
    fn accepts_only_normal_relative_paths() {
        assert!(safe_relative_path("RetroBat/roms/snes/images/game.png").is_some());
        assert!(safe_relative_path("../secret.txt").is_none());
        assert!(safe_relative_path("/Windows/system.ini").is_none());
        assert!(safe_relative_path(r"C:\Windows\system.ini").is_none());
    }
}
