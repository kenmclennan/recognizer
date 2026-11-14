// {{program}}: a Recognizer scanner written in Rust, with no dependency so it
// builds offline. Run `recognizer help plugin-guide` for the contract it follows.
mod sha256;

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

const PROGRAM: &str = "{{program}}";
const VERSION: &str = "0.1.0";

// EDIT HERE: the extension of the files this scanner reads. A real scanner
// also parses each file and fills in members and edges.
const EXTENSION: &str = ".{{name}}";

const STOP_EXIT: i32 = 143;

static STOP: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn signal(signum: i32, handler: usize) -> usize;
}

extern "C" fn on_term(_signum: i32) {
    STOP.store(true, Ordering::SeqCst);
}

fn json_string(text: &str) -> String {
    let mut out = String::from("\"");

    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }

    out.push('"');

    out
}

fn object(fields: &[(&str, String)]) -> String {
    let body: Vec<String> = fields
        .iter()
        .map(|(key, value)| format!("{}: {}", json_string(key), value))
        .collect();

    format!("{}{}{}", "{", body.join(", "), "}")
}

fn array(items: &[String]) -> String {
    format!("[{}]", items.join(", "))
}

fn manifest() -> String {
    let mut out = String::new();

    out.push_str("{\n");
    out.push_str("  \"kind\": \"scanner\",\n");
    out.push_str(&format!("  \"name\": {},\n", json_string("{{name}}")));
    out.push_str(&format!("  \"display\": {},\n", json_string("{{name}}")));
    out.push_str(&format!("  \"version\": {},\n", json_string(VERSION)));
    out.push_str("  \"protocol\": {{protocol}},\n");
    out.push_str(&format!(
        "  \"install\": {},\n",
        json_string("cargo install --path . (EDIT HERE: say how your users install {{program}})")
    ));
    out.push_str("  \"check\": true,\n");
    out.push_str("  \"long_running\": true,\n");
    out.push_str("  \"units\": [\"files\"],\n");
    out.push_str("  \"settings\": [],\n");
    out.push_str("  \"languages\": [\n");
    out.push_str("    {\n");
    out.push_str(&format!("      \"name\": {},\n", json_string("{{name}}")));
    out.push_str(&format!("      \"extensions\": [{}],\n", json_string(EXTENSION)));
    out.push_str("      \"files\": [],\n");
    out.push_str("      \"skip\": {\n");
    out.push_str("        \"directory_names\": [],\n");
    out.push_str("        \"directory_prefixes\": [\".\"],\n");
    out.push_str("        \"directory_suffixes\": [],\n");
    out.push_str("        \"directory_markers\": [],\n");
    out.push_str("        \"file_globs\": []\n");
    out.push_str("      }\n");
    out.push_str("    }\n");
    out.push_str("  ]\n");
    out.push_str("}\n");

    out
}

fn event(payload: &str) {
    let mut stderr = std::io::stderr();

    let _ = writeln!(stderr, "recognizer-event {}", payload);
}

fn git(repository: &str, args: &[&str]) -> Option<Vec<u8>> {
    let done = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .output()
        .ok()?;

    if done.status.success() {
        Some(done.stdout)
    } else {
        None
    }
}

fn listed_files(repository: &str) -> Vec<String> {
    let listing = git(
        repository,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    )
    .unwrap_or_default();
    let mut names: Vec<String> = String::from_utf8_lossy(&listing)
        .split('\0')
        .filter(|name| name.ends_with(EXTENSION))
        .map(|name| name.to_string())
        .collect();

    names.sort();
    names.dedup();

    names
}

struct Scan {
    commit: Option<String>,
    modified: Option<bool>,
    files: Vec<(String, String)>,
}

fn write_scan(scan: &Scan, output: &str) {
    let files: Vec<String> = scan
        .files
        .iter()
        .map(|(path, hash)| {
            object(&[("path", json_string(path)), ("hash", json_string(hash))])
        })
        .collect();
    let modules: Vec<String> = scan
        .files
        .iter()
        .map(|(path, _)| {
            object(&[
                ("id", json_string(path)),
                ("language", json_string("{{name}}")),
                ("kind", json_string("module")),
                ("members", array(&[])),
            ])
        })
        .collect();
    let selection = object(&[
        ("extensions", array(&[json_string(EXTENSION)])),
        ("skip_directory_names", array(&[])),
        ("skip_directory_prefixes", array(&[])),
        ("skip_directory_suffixes", array(&[])),
        ("skip_directories_containing", array(&[])),
        ("skip_file_globs", array(&[])),
    ]);
    let document = object(&[
        ("schema_version", "{{scan_schema_version}}".to_string()),
        (
            "scanner",
            object(&[("name", json_string(PROGRAM)), ("version", json_string(VERSION))]),
        ),
        (
            "commit",
            scan.commit.as_deref().map_or("null".to_string(), json_string),
        ),
        (
            "modified",
            scan.modified.map_or("null".to_string(), |value| value.to_string()),
        ),
        ("files", array(&files)),
        ("selection", selection),
        ("modules", array(&modules)),
        ("edges", array(&[])),
        ("foreign", array(&[])),
    ]);
    let temporary = format!("{}.{}.tmp", output, std::process::id());

    fs::write(&temporary, format!("{}\n", document)).expect("could not write the scan");
    fs::rename(&temporary, output).expect("could not move the scan into place");
}

fn usage() -> i32 {
    eprintln!(
        "usage: {} manifest | check | guide | run <repository> --output <file> [--commit <sha>]",
        PROGRAM
    );

    2
}

fn run(args: &[String]) -> i32 {
    let mut repository: Option<String> = None;
    let mut commit: Option<String> = None;
    let mut output: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        let argument = args[index].as_str();
        let value = args.get(index + 1);

        if argument == "--output" && value.is_some() {
            output = value.cloned();
            index += 2;
        } else if argument == "--commit" && value.is_some() {
            commit = value.cloned();
            index += 2;
        } else if repository.is_none() && !argument.starts_with("--") {
            repository = Some(argument.to_string());
            index += 1;
        } else {
            return usage();
        }
    }

    let (repository, output) = match (repository, output) {
        (Some(repository), Some(output)) => (repository, output),
        _ => return usage(),
    };

    let modified = commit.as_ref().map(|_| {
        git(&repository, &["status", "--porcelain"])
            .map(|status| !status.iter().all(|byte| byte.is_ascii_whitespace()))
            .unwrap_or(false)
    });
    let mut scan = Scan {
        commit,
        modified,
        files: Vec::new(),
    };

    unsafe {
        signal(15, on_term as extern "C" fn(i32) as usize);
    }

    let names = listed_files(&repository);

    event(&object(&[
        ("event", json_string("start")),
        ("total", names.len().to_string()),
        ("unit", json_string("files")),
    ]));

    for (position, name) in names.iter().enumerate() {
        if STOP.load(Ordering::SeqCst) {
            write_scan(&scan, &output);

            return STOP_EXIT;
        }

        let path = Path::new(&repository).join(name);

        if path.is_file() {
            if let Ok(bytes) = fs::read(&path) {
                // EDIT HERE: parse the file and fill in members; add edges between modules.
                scan.files.push((name.clone(), sha256::sha256_hex(&bytes)));
            }
        }

        event(&object(&[
            ("event", json_string("progress")),
            ("done", (position + 1).to_string()),
            ("total", names.len().to_string()),
            ("unit", json_string("files")),
        ]));
    }

    write_scan(&scan, &output);

    0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match args.first().map(|verb| verb.as_str()) {
        Some("manifest") => {
            print!("{}", manifest());
            0
        }
        Some("check") => {
            println!("{}", "{\"gaps\":[],\"notes\":[]}");
            0
        }
        Some("guide") => {
            println!("{} reads files ending in {}.", PROGRAM, EXTENSION);
            println!("It needs git on PATH and nothing else.");
            println!("Edit the EDIT HERE lines in src/main.rs to make it read your language.");
            0
        }
        Some("run") => run(&args[1..]),
        _ => usage(),
    };

    std::process::exit(code);
}
