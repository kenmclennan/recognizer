use std::path::{Path, PathBuf};

use crate::link;

#[derive(Debug, PartialEq)]
pub enum Launch {
    Window { folder: Option<PathBuf> },
    Link { url: String },
    Refuse { text: String },
}

pub fn launch_for<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Launch {
    let args: Vec<String> = args.into_iter().collect();

    if let Some(unknown) = args
        .iter()
        .find(|argument| argument.starts_with('-'))
        .or_else(|| args.get(1))
    {
        return Launch::Refuse {
            text: format!("recognizer: unknown argument '{unknown}'"),
        };
    }

    if let Some(url) = args.first().filter(|argument| link::is_link(argument)) {
        return Launch::Link { url: url.clone() };
    }

    Launch::Window {
        folder: args.first().map(|argument| cwd.join(argument)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|argument| argument.to_string()).collect()
    }

    #[test]
    fn no_argument_opens_an_empty_window() {
        assert_eq!(
            launch_for(Vec::new(), Path::new("/work")),
            Launch::Window { folder: None }
        );
    }

    #[test]
    fn an_absolute_folder_is_kept() {
        assert_eq!(
            launch_for(args(&["/tmp/repo"]), Path::new("/work")),
            Launch::Window {
                folder: Some(PathBuf::from("/tmp/repo"))
            }
        );
    }

    #[test]
    fn a_relative_folder_is_resolved_against_the_working_directory() {
        assert_eq!(
            launch_for(args(&["repo"]), Path::new("/work")),
            Launch::Window {
                folder: Some(PathBuf::from("/work/repo"))
            }
        );
    }

    #[test]
    fn two_arguments_are_refused_naming_the_second() {
        assert_eq!(
            launch_for(args(&["/a", "/b"]), Path::new("/work")),
            Launch::Refuse {
                text: "recognizer: unknown argument '/b'".to_string()
            }
        );
    }

    #[test]
    fn a_link_argument_is_a_link_and_never_a_folder() {
        assert_eq!(
            launch_for(args(&["recognizer://open?repo=%2Ftmp"]), Path::new("/work")),
            Launch::Link {
                url: "recognizer://open?repo=%2Ftmp".to_string()
            }
        );
        assert_eq!(
            launch_for(args(&["RECOGNIZER://open"]), Path::new("/work")),
            Launch::Link {
                url: "RECOGNIZER://open".to_string()
            }
        );
    }

    #[test]
    fn a_folder_that_only_looks_like_the_scheme_is_a_folder() {
        assert_eq!(
            launch_for(args(&["recognizer-x"]), Path::new("/work")),
            Launch::Window {
                folder: Some(PathBuf::from("/work/recognizer-x"))
            }
        );
    }

    #[test]
    fn a_link_with_a_second_argument_is_refused() {
        assert!(matches!(
            launch_for(args(&["recognizer://open", "/b"]), Path::new("/work")),
            Launch::Refuse { .. }
        ));
    }

    #[test]
    fn a_flag_is_refused() {
        for flag in ["--version", "--help", "-h", "--unknown"] {
            assert_eq!(
                launch_for(args(&[flag]), Path::new("/work")),
                Launch::Refuse {
                    text: format!("recognizer: unknown argument '{flag}'")
                }
            );
        }
    }
}
