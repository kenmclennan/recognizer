use std::path::PathBuf;
use std::process::{Command, ExitCode};

use recognizer_scan_rust::events::Progress;
use recognizer_scan_rust::manifest;
use recognizer_scan_rust::{render, scan_reporting};

const VERBS: &str = "manifest, check, run, guide";

struct Arguments {
    root: PathBuf,
    commit: Option<String>,
    modified: Option<bool>,
    output: Option<PathBuf>,
}

enum Parsed {
    Version,
    Run(Arguments),
}

fn parse_arguments(args: &[String]) -> Result<Parsed, String> {
    let mut root = None;
    let mut commit = None;
    let mut modified = None;
    let mut output = None;
    let mut iterator = args.iter();

    if args
        .iter()
        .any(|argument| argument == "--version" || argument == "-V")
    {
        return Ok(Parsed::Version);
    }

    while let Some(argument) = iterator.next() {
        let (flag, inline) = match argument.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag, Some(value.to_string())),
            _ => (argument.as_str(), None),
        };

        match flag {
            "--commit" | "--modified" | "--output" => {
                let value = inline
                    .or_else(|| iterator.next().cloned())
                    .ok_or_else(|| format!("{flag} needs a value"))?;

                match flag {
                    "--commit" => commit = Some(value),
                    "--output" => output = Some(PathBuf::from(value)),
                    _ => {
                        modified = Some(match value.as_str() {
                            "true" => true,
                            "false" => false,
                            _ => return Err("--modified must be true or false".to_string()),
                        })
                    }
                }
            }
            other if other.starts_with("--") => return Err(format!("unknown option: {other}")),
            _ => {
                if root.replace(PathBuf::from(argument)).is_some() {
                    return Err("only one ROOT is accepted".to_string());
                }
            }
        }
    }

    Ok(Parsed::Run(Arguments {
        root: root.ok_or_else(|| "ROOT is required".to_string())?,
        commit,
        modified,
        output,
    }))
}

fn git(root: &PathBuf, arguments: &[&str]) -> Option<String> {
    let result = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .output()
        .ok()?;

    result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_string())
}

fn resolve_commit(root: &PathBuf) -> Option<String> {
    git(root, &["rev-parse", "HEAD"]).filter(|sha| !sha.is_empty())
}

fn resolve_modified(root: &PathBuf) -> Option<bool> {
    git(root, &["status", "--porcelain", "--", ".", ":!.recognizer"]).map(|text| !text.is_empty())
}

fn write_atomically(path: &std::path::Path, text: &str) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));

    let written = std::fs::write(&temporary, text).and_then(|()| std::fs::rename(&temporary, path));

    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }

    written
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args == ["manifest"] {
        print!("{}", manifest::text());
        return ExitCode::SUCCESS;
    }

    if args == ["guide"] {
        return ExitCode::SUCCESS;
    }

    if args == ["--version"] || args == ["-V"] {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    let rest = match args.split_first() {
        Some((verb, rest)) if verb == "run" => rest,
        Some((verb, _)) if verb == "check" => {
            eprintln!("recognizer-scan-rust has no check verb; the verbs are {VERBS}");
            return ExitCode::from(2);
        }
        _ => {
            eprintln!("recognizer-scan-rust: the first argument must be a verb: {VERBS}");
            return ExitCode::from(2);
        }
    };

    let arguments = match parse_arguments(rest) {
        Ok(Parsed::Run(arguments)) => arguments,
        Ok(Parsed::Version) => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };

    if !arguments.root.is_dir() {
        eprintln!("ROOT is not a directory: {}", arguments.root.display());
        return ExitCode::from(2);
    }

    let commit = arguments
        .commit
        .filter(|sha| !sha.is_empty())
        .or_else(|| resolve_commit(&arguments.root));
    let modified = arguments
        .modified
        .or_else(|| resolve_modified(&arguments.root));

    let result = match scan_reporting(
        &arguments.root,
        commit,
        modified,
        Some(&mut Progress::new()),
    ) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("could not parse:");
            eprintln!("{}", error.problems.join("\n"));
            return ExitCode::from(2);
        }
    };

    if result.missing_mods > 0 {
        eprintln!(
            "recognizer-scan-rust: {} mod declarations had no file",
            result.missing_mods
        );
    }

    let text = render(&result.document);

    match arguments.output {
        Some(path) => {
            if let Err(error) = write_atomically(&path, &text) {
                eprintln!("could not write {}: {error}", path.display());
                return ExitCode::from(2);
            }
        }
        None => print!("{text}"),
    }

    ExitCode::SUCCESS
}
