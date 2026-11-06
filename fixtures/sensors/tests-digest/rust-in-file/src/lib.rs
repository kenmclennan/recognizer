pub mod more;

pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

// #[test] in a comment is not a test
pub const NOTE: &str = "#[cfg(test)] in a string is not a test";

#[cfg(not(test))]
pub fn production_only() -> i32 {
    1
}

#[cfg(all(test, unix))]
fn unix_helper() -> char {
    let quote = '\'';

    assert_ne!(quote, '}');

    '}'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds() {
        assert_eq!(add(1, 2), 3);
    }

    #[test]
    fn closing_brace_in_a_raw_string() {
        let text: &'static str = r#"}"#;

        assert_eq!(text.len(), 1);
    }
}
