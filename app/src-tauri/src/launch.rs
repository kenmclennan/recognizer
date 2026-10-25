use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum Launch {
    Window { folder: Option<PathBuf> },
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
