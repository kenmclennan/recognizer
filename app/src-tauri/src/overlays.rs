use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::fs_safe::checked_relative;
use crate::sensors::modified_ms;

pub const OVERLAYS: &str = ".recognizer/cache/overlays";

#[derive(Debug, PartialEq, Serialize)]
pub struct OverlayFile {
    pub name: String,
    pub text: String,
    #[serde(rename = "modifiedMs")]
    pub modified_ms: Option<f64>,
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
            let modified_ms = modified_ms(&path);

            fs::read_to_string(path)
                .map(|text| (text, modified_ms))
                .map_err(|error| format!("{relative}: {error}"))
        }) {
            Ok((text, modified_ms)) => read.files.push(OverlayFile {
                name,
                text,
                modified_ms,
            }),
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

        assert!(read.files.iter().all(|file| file.modified_ms.is_some()));
        assert_eq!(
            read.files,
            vec![
                OverlayFile {
                    name: "coverage".into(),
                    text: "two".into(),
                    modified_ms: read.files[0].modified_ms,
                },
                OverlayFile {
                    name: "crap".into(),
                    text: "one".into(),
                    modified_ms: read.files[1].modified_ms,
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
