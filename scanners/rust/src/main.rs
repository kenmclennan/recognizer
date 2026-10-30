use std::path::PathBuf;
use std::process::{Command, ExitCode};

use recognizer_scan_rust::{render, scan};

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

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arguments = match parse_arguments(&args) {
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

    let result = match scan(&arguments.root, commit, modified) {
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
            if let Err(error) = std::fs::write(&path, text) {
                eprintln!("could not write {}: {error}", path.display());
                return ExitCode::from(2);
            }
        }
        None => print!("{text}"),
    }

    ExitCode::SUCCESS
}
