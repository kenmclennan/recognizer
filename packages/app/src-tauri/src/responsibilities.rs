use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

const RESPONSIBILITIES: &str = ".recognizer/responsibilities.json";
const CONFIG: &str = ".recognizer/config.yaml";

pub type Snapshot = Vec<(String, u128, u64)>;

pub fn snapshot(folder: &Path) -> Snapshot {
    [RESPONSIBILITIES, CONFIG]
        .iter()
        .filter_map(|relative| {
            let metadata = fs::metadata(folder.join(relative)).ok()?;
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();

            Some((relative.to_string(), modified, metadata.len()))
        })
        .collect()
}

pub fn snapshot_changed(previous: &Snapshot, next: &Snapshot) -> bool {
    previous != next
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn repo() -> TempDir {
        let dir = TempDir::new().unwrap();

        fs::create_dir_all(dir.path().join(".recognizer")).unwrap();

        dir
    }

    #[test]
    fn the_snapshot_changes_with_either_file_and_not_with_others() {
        let dir = repo();
        let empty = snapshot(dir.path());

        fs::write(dir.path().join(RESPONSIBILITIES), "1").unwrap();

        let one = snapshot(dir.path());

        assert!(snapshot_changed(&empty, &one));
        assert!(!snapshot_changed(&one, &snapshot(dir.path())));

        fs::write(dir.path().join(CONFIG), "x").unwrap();

        let two = snapshot(dir.path());

        assert!(snapshot_changed(&one, &two));

        fs::write(dir.path().join(".recognizer/policy.yaml"), "p").unwrap();
        fs::create_dir_all(dir.path().join(".recognizer/views")).unwrap();
        fs::write(dir.path().join(".recognizer/views/v.json"), "{}").unwrap();

        assert!(!snapshot_changed(&two, &snapshot(dir.path())));

        fs::write(dir.path().join(RESPONSIBILITIES), "12").unwrap();

        let longer = snapshot(dir.path());

        assert!(snapshot_changed(&two, &longer));

        fs::remove_file(dir.path().join(CONFIG)).unwrap();

        assert!(snapshot_changed(&longer, &snapshot(dir.path())));
    }
}
