use std::path::{Path, PathBuf};

use percent_encoding::{percent_encode, AsciiSet, NON_ALPHANUMERIC};

use crate::views;

const SCHEME: &str = "recognizer://";
const ENCODED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

#[derive(Debug, PartialEq)]
pub struct Link {
    pub repo: PathBuf,
    pub view: Option<String>,
}

pub fn is_link(argument: &str) -> bool {
    argument
        .get(..SCHEME.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(SCHEME))
}

pub fn build(folder: &Path, view: &str) -> String {
    format!(
        "{SCHEME}open?repo={}&view={view}",
        percent_encode(folder.to_string_lossy().as_bytes(), ENCODED)
    )
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn decode(raw: &str, name: &str) -> Result<String, String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;

    while at < bytes.len() {
        if bytes[at] == b'%' {
            let pair = bytes
                .get(at + 1)
                .copied()
                .and_then(hex)
                .zip(bytes.get(at + 2).copied().and_then(hex));
            let Some((high, low)) = pair else {
                return Err(format!("{name} has a malformed percent escape"));
            };

            out.push(high * 16 + low);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }

    let text = String::from_utf8(out).map_err(|_| format!("{name} is not valid UTF-8"))?;

    if text.contains('\0') {
        return Err(format!("{name} contains a NUL"));
    }

    Ok(text)
}

pub fn parse(url: &str) -> Result<Link, String> {
    if !is_link(url) {
        return Err("not a recognizer:// link".to_string());
    }

    let rest = &url[SCHEME.len()..];

    if rest.contains('#') {
        return Err("a link takes no fragment".to_string());
    }

    let (head, query) = rest.split_once('?').unwrap_or((rest, ""));

    if head != "open" && head != "open/" {
        return Err("only recognizer://open is a link".to_string());
    }

    let mut repo = None;
    let mut view = None;

    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            return Err(if pair.is_empty() {
                "the link needs a repo".to_string()
            } else {
                format!("parameter {pair} has no value")
            });
        };

        let slot = match key {
            "repo" => &mut repo,
            "view" => &mut view,
            _ => return Err(format!("unknown parameter {key}")),
        };

        if value.is_empty() {
            return Err(format!("{key} is empty"));
        }

        if slot.replace(decode(value, key)?).is_some() {
            return Err(format!("{key} is given twice"));
        }
    }

    let repo = repo.ok_or_else(|| "the link needs a repo".to_string())?;

    if !repo.starts_with('/') {
        return Err(format!("repo must be an absolute path: {repo}"));
    }

    if let Some(name) = &view {
        if !views::valid_name(name) {
            return Err(format!("{name:?} is not a valid view name"));
        }
    }

    Ok(Link {
        repo: PathBuf::from(repo),
        view,
    })
}

pub fn validate(link: &Link) -> Result<PathBuf, String> {
    let folder = std::fs::canonicalize(&link.repo)
        .map_err(|_| format!("folder not found: {}", link.repo.display()))?;

    if !folder.is_dir() {
        return Err(format!("{} is not a folder", link.repo.display()));
    }

    if let Some(name) = &link.view {
        if !views::view_file(&folder, name).is_file() {
            return Err(format!(
                "{name} is not a saved view in {}",
                link.repo.display()
            ));
        }
    }

    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::TempDir;

    fn table() -> Vec<Value> {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/links/syntax.json"
        ))
        .unwrap();

        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn every_case_in_the_shared_syntax_table_parses_or_is_refused() {
        let cases = table();

        assert!(cases.len() > 30);

        for case in cases {
            let link = case["link"].as_str().unwrap();
            let parsed = parse(link);

            if case["ok"].as_bool().unwrap() {
                assert_eq!(
                    parsed,
                    Ok(Link {
                        repo: PathBuf::from(case["repo"].as_str().unwrap()),
                        view: case["view"].as_str().map(str::to_string),
                    }),
                    "{link}"
                );
            } else {
                assert!(parsed.is_err(), "{link} should be refused");
            }
        }
    }

    #[test]
    fn a_built_link_parses_back_to_its_folder_and_view() {
        let folder = Path::new("/tmp/my repo/café+x&y");
        let link = build(folder, "overview");

        assert_eq!(
            link,
            "recognizer://open?repo=%2Ftmp%2Fmy%20repo%2Fcaf%C3%A9%2Bx%26y&view=overview"
        );
        assert_eq!(
            parse(&link),
            Ok(Link {
                repo: folder.to_path_buf(),
                view: Some("overview".to_string())
            })
        );
    }

    #[test]
    fn is_link_matches_the_scheme_in_any_case_only() {
        assert!(is_link("recognizer://open?repo=%2Fa"));
        assert!(is_link("Recognizer://x"));
        assert!(!is_link("recognizer-x"));
        assert!(!is_link("/tmp/recognizer://"));
        assert!(!is_link("é"));
    }

    fn repo_with_view() -> TempDir {
        let dir = TempDir::new().unwrap();
        let views = dir.path().join(".recognizer/views");

        std::fs::create_dir_all(&views).unwrap();
        std::fs::write(views.join("overview.json"), "{}").unwrap();

        dir
    }

    fn link_to(repo: &Path, view: Option<&str>) -> Link {
        Link {
            repo: repo.to_path_buf(),
            view: view.map(str::to_string),
        }
    }

    #[test]
    fn a_folder_with_a_saved_view_validates() {
        let dir = repo_with_view();

        assert_eq!(
            validate(&link_to(dir.path(), Some("overview"))),
            Ok(std::fs::canonicalize(dir.path()).unwrap())
        );
    }

    #[test]
    fn a_link_with_no_view_validates_for_any_folder() {
        let dir = TempDir::new().unwrap();

        assert!(validate(&link_to(dir.path(), None)).is_ok());
    }

    #[test]
    fn a_missing_folder_is_refused() {
        let dir = TempDir::new().unwrap();
        let error = validate(&link_to(&dir.path().join("gone"), None)).unwrap_err();

        assert!(error.starts_with("folder not found"), "{error}");
    }

    #[test]
    fn a_file_named_as_the_folder_is_refused() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a.txt");

        std::fs::write(&file, "x").unwrap();

        let error = validate(&link_to(&file, None)).unwrap_err();

        assert!(error.contains("is not a folder"), "{error}");
    }

    #[test]
    fn a_view_not_saved_in_the_folder_is_refused_naming_it() {
        let dir = repo_with_view();
        let accepted = validate(&link_to(dir.path(), Some("overview")));
        let refused = validate(&link_to(dir.path(), Some("other"))).unwrap_err();

        assert!(accepted.is_ok());
        assert!(
            refused.starts_with("other is not a saved view"),
            "{refused}"
        );
    }
}
