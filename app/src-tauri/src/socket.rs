use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::windows::label_number;

const VERSION: u64 = 1;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const READ_DEADLINE: Duration = Duration::from_secs(2);
const MAX_PATH_BYTES: usize = 100;
const MAX_BY_CHARS: usize = 32;
pub const DRIVE_WAIT: Duration = Duration::from_secs(3);
const SOCKET_NAME: &str = "app.sock";
pub const SOCKET_ENV: &str = "RECOGNIZER_APP_SOCKET";

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub label: String,
    pub folder: PathBuf,
    pub state: Option<Value>,
}

pub trait Source: Send + Sync {
    fn entries(&self) -> Vec<Entry>;
    fn drive(&self, label: &str, request: Value) -> Result<Value, String>;
}

type DriveAnswer = Result<Value, String>;

#[derive(Default)]
pub struct Drives {
    next: AtomicU64,
    pending: Mutex<HashMap<u64, (String, Sender<DriveAnswer>)>>,
}

impl Drives {
    pub fn register(&self, label: &str) -> (u64, Receiver<DriveAnswer>) {
        let request = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = channel();

        self.pending
            .lock()
            .unwrap()
            .insert(request, (label.to_string(), sender));

        (request, receiver)
    }

    pub fn answer(&self, request: u64, answer: &Value) -> Result<(), String> {
        let (_, sender) = self
            .pending
            .lock()
            .unwrap()
            .remove(&request)
            .ok_or_else(|| format!("no drive request {request} is waiting"))?;
        let outcome = match answer.get("status").and_then(Value::as_str) {
            Some("done") => Ok(answer.get("result").cloned().unwrap_or(Value::Null)),
            Some("refused") => Err(answer
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("the window refused")
                .to_string()),
            _ => Err("the window sent an answer that is neither done nor refused".to_string()),
        };

        let _ = sender.send(outcome);

        Ok(())
    }

    pub fn closed(&self, label: &str) {
        let mut pending = self.pending.lock().unwrap();
        let gone: Vec<u64> = pending
            .iter()
            .filter(|(_, (owner, _))| owner == label)
            .map(|(request, _)| *request)
            .collect();

        for request in gone {
            if let Some((_, sender)) = pending.remove(&request) {
                let _ = sender.send(Err(format!("{label} closed")));
            }
        }
    }

    pub fn wait(
        &self,
        label: &str,
        request: u64,
        receiver: &Receiver<DriveAnswer>,
        timeout: Duration,
    ) -> DriveAnswer {
        match receiver.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(_) => {
                self.pending.lock().unwrap().remove(&request);

                Err(format!(
                    "{label} did not answer within {} seconds",
                    timeout.as_secs()
                ))
            }
        }
    }
}

#[derive(Default)]
pub struct Snapshots(Mutex<HashMap<String, Value>>);

impl Snapshots {
    pub fn publish(&self, label: &str, state: Value) -> Result<(), String> {
        if !state.is_object() {
            return Err("the window state must be a JSON object".to_string());
        }

        self.0.lock().unwrap().insert(label.to_string(), state);

        Ok(())
    }

    pub fn closed(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }

    pub fn get(&self, label: &str) -> Option<Value> {
        self.0.lock().unwrap().get(label).cloned()
    }
}

pub fn socket_path(config_dir: &Path, override_path: Option<&str>) -> Result<PathBuf, String> {
    let path = match override_path {
        Some(text) if !text.is_empty() => PathBuf::from(text),
        _ => config_dir.join(SOCKET_NAME),
    };

    if path.as_os_str().len() > MAX_PATH_BYTES {
        return Err(format!(
            "the socket path {} is longer than {MAX_PATH_BYTES} bytes",
            path.display()
        ));
    }

    Ok(path)
}

fn refused(reason: &str) -> String {
    format!(
        "{}\n",
        json!({ "v": VERSION, "status": "refused", "reason": reason })
    )
}

fn done(result: Value) -> String {
    format!(
        "{}\n",
        json!({ "v": VERSION, "status": "done", "result": result })
    )
}

fn sorted(entries: &[Entry]) -> Vec<&Entry> {
    let mut listed: Vec<&Entry> = entries.iter().collect();

    listed.sort_by_key(|entry| label_number(&entry.label));

    listed
}

fn field(state: &Option<Value>, name: &str) -> Value {
    state
        .as_ref()
        .and_then(|state| state.get(name))
        .cloned()
        .unwrap_or(Value::Null)
}

fn listing(entry: &Entry) -> Value {
    json!({
        "id": entry.label,
        "folder": entry.folder.to_string_lossy(),
        "view": field(&entry.state, "view"),
        "selection": field(&entry.state, "selection"),
    })
}

fn labels(listed: &[&Entry]) -> String {
    listed
        .iter()
        .map(|entry| entry.label.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn by_id<'a>(listed: &[&'a Entry], id: &str) -> Result<&'a Entry, String> {
    match listed.iter().find(|entry| entry.label == id) {
        Some(entry) => Ok(*entry),
        None if listed.is_empty() => Err(format!("no window {id}; no window is open")),
        None => Err(format!("no window {id}; open windows: {}", labels(listed))),
    }
}

fn window_answer(listed: &[&Entry], id: Option<&Value>) -> String {
    let entry = match id {
        Some(Value::String(id)) => match by_id(listed, id) {
            Ok(entry) => entry,
            Err(reason) => return refused(&reason),
        },
        Some(_) => return refused("id must be a string"),
        None => match listed {
            [] => return refused("no window is open"),
            [only] => *only,
            many => {
                return refused(&format!(
                    "{} windows are open ({}); pass an id",
                    many.len(),
                    labels(many)
                ))
            }
        },
    };

    let Some(Value::Object(state)) = &entry.state else {
        return refused(&format!("{} has not finished opening", entry.label));
    };

    let mut result = Map::new();

    result.insert("id".to_string(), json!(entry.label));
    result.insert("folder".to_string(), json!(entry.folder.to_string_lossy()));

    for (key, value) in state {
        if key != "id" && key != "folder" {
            result.insert(key.clone(), value.clone());
        }
    }

    done(Value::Object(result))
}

fn valid_by(by: &str) -> bool {
    let length = by.chars().count();

    (1..=MAX_BY_CHARS).contains(&length)
        && by
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-' || c == '_')
}

fn drive_request(
    request: &Map<String, Value>,
    listed: &[&Entry],
) -> Result<(String, Value), String> {
    let id = match request.get("id") {
        Some(Value::String(id)) => id,
        Some(_) => return Err("id must be a string".to_string()),
        None => return Err("drive needs an \"id\" string".to_string()),
    };
    let entry = by_id(listed, id)?;

    if !matches!(entry.state, Some(Value::Object(_))) {
        return Err(format!("{} has not finished opening", entry.label));
    }

    let action = request
        .get("action")
        .and_then(Value::as_str)
        .ok_or("drive needs an \"action\" string")?;
    let args = request
        .get("args")
        .and_then(Value::as_array)
        .filter(|args| args.iter().all(Value::is_string))
        .ok_or("args must be an array of strings")?;
    let options = match request.get("options") {
        None => Map::new(),
        Some(Value::Object(options)) => options.clone(),
        Some(_) => return Err("options must be an object".to_string()),
    };

    if let Some(unknown) = options.keys().find(|key| key.as_str() != "off") {
        return Err(format!("unknown option {unknown:?}"));
    }

    if options.get("off").is_some_and(|off| !off.is_boolean()) {
        return Err("option off must be a boolean".to_string());
    }

    let by = request
        .get("by")
        .and_then(Value::as_str)
        .ok_or("drive needs a \"by\" string")?;

    if !valid_by(by) {
        return Err(format!(
            "by must be 1-{MAX_BY_CHARS} characters of letters, digits, space, - and _"
        ));
    }

    Ok((
        entry.label.clone(),
        json!({ "action": action, "args": args, "options": options, "by": by }),
    ))
}

pub fn respond(line: &str, source: &dyn Source) -> String {
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(_) => return refused("the request is not valid JSON"),
    };

    let Value::Object(request) = request else {
        return refused("the request must be a JSON object");
    };

    if request.get("v").and_then(Value::as_u64) != Some(VERSION) {
        return refused(&format!("the request needs \"v\": {VERSION}"));
    }

    let entries = source.entries();
    let listed = sorted(&entries);

    match request.get("command").and_then(Value::as_str) {
        Some("windows") => done(Value::Array(
            listed.iter().map(|entry| listing(entry)).collect(),
        )),
        Some("window") => window_answer(&listed, request.get("id")),
        Some("drive") => match drive_request(&request, &listed) {
            Ok((label, body)) => match source.drive(&label, body) {
                Ok(result) => done(result),
                Err(reason) => refused(&reason),
            },
            Err(reason) => refused(&reason),
        },
        Some(other) => refused(&format!("unknown command {other:?}; use windows or window")),
        None => refused("the request needs a \"command\" string"),
    }
}

enum Line {
    Text(String),
    Refusal(String),
}

fn read_line(stream: &mut UnixStream) -> Line {
    let deadline = Instant::now() + READ_DEADLINE;
    let mut collected: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        let newline = collected.iter().position(|byte| *byte == b'\n');

        if newline.unwrap_or(collected.len()) > MAX_REQUEST_BYTES {
            return Line::Refusal(format!(
                "the request is longer than {} KiB",
                MAX_REQUEST_BYTES / 1024
            ));
        }

        if let Some(position) = newline {
            collected.truncate(position);

            return match String::from_utf8(collected) {
                Ok(text) => Line::Text(text),
                Err(_) => Line::Refusal("the request is not valid UTF-8".to_string()),
            };
        }

        let remaining = deadline.saturating_duration_since(Instant::now());

        if remaining.is_zero() || stream.set_read_timeout(Some(remaining)).is_err() {
            return Line::Refusal("no newline within 2 seconds".to_string());
        }

        match stream.read(&mut chunk) {
            Ok(0) => return Line::Refusal("the request ended without a newline".to_string()),
            Ok(count) => collected.extend_from_slice(&chunk[..count]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                return Line::Refusal("no newline within 2 seconds".to_string())
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => {}
            Err(_) => return Line::Refusal("the request could not be read".to_string()),
        }
    }
}

fn serve_connection(mut stream: UnixStream, source: &dyn Source) {
    let reply = match read_line(&mut stream) {
        Line::Text(text) => respond(&text, source),
        Line::Refusal(reason) => refused(&reason),
    };

    let _ = stream.set_write_timeout(Some(READ_DEADLINE));
    let _ = stream.write_all(reply.as_bytes());
    let _ = stream.flush();
}

pub struct Server {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

fn prepare_directory(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };

    if parent.as_os_str().is_empty() || parent.exists() {
        return Ok(());
    }

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
        .map_err(|error| format!("{}: {error}", parent.display()))
}

fn clear_stale(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if UnixStream::connect(path).is_ok() {
        return Err(format!("{} is already being served", path.display()));
    }

    std::fs::remove_file(path).map_err(|error| format!("{}: {error}", path.display()))
}

impl Server {
    pub fn start(path: &Path, source: Arc<dyn Source>) -> Result<Server, String> {
        if path.as_os_str().len() > MAX_PATH_BYTES {
            return Err(format!(
                "the socket path {} is longer than {MAX_PATH_BYTES} bytes",
                path.display()
            ));
        }

        prepare_directory(path)?;
        clear_stale(path)?;

        let listener =
            UnixListener::bind(path).map_err(|error| format!("{}: {error}", path.display()))?;

        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("{}: {error}", path.display()))?;

        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if flag.load(Ordering::SeqCst) {
                    break;
                }

                if let Ok(stream) = stream {
                    serve_connection(stream, source.as_ref());
                }
            }
        });

        Ok(Server {
            path: path.to_path_buf(),
            stop,
            thread: Some(thread),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);

        let _ = UnixStream::connect(&self.path);

        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }

        let _ = std::fs::remove_file(&self.path);
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if self.thread.is_some() {
            self.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use tempfile::tempdir;

    const FIXTURE: &str = include_str!("../../../fixtures/window-socket/cases.json");

    struct Fixed {
        entries: Vec<Entry>,
        driven: Mutex<Option<Result<Value, String>>>,
        calls: Mutex<Vec<(String, Value)>>,
    }

    impl Fixed {
        fn new(entries: Vec<Entry>) -> Fixed {
            Fixed {
                entries,
                driven: Mutex::new(None),
                calls: Mutex::new(vec![]),
            }
        }

        fn answering(entries: Vec<Entry>, driven: Result<Value, String>) -> Fixed {
            let fixed = Fixed::new(entries);

            *fixed.driven.lock().unwrap() = Some(driven);

            fixed
        }
    }

    impl Source for Fixed {
        fn entries(&self) -> Vec<Entry> {
            self.entries.clone()
        }

        fn drive(&self, label: &str, request: Value) -> Result<Value, String> {
            self.calls
                .lock()
                .unwrap()
                .push((label.to_string(), request));

            self.driven
                .lock()
                .unwrap()
                .clone()
                .unwrap_or_else(|| Err("no drive configured".to_string()))
        }
    }

    fn driven_of(case: &Value) -> Option<Result<Value, String>> {
        let driven = case.get("driven")?;

        Some(match driven.get("refused").and_then(Value::as_str) {
            Some(reason) => Err(reason.to_string()),
            None => Ok(driven["result"].clone()),
        })
    }

    fn entries_of(open: &Value) -> Vec<Entry> {
        open.as_array()
            .unwrap()
            .iter()
            .map(|window| Entry {
                label: window["id"].as_str().unwrap().to_string(),
                folder: PathBuf::from(window["folder"].as_str().unwrap()),
                state: match &window["state"] {
                    Value::Null => None,
                    state => Some(state.clone()),
                },
            })
            .collect()
    }

    fn entry(label: &str, state: Option<Value>) -> Entry {
        Entry {
            label: label.to_string(),
            folder: PathBuf::from(format!("/r/{label}")),
            state,
        }
    }

    fn started(entries: Vec<Entry>) -> (tempfile::TempDir, Server) {
        let dir = tempdir().unwrap();
        let server =
            Server::start(&dir.path().join("app.sock"), Arc::new(Fixed::new(entries))).unwrap();

        (dir, server)
    }

    fn exchange(path: &Path, bytes: &[u8]) -> Value {
        let mut stream = UnixStream::connect(path).unwrap();

        stream.write_all(bytes).unwrap();

        let mut reply = String::new();

        std::io::BufReader::new(stream)
            .read_line(&mut reply)
            .unwrap();

        assert!(reply.ends_with('\n'));

        serde_json::from_str(&reply).unwrap()
    }

    fn reason(reply: &Value) -> String {
        assert_eq!(reply["v"], 1);
        assert_eq!(reply["status"], "refused");

        reply["reason"].as_str().unwrap().to_string()
    }

    #[test]
    fn every_fixture_pair_is_answered_as_documented_over_a_real_socket() {
        let cases: Value = serde_json::from_str(FIXTURE).unwrap();

        for case in cases.as_array().unwrap() {
            let dir = tempdir().unwrap();
            let entries = entries_of(&case["open"]);
            let source = match driven_of(case) {
                Some(driven) => Fixed::answering(entries, driven),
                None => Fixed::new(entries),
            };
            let server = Server::start(&dir.path().join("app.sock"), Arc::new(source)).unwrap();
            let request = format!("{}\n", case["request"].as_str().unwrap());
            let reply = exchange(server.path(), request.as_bytes());

            assert_eq!(reply, case["response"], "{}", case["name"]);
        }
    }

    fn drive_line(extra: &str) -> String {
        format!(
            "{{\"v\":1,\"command\":\"drive\",\"id\":\"w-1\",\"action\":\"add\",\"args\":[\"app/a.py\"],\"options\":{{}},\"by\":\"Claude\"{extra}}}"
        )
    }

    #[test]
    fn a_drive_request_reaches_the_source_with_the_label_and_its_fields() {
        let source = Fixed::answering(
            vec![entry("w-1", Some(json!({})))],
            Ok(json!({ "summary": "added 1 module", "changed": true })),
        );
        let reply: Value = serde_json::from_str(&respond(&drive_line(""), &source)).unwrap();

        assert_eq!(reply["status"], "done");
        assert_eq!(reply["result"]["summary"], "added 1 module");
        assert_eq!(
            *source.calls.lock().unwrap(),
            vec![(
                "w-1".to_string(),
                json!({ "action": "add", "args": ["app/a.py"], "options": {}, "by": "Claude" })
            )]
        );
    }

    #[test]
    fn a_drive_the_window_refuses_is_refused_with_its_reason() {
        let source = Fixed::answering(
            vec![entry("w-1", Some(json!({})))],
            Err("no module app/zzz.py in the scan".to_string()),
        );
        let reply: Value = serde_json::from_str(&respond(&drive_line(""), &source)).unwrap();

        assert_eq!(reason(&reply), "no module app/zzz.py in the scan");
    }

    #[test]
    fn a_bad_drive_request_is_refused_without_calling_the_source() {
        let ready = || vec![entry("w-1", Some(json!({})))];
        let cases = [
            (
                "{\"v\":1,\"command\":\"drive\",\"action\":\"add\",\"args\":[],\"by\":\"A\"}"
                    .to_string(),
                "needs an \"id\"",
                ready(),
            ),
            (
                "{\"v\":1,\"command\":\"drive\",\"id\":7}".to_string(),
                "id must be a string",
                ready(),
            ),
            (
                drive_line("").replace("w-1", "w-9"),
                "no window w-9; open windows: w-1",
                ready(),
            ),
            (
                drive_line(""),
                "w-1 has not finished opening",
                vec![entry("w-1", None)],
            ),
            (
                drive_line("").replace("Claude", "Cl/aude"),
                "by must be 1-32 characters",
                ready(),
            ),
            (
                drive_line("").replace("Claude", &"x".repeat(33)),
                "by must be 1-32 characters",
                ready(),
            ),
            (
                drive_line("").replace("\"by\":\"Claude\"", "\"by\":3"),
                "needs a \"by\"",
                ready(),
            ),
            (
                drive_line("").replace("\"args\":[\"app/a.py\"]", "\"args\":[1]"),
                "args must be an array of strings",
                ready(),
            ),
            (
                drive_line("").replace("\"options\":{}", "\"options\":{\"on\":true}"),
                "unknown option",
                ready(),
            ),
            (
                drive_line("").replace("\"options\":{}", "\"options\":{\"off\":1}"),
                "must be a boolean",
                ready(),
            ),
        ];

        for (line, expected, entries) in cases {
            let source = Fixed::answering(entries, Ok(json!({})));
            let reply: Value = serde_json::from_str(&respond(&line, &source)).unwrap();

            assert!(reason(&reply).contains(expected), "{expected}: {reply}");
            assert!(source.calls.lock().unwrap().is_empty(), "{expected}");
        }
    }

    #[test]
    fn an_answer_sent_to_drives_ends_the_wait_with_that_value() {
        let drives = Drives::default();
        let (request, receiver) = drives.register("w-1");

        drives
            .answer(
                request,
                &json!({ "status": "done", "result": { "summary": "x", "changed": true } }),
            )
            .unwrap();

        assert_eq!(
            drives.wait("w-1", request, &receiver, Duration::from_secs(1)),
            Ok(json!({ "summary": "x", "changed": true }))
        );
        assert!(drives.answer(request, &json!({})).is_err());
    }

    #[test]
    fn a_refused_answer_becomes_an_error_with_its_reason() {
        let drives = Drives::default();
        let (request, receiver) = drives.register("w-1");

        drives
            .answer(request, &json!({ "status": "refused", "reason": "no" }))
            .unwrap();

        assert_eq!(
            drives.wait("w-1", request, &receiver, Duration::from_secs(1)),
            Err("no".to_string())
        );
    }

    #[test]
    fn no_answer_in_time_refuses_with_did_not_answer() {
        let drives = Drives::default();
        let (request, receiver) = drives.register("w-2");

        assert_eq!(
            drives.wait("w-2", request, &receiver, Duration::from_millis(20)),
            Err("w-2 did not answer within 0 seconds".to_string())
        );
        assert!(drives.answer(request, &json!({})).is_err());
    }

    #[test]
    fn a_window_closed_while_waiting_refuses_with_closed() {
        let drives = Drives::default();
        let (request, receiver) = drives.register("w-2");
        let (other, other_receiver) = drives.register("w-3");

        drives.closed("w-2");

        assert_eq!(
            drives.wait("w-2", request, &receiver, Duration::from_secs(1)),
            Err("w-2 closed".to_string())
        );

        drives
            .answer(other, &json!({ "status": "done", "result": 1 }))
            .unwrap();

        assert_eq!(
            drives.wait("w-3", other, &other_receiver, Duration::from_secs(1)),
            Ok(json!(1))
        );
    }

    #[test]
    fn the_socket_is_readable_only_by_the_user() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fresh").join("app.sock");
        let server = Server::start(&path, Arc::new(Fixed::new(vec![]))).unwrap();
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;

        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);

        drop(server);

        assert!(!path.exists());
    }

    #[test]
    fn malformed_requests_are_refused_and_the_next_connection_still_works() {
        let (_dir, server) = started(vec![]);
        let path = server.path().to_path_buf();
        let oversize = format!("{}\n", "x".repeat(MAX_REQUEST_BYTES + 10));

        for (bytes, expected) in [
            (oversize.as_str(), "longer than 64 KiB"),
            ("nope\n", "not valid JSON"),
            ("[1]\n", "must be a JSON object"),
            ("{\"command\":\"windows\"}\n", "\"v\": 1"),
            ("{\"v\":2,\"command\":\"windows\"}\n", "\"v\": 1"),
            ("{\"v\":1,\"command\":\"nope\"}\n", "unknown command"),
            ("{\"v\":1}\n", "needs a \"command\""),
            (
                "{\"v\":1,\"command\":\"window\",\"id\":7}\n",
                "id must be a string",
            ),
        ] {
            let text = reason(&exchange(&path, bytes.as_bytes()));

            assert!(text.contains(expected), "{expected}: {text}");

            let next = exchange(&path, b"{\"v\":1,\"command\":\"windows\"}\n");

            assert_eq!(next["status"], "done");
        }
    }

    #[test]
    fn a_line_with_no_newline_is_refused_after_the_read_deadline() {
        let (_dir, server) = started(vec![]);
        let mut stream = UnixStream::connect(server.path()).unwrap();
        let started_at = Instant::now();

        stream.write_all(b"{\"v\":1").unwrap();

        let mut reply = String::new();

        std::io::BufReader::new(&stream)
            .read_line(&mut reply)
            .unwrap();

        let reply: Value = serde_json::from_str(&reply).unwrap();

        assert!(reason(&reply).contains("no newline"));
        assert!(started_at.elapsed() >= Duration::from_millis(1900));
        assert_eq!(
            exchange(server.path(), b"{\"v\":1,\"command\":\"windows\"}\n")["status"],
            "done"
        );
    }

    #[test]
    fn window_resolves_the_id_among_zero_one_and_two_windows() {
        let state = || Some(json!({ "view": null, "modules": [] }));
        let ask = |open: Vec<Entry>, request: &str| {
            let (_dir, server) = started(open);

            exchange(server.path(), format!("{request}\n").as_bytes())
        };
        let bare = "{\"v\":1,\"command\":\"window\"}";

        assert_eq!(reason(&ask(vec![], bare)), "no window is open");

        let one = ask(vec![entry("w-3", state())], bare);

        assert_eq!(one["result"]["id"], "w-3");
        assert_eq!(one["result"]["folder"], "/r/w-3");

        let two = vec![entry("w-2", state()), entry("w-1", state())];

        assert_eq!(
            reason(&ask(two.clone(), bare)),
            "2 windows are open (w-1, w-2); pass an id"
        );
        assert_eq!(
            ask(
                two.clone(),
                "{\"v\":1,\"command\":\"window\",\"id\":\"w-2\"}"
            )["result"]["id"],
            "w-2"
        );
        assert_eq!(
            reason(&ask(two, "{\"v\":1,\"command\":\"window\",\"id\":\"w-9\"}")),
            "no window w-9; open windows: w-1, w-2"
        );
    }

    #[test]
    fn the_stamped_id_and_folder_cannot_be_overridden_by_published_state() {
        let state = json!({ "id": "w-99", "folder": "/elsewhere", "view": "v" });
        let reply = respond(
            "{\"v\":1,\"command\":\"window\"}",
            &Fixed::new(vec![entry("w-1", Some(state))]),
        );
        let reply: Value = serde_json::from_str(&reply).unwrap();

        assert_eq!(reply["result"]["id"], "w-1");
        assert_eq!(reply["result"]["folder"], "/r/w-1");
        assert_eq!(reply["result"]["view"], "v");
    }

    #[test]
    fn a_dropped_snapshot_makes_the_window_unfinished_again() {
        let snapshots = Snapshots::default();

        snapshots.publish("w-1", json!({ "view": null })).unwrap();

        assert!(snapshots.get("w-1").is_some());
        assert!(snapshots.publish("w-1", json!([1])).is_err());
        assert!(snapshots.publish("w-1", json!("x")).is_err());

        snapshots.closed("w-1");

        assert!(snapshots.get("w-1").is_none());
    }

    #[test]
    fn a_stale_socket_file_is_replaced_and_a_live_one_is_not() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("app.sock");

        drop(UnixListener::bind(&path).unwrap());

        assert!(path.exists());

        let deadline = Instant::now() + Duration::from_secs(5);

        while UnixStream::connect(&path).is_ok() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }

        let first = Server::start(&path, Arc::new(Fixed::new(vec![]))).unwrap();

        assert_eq!(
            exchange(&path, b"{\"v\":1,\"command\":\"windows\"}\n")["status"],
            "done"
        );
        assert!(Server::start(&path, Arc::new(Fixed::new(vec![]))).is_err());
        assert_eq!(
            exchange(&path, b"{\"v\":1,\"command\":\"windows\"}\n")["status"],
            "done"
        );

        drop(first);
    }

    #[test]
    fn a_path_over_100_bytes_is_refused_naming_the_path() {
        let long = format!("/{}", "a".repeat(120));
        let error = socket_path(Path::new("/x"), Some(&long)).unwrap_err();

        assert!(error.contains(&long));
        assert!(Server::start(Path::new(&long), Arc::new(Fixed::new(vec![]))).is_err());
    }

    #[test]
    fn the_path_is_the_config_dir_unless_overridden() {
        assert_eq!(
            socket_path(Path::new("/c"), None).unwrap(),
            PathBuf::from("/c/app.sock")
        );
        assert_eq!(
            socket_path(Path::new("/c"), Some("/t/s.sock")).unwrap(),
            PathBuf::from("/t/s.sock")
        );
    }
}
