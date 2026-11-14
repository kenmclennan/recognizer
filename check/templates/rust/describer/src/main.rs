// {{program}}: a Recognizer describer written in Rust, with no dependency so it
// builds offline. Run `recognizer help plugin-guide` for the contract it follows.
use std::fs;
use std::io::Write;
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

// EDIT HERE: change prompt_version whenever the way you describe modules changes.
fn manifest() -> String {
    let mut out = String::new();

    out.push_str("{\n");
    out.push_str("  \"kind\": \"describer\",\n");
    out.push_str(&format!("  \"name\": {},\n", json_string("{{name}}")));
    out.push_str(&format!("  \"display\": {},\n", json_string("{{name}}")));
    out.push_str(&format!("  \"version\": {},\n", json_string(VERSION)));
    out.push_str("  \"protocol\": {{protocol}},\n");
    out.push_str(&format!(
        "  \"install\": {},\n",
        json_string("cargo install --path . (EDIT HERE: say how your users install {{program}})")
    ));
    out.push_str("  \"check\": true,\n");
    out.push_str("  \"long_running\": false,\n");
    out.push_str("  \"time_limit_seconds\": 120,\n");
    out.push_str("  \"units\": [\"modules\"],\n");
    out.push_str("  \"settings\": [],\n");
    out.push_str("  \"prompt_version\": \"1\"\n");
    out.push_str("}\n");

    out
}

fn event(payload: &str) {
    let mut stderr = std::io::stderr();

    let _ = writeln!(stderr, "recognizer-event {}", payload);
}

fn module_of(request: &str) -> Option<String> {
    let bytes = request.as_bytes();
    let mut from = 0;

    while let Some(found) = request[from..].find("\"module\"") {
        let start = from + found;
        let after = start + "\"module\"".len();

        from = after;

        if start > 0 && bytes[start - 1] == b'\\' {
            continue;
        }

        let rest = request[after..].trim_start();

        if !rest.starts_with(':') {
            continue;
        }

        let value = rest[1..].trim_start();

        if !value.starts_with('"') {
            continue;
        }

        let mut text = String::new();
        let mut chars = value[1..].chars();

        while let Some(c) = chars.next() {
            match c {
                '"' => return Some(text),
                '\\' => match chars.next() {
                    Some('n') => text.push(' '),
                    Some(other) => text.push(other),
                    None => return None,
                },
                c => text.push(c),
            }
        }

        return None;
    }

    None
}

fn usage() -> i32 {
    eprintln!(
        "usage: {} manifest | check | guide | run --model <name> <request-file>",
        PROGRAM
    );

    2
}

fn run(args: &[String]) -> i32 {
    let mut model: Option<String> = None;
    let mut request: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        let argument = args[index].as_str();
        let value = args.get(index + 1);

        if argument == "--model" && value.is_some() {
            model = value.cloned();
            index += 2;
        } else if request.is_none() && !argument.starts_with("--") {
            request = Some(argument.to_string());
            index += 1;
        } else {
            return usage();
        }
    }

    let (request, _model) = match (request, model) {
        (Some(request), Some(model)) => (request, model),
        _ => return usage(),
    };

    unsafe {
        signal(15, on_term as extern "C" fn(i32) as usize);
    }

    let text = match fs::read_to_string(&request) {
        Ok(text) => text,
        Err(_) => return usage(),
    };
    let module = match module_of(&text) {
        Some(module) => module,
        None => return usage(),
    };

    event(&object(&[
        ("event", json_string("start")),
        ("total", "1".to_string()),
        ("unit", json_string("modules")),
    ]));

    if STOP.load(Ordering::SeqCst) {
        return STOP_EXIT;
    }

    // EDIT HERE: describe the module in one line, for example by asking a model.
    println!("{}: replace this line with what the module is responsible for", module);

    event(&object(&[
        ("event", json_string("progress")),
        ("done", "1".to_string()),
        ("total", "1".to_string()),
        ("unit", json_string("modules")),
    ]));

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
            println!("{} describes a module with a fixed line.", PROGRAM);
            println!("It needs nothing beyond the binary itself.");
            println!("Edit the EDIT HERE lines in src/main.rs to describe modules properly.");
            0
        }
        Some("run") => run(&args[1..]),
        _ => usage(),
    };

    std::process::exit(code);
}
