// {{program}}: a Recognizer sensor written in Rust, with no dependency so it
// builds offline. Run `recognizer help plugin-guide` for the contract it follows.
use std::fs;
use std::io::Write;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

const PROGRAM: &str = "{{program}}";
const VERSION: &str = "0.1.0";
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

// EDIT HERE: declare each metric and finding kind this sensor produces.
fn manifest() -> String {
    let mut out = String::new();

    out.push_str("{\n");
    out.push_str("  \"kind\": \"sensor\",\n");
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
    out.push_str("  \"units\": [\"modules\"],\n");
    out.push_str("  \"settings\": [],\n");
    out.push_str("  \"metrics\": [],\n");
    out.push_str("  \"findings\": [],\n");
    out.push_str("  \"runs_tests\": false,\n");
    out.push_str("  \"scoped\": false\n");
    out.push_str("}\n");

    out
}

fn event(payload: &str) {
    let mut stderr = std::io::stderr();

    let _ = writeln!(stderr, "recognizer-event {}", payload);
}

fn write_findings(commit: &str, modified: bool, output: &str, stopped: Option<(u32, u32)>) {
    let mut fields = vec![
        ("findings_version", "{{findings_version}}".to_string()),
        (
            "sensor",
            object(&[("name", json_string("{{name}}")), ("version", json_string(VERSION))]),
        ),
        ("commit", json_string(commit)),
        ("modified", modified.to_string()),
        ("inputs", object(&[])),
        ("settings", object(&[])),
        ("findings", array(&[])),
    ];

    if let Some((measured, total)) = stopped {
        fields.push((
            "stopped",
            object(&[("measured", measured.to_string()), ("total", total.to_string())]),
        ));
    }

    let temporary = format!("{}.{}.tmp", output, std::process::id());

    fs::write(&temporary, format!("{}\n", object(&fields))).expect("could not write the findings");
    fs::rename(&temporary, output).expect("could not move the findings into place");
}

fn usage() -> i32 {
    eprintln!(
        "usage: {} manifest | check [--repository <dir>] | guide | run --repository <dir> --commit <sha> --output <file> [--settings <json>]",
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
        let value = match args.get(index + 1) {
            Some(value) => value.clone(),
            None => return usage(),
        };

        match argument {
            "--repository" => repository = Some(value),
            "--commit" => commit = Some(value),
            "--output" => output = Some(value),
            "--settings" => {}
            _ => return usage(),
        }

        index += 2;
    }

    let (repository, commit, output) = match (repository, commit, output) {
        (Some(repository), Some(commit), Some(output)) => (repository, commit, output),
        _ => return usage(),
    };
    let modified = Command::new("git")
        .arg("-C")
        .arg(&repository)
        .args(["status", "--porcelain"])
        .output()
        .map(|done| !done.stdout.iter().all(|byte| byte.is_ascii_whitespace()))
        .unwrap_or(false);

    unsafe {
        signal(15, on_term as extern "C" fn(i32) as usize);
    }

    event(&object(&[
        ("event", json_string("start")),
        ("total", "1".to_string()),
        ("unit", json_string("modules")),
    ]));

    if STOP.load(Ordering::SeqCst) {
        write_findings(&commit, modified, &output, Some((0, 1)));

        return STOP_EXIT;
    }

    // EDIT HERE: measure the repository and add to the findings list.

    event(&object(&[
        ("event", json_string("progress")),
        ("done", "1".to_string()),
        ("total", "1".to_string()),
        ("unit", json_string("modules")),
    ]));
    write_findings(&commit, modified, &output, None);

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
            println!("{} measures nothing yet and writes no findings.", PROGRAM);
            println!("It needs git on PATH and nothing else.");
            println!("Edit the EDIT HERE lines in src/main.rs to measure something.");
            0
        }
        Some("run") => run(&args[1..]),
        _ => usage(),
    };

    std::process::exit(code);
}
