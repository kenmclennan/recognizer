use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, PartialEq)]
pub enum EditorTarget {
    SystemDefault,
    App(String),
    Shell(String),
}

pub fn classify(editor: &str, app_exists: impl Fn(&str) -> bool) -> EditorTarget {
    let editor = editor.trim();

    if editor.is_empty() {
        return EditorTarget::SystemDefault;
    }

    let named_app = !editor.contains('/') && app_exists(editor);
    let bundle_path = editor.ends_with(".app") && Path::new(editor).is_dir();

    if named_app || bundle_path {
        EditorTarget::App(editor.to_string())
    } else {
        EditorTarget::Shell(editor.to_string())
    }
}

pub fn app_exists(name: &str) -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let bundle = format!("{name}.app");

    [
        "/Applications".to_string(),
        format!("{home}/Applications"),
        "/System/Applications".to_string(),
        "/System/Applications/Utilities".to_string(),
    ]
    .iter()
    .any(|directory| Path::new(directory).join(&bundle).is_dir())
}

pub fn launch_command(target: &EditorTarget, path: &Path, shell: &str) -> (String, Vec<String>) {
    let path = path.display().to_string();

    match target {
        EditorTarget::SystemDefault => ("open".to_string(), vec!["-t".to_string(), path]),
        EditorTarget::App(name) => (
            "open".to_string(),
            vec!["-a".to_string(), name.clone(), path],
        ),
        EditorTarget::Shell(line) => (
            shell.to_string(),
            vec![
                "-ilc".to_string(),
                format!("{line} \"$1\""),
                "recognizer".to_string(),
                path,
            ],
        ),
    }
}

pub fn default_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string())
}

pub fn launch(editor: &str, path: &Path) -> Result<(), String> {
    let target = classify(editor, app_exists);
    let (program, args) = launch_command(&target, path, &default_shell());

    Command::new(&program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not start {program}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn installed(name: &str) -> bool {
        name == "Sublime Text"
    }

    #[test]
    fn a_blank_editor_is_the_system_default() {
        assert_eq!(classify("", installed), EditorTarget::SystemDefault);
        assert_eq!(classify("   ", installed), EditorTarget::SystemDefault);
    }

    #[test]
    fn an_installed_app_name_is_an_app() {
        assert_eq!(
            classify("Sublime Text", installed),
            EditorTarget::App("Sublime Text".to_string())
        );
    }

    #[test]
    fn an_uninstalled_name_or_a_command_is_a_shell_command() {
        assert_eq!(
            classify("code", installed),
            EditorTarget::Shell("code".to_string())
        );
        assert_eq!(
            classify("code --goto", installed),
            EditorTarget::Shell("code --goto".to_string())
        );
        assert_eq!(
            classify("/usr/local/bin/code", installed),
            EditorTarget::Shell("/usr/local/bin/code".to_string())
        );
    }

    #[test]
    fn a_bundle_path_is_an_app_only_when_it_exists() {
        let dir = TempDir::new().unwrap();
        let bundle = dir.path().join("Editor.app");

        std::fs::create_dir_all(&bundle).unwrap();

        let existing = bundle.display().to_string();
        let missing = dir.path().join("Missing.app").display().to_string();

        assert_eq!(
            classify(&existing, installed),
            EditorTarget::App(existing.clone())
        );
        assert_eq!(
            classify(&missing, installed),
            EditorTarget::Shell(missing.clone())
        );
    }

    #[test]
    fn the_system_default_opens_as_text() {
        assert_eq!(
            launch_command(
                &EditorTarget::SystemDefault,
                Path::new("/r/a.py"),
                "/bin/zsh"
            ),
            (
                "open".to_string(),
                vec!["-t".to_string(), "/r/a.py".to_string()]
            )
        );
    }

    #[test]
    fn an_app_opens_by_name() {
        assert_eq!(
            launch_command(
                &EditorTarget::App("Sublime Text".to_string()),
                Path::new("/r/a.py"),
                "/bin/zsh"
            ),
            (
                "open".to_string(),
                vec![
                    "-a".to_string(),
                    "Sublime Text".to_string(),
                    "/r/a.py".to_string()
                ]
            )
        );
    }

    #[test]
    fn a_shell_command_runs_in_a_login_shell_with_the_path_as_one_argument() {
        let path = Path::new("/r/it's a \"file\" $(x).py");
        let (program, args) = launch_command(
            &EditorTarget::Shell("code --goto".to_string()),
            path,
            "/bin/zsh",
        );

        assert_eq!(program, "/bin/zsh");
        assert_eq!(args[0], "-ilc");
        assert_eq!(args[1], "code --goto \"$1\"");
        assert_eq!(args[2], "recognizer");
        assert_eq!(args[3], path.display().to_string());
        assert_eq!(args.len(), 4);
    }

    #[test]
    fn the_command_is_built_from_the_current_editor_string() {
        let first = launch_command(&classify("code", installed), Path::new("/r"), "/bin/zsh");
        let second = launch_command(
            &classify("Sublime Text", installed),
            Path::new("/r"),
            "/bin/zsh",
        );

        assert_ne!(first, second);
    }
}
