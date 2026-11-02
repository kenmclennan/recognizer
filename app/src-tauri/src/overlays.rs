use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::fs_safe::checked_relative;

pub const OVERLAYS: &str = ".recognizer/cache/overlays";

#[derive(Debug, PartialEq, Serialize)]
pub struct OverlayFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Default, PartialEq, Serialize)]
pub struct OverlaysRead {
    pub files: Vec<OverlayFile>,
    pub refused: Vec<String>,
}

pub fn overlay_names(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder.join(OVERLAYS))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .filter_map(|file| file.strip_suffix(".json").map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    names.sort();

    names
}

pub fn read_overlays(folder: &Path) -> OverlaysRead {
    let mut read = OverlaysRead::default();

    for name in overlay_names(folder) {
        let relative = format!("{OVERLAYS}/{name}.json");

        match checked_relative(folder, &relative).and_then(|path| {
            fs::read_to_string(path).map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok(text) => read.files.push(OverlayFile { name, text }),
            Err(_) => read.refused.push(name),
        }
    }

    read
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn overlay_path(dir: &TempDir, name: &str) -> std::path::PathBuf {
        dir.path().join(OVERLAYS).join(format!("{name}.json"))
    }

    #[test]
    fn read_overlays_returns_every_json_file_sorted_and_refuses_a_symlink_out() {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(OVERLAYS)).unwrap();
        fs::write(overlay_path(&dir, "crap"), "one").unwrap();
        fs::write(overlay_path(&dir, "coverage"), "two").unwrap();
        fs::write(dir.path().join(OVERLAYS).join("notes.txt"), "no").unwrap();
        fs::write(outside.path().join("x.json"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("x.json"), overlay_path(&dir, "evil"))
            .unwrap();

        let read = read_overlays(dir.path());

        assert_eq!(
            read.files,
            vec![
                OverlayFile {
                    name: "coverage".into(),
                    text: "two".into()
                },
                OverlayFile {
                    name: "crap".into(),
                    text: "one".into()
                },
            ]
        );
        assert_eq!(read.refused, vec!["evil".to_string()]);
    }

    #[test]
    fn read_overlays_of_a_repository_without_the_folder_is_empty() {
        assert_eq!(
            read_overlays(TempDir::new().unwrap().path()),
            OverlaysRead::default()
        );
    }
}
