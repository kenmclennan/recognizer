use std::fs;
use std::path::Path;

use crate::fs_safe::checked_relative;

const MAX_CHARS: usize = 200;

pub fn read_line(folder: &Path, relative: &str, line: u32) -> Result<Option<String>, String> {
    if line == 0 {
        return Ok(None);
    }

    let path = checked_relative(folder, relative)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let Ok(text) = String::from_utf8(bytes) else {
        return Ok(None);
    };

    Ok(text
        .lines()
        .nth(line as usize - 1)
        .map(|found| found.trim_end().chars().take(MAX_CHARS).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn folder_with(content: &[u8]) -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");

        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.py"), content).unwrap();

        (dir, root)
    }

    #[test]
    fn returns_the_first_middle_and_last_line() {
        let (_dir, root) = folder_with(b"one\ntwo  \nthree");

        assert_eq!(read_line(&root, "a.py", 1), Ok(Some("one".to_string())));
        assert_eq!(read_line(&root, "a.py", 2), Ok(Some("two".to_string())));
        assert_eq!(read_line(&root, "a.py", 3), Ok(Some("three".to_string())));
    }

    #[test]
    fn returns_none_past_the_end_or_for_line_zero() {
        let (_dir, root) = folder_with(b"one\ntwo\n");

        assert_eq!(read_line(&root, "a.py", 3), Ok(None));
        assert_eq!(read_line(&root, "a.py", 0), Ok(None));
    }

    #[test]
    fn returns_none_for_a_file_that_is_not_utf8() {
        let (_dir, root) = folder_with(&[0xff, 0xfe, b'\n']);

        assert_eq!(read_line(&root, "a.py", 1), Ok(None));
    }

    #[test]
    fn truncates_a_long_line_to_200_characters() {
        let long = "x".repeat(500);
        let (_dir, root) = folder_with(long.as_bytes());

        assert_eq!(
            read_line(&root, "a.py", 1).unwrap().map(|text| text.len()),
            Some(200)
        );
    }

    #[test]
    fn refuses_a_parent_path_and_an_absolute_path() {
        let (_dir, root) = folder_with(b"x");

        fs::write(root.parent().unwrap().join("outside.py"), "secret").unwrap();

        assert!(read_line(&root, "../outside.py", 1).is_err());
        assert!(read_line(
            &root,
            root.parent().unwrap().join("outside.py").to_str().unwrap(),
            1
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_out_of_the_folder() {
        let (_dir, root) = folder_with(b"x");
        let outside = root.parent().unwrap().join("outside.py");

        fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.py")).unwrap();

        assert!(read_line(&root, "link.py", 1).is_err());
    }
}
