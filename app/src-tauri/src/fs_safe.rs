use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn checked_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("path is empty".to_string());
    }

    let requested = Path::new(relative);

    if requested.is_absolute() {
        return Err(format!("{relative} is absolute"));
    }

    if requested
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{relative} leaves the folder"));
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let canonical = fs::canonicalize(canonical_root.join(requested))
        .map_err(|error| format!("{relative}: {error}"))?;

    if !canonical.starts_with(&canonical_root) {
        return Err(format!("{relative} leaves the folder"));
    }

    match fs::metadata(&canonical) {
        Ok(metadata) if metadata.is_file() => Ok(canonical),
        _ => Err(format!("{relative} is not a regular file")),
    }
}

pub fn write_atomic(target: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut name = target.as_os_str().to_owned();

    name.push(".tmp");

    let temporary = PathBuf::from(name);

    fs::write(&temporary, text)?;

    fs::rename(&temporary, target).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn folder() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");

        fs::create_dir_all(&root).unwrap();

        (dir, root)
    }

    #[test]
    fn refuses_a_parent_component() {
        let (_dir, root) = folder();

        fs::write(root.parent().unwrap().join("outside.md"), "x").unwrap();

        assert!(checked_relative(&root, "../outside.md").is_err());
        assert!(checked_relative(&root, "a/../../outside.md").is_err());
    }

    #[test]
    fn refuses_an_empty_or_absolute_path() {
        let (_dir, root) = folder();

        assert!(checked_relative(&root, "").is_err());
        assert!(checked_relative(&root, "/etc/hosts").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_to_a_file_outside_the_root() {
        let (dir, root) = folder();
        let outside = dir.path().join("outside.md");

        fs::write(&outside, "x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link.md")).unwrap();

        assert!(checked_relative(&root, "link.md").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_to_a_directory() {
        let (_dir, root) = folder();

        fs::create_dir_all(root.join("sub")).unwrap();
        std::os::unix::fs::symlink(root.join("sub"), root.join("dirlink")).unwrap();

        assert!(checked_relative(&root, "dirlink").is_err());
        assert!(checked_relative(&root, "sub").is_err());
    }

    #[test]
    fn returns_the_canonical_path_of_a_regular_file() {
        let (_dir, root) = folder();

        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.md"), "x").unwrap();

        let found = checked_relative(&root, "sub/a.md").unwrap();

        assert_eq!(found, fs::canonicalize(root.join("sub/a.md")).unwrap());
    }

    #[test]
    fn write_atomic_writes_the_target_and_leaves_no_temporary() {
        let (_dir, root) = folder();
        let target = root.join("nested/out.md");

        write_atomic(&target, "first").unwrap();
        write_atomic(&target, "second").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
        assert!(!root.join("nested/out.md.tmp").exists());
    }
}
