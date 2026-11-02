#[derive(Debug, Clone, PartialEq)]
pub enum Scalar {
    Number(String),
    Bool(bool),
    Text(String),
}

impl Scalar {
    pub fn from_json(value: &serde_json::Value) -> Result<Scalar, String> {
        match value {
            serde_json::Value::Number(number) => Ok(Scalar::Number(number.to_string())),
            serde_json::Value::Bool(flag) => Ok(Scalar::Bool(*flag)),
            serde_json::Value::String(text) => Ok(Scalar::Text(text.clone())),
            _ => Err("a nested or null setting cannot be written".to_string()),
        }
    }

    fn literal(&self) -> String {
        match self {
            Scalar::Number(text) => text.clone(),
            Scalar::Bool(flag) => flag.to_string(),
            Scalar::Text(text) => serde_json::Value::String(text.clone()).to_string(),
        }
    }
}

struct Line<'a> {
    text: &'a str,
    indent: usize,
    blank: bool,
    tabbed: bool,
}

fn body(raw: &str) -> &str {
    raw.trim_end_matches(['\n', '\r'])
}

fn lines_of(text: &str) -> Vec<Line<'_>> {
    text.split_inclusive('\n')
        .map(|raw| {
            let content = body(raw);
            let trimmed = content.trim_start_matches(' ');

            Line {
                text: raw,
                indent: content.len() - trimmed.len(),
                blank: trimmed.trim().is_empty() || trimmed.starts_with('#'),
                tabbed: content[..content.len() - content.trim_start_matches([' ', '\t']).len()]
                    .contains('\t'),
            }
        })
        .collect()
}

fn eol_of(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn without_comment(value: &str) -> &str {
    let value = value.trim();

    match value.find(" #") {
        Some(at) => value[..at].trim(),
        None if value.starts_with('#') => "",
        None => value,
    }
}

fn key_of(line: &Line) -> Option<String> {
    let content = body(line.text).trim_start_matches(' ');
    let at = content.find(':')?;
    let key = content[..at].trim().trim_matches(['"', '\'']);

    Some(key.to_string())
}

struct Block {
    key_line: usize,
    last_child: Option<usize>,
    child_indent: Option<usize>,
}

fn find_sensors(lines: &[Line]) -> Result<Option<Block>, String> {
    let Some(key_line) = lines.iter().position(|line| {
        !line.blank && line.indent == 0 && key_of(line).as_deref() == Some("sensors")
    }) else {
        return Ok(None);
    };

    let content = body(lines[key_line].text);
    let rest = without_comment(&content["sensors".len()..].trim_start()[1..]);

    if !rest.is_empty() && rest != "{}" {
        return Err(format!(
            "line {}: sensors is not a block mapping the editor understands",
            key_line + 1
        ));
    }

    let mut last_child = None;
    let mut child_indent = None;

    for (index, line) in lines.iter().enumerate().skip(key_line + 1) {
        if line.blank {
            continue;
        }

        if line.tabbed {
            return Err(format!(
                "line {}: tab indentation is not understood",
                index + 1
            ));
        }

        if line.indent == 0 {
            break;
        }

        if rest == "{}" {
            return Err(format!(
                "line {}: sensors is an empty mapping with children",
                index + 1
            ));
        }

        child_indent.get_or_insert(line.indent);
        last_child = Some(index);
    }

    Ok(Some(Block {
        key_line,
        last_child,
        child_indent,
    }))
}

fn entry_range(lines: &[Line], block: &Block, name: &str) -> Option<(usize, usize)> {
    let indent = block.child_indent?;
    let last = block.last_child?;
    let start = (block.key_line + 1..=last).find(|&index| {
        let line = &lines[index];

        !line.blank && line.indent == indent && key_of(line).as_deref() == Some(name)
    })?;
    let mut end = start;

    for (index, line) in lines.iter().enumerate().take(last + 1).skip(start + 1) {
        if line.blank {
            continue;
        }

        if line.indent <= indent {
            break;
        }

        end = index;
    }

    Some((start, end))
}

fn with_eol(text: &str, eol: &str) -> String {
    if text.ends_with('\n') || text.is_empty() {
        text.to_string()
    } else {
        format!("{text}{eol}")
    }
}

pub fn add_sensor(
    text: Option<&str>,
    name: &str,
    settings: &[(String, Scalar)],
) -> Result<String, String> {
    let text = text.unwrap_or("");
    let eol = eol_of(text);
    let lines = lines_of(text);
    let block = find_sensors(&lines)?;

    if let Some(block) = &block {
        if entry_range(&lines, block, name).is_some() {
            return Err(format!("{name} is already registered"));
        }
    }

    let unit = block
        .as_ref()
        .and_then(|block| block.child_indent)
        .unwrap_or(2);
    let mut entry = format!("{}{name}:", " ".repeat(unit));

    if settings.is_empty() {
        entry.push_str(" {}");
        entry.push_str(eol);
    } else {
        entry.push_str(eol);

        for (key, value) in settings {
            entry.push_str(&format!(
                "{}{key}: {}{eol}",
                " ".repeat(unit * 2),
                value.literal()
            ));
        }
    }

    let Some(block) = block else {
        return Ok(format!("{}sensors:{eol}{entry}", with_eol(text, eol)));
    };

    let key = &lines[block.key_line];
    let key_content = body(key.text);
    let at = block.last_child.unwrap_or(block.key_line) + 1;
    let mut out = String::new();

    for (index, line) in lines.iter().enumerate() {
        if index == block.key_line && block.last_child.is_none() {
            let rewritten = match key_content.find("{}") {
                Some(brace) => format!(
                    "{}{}",
                    key_content[..brace].trim_end(),
                    &key_content[brace + 2..]
                ),
                None => key_content.to_string(),
            };
            let ending = &key.text[key_content.len()..];

            out.push_str(&rewritten);
            out.push_str(if ending.is_empty() { eol } else { ending });

            continue;
        }

        if index == at {
            out.push_str(&entry);
        }

        out.push_str(&if index + 1 == at {
            with_eol(line.text, eol)
        } else {
            line.text.to_string()
        });
    }

    if at >= lines.len() {
        out.push_str(&entry);
    }

    Ok(out)
}

pub fn remove_sensor(text: &str, name: &str) -> Result<String, String> {
    if name == "structure" {
        return Err("structure is built in and cannot be removed".to_string());
    }

    let lines = lines_of(text);
    let not_registered = || format!("{name} is not registered");
    let block = find_sensors(&lines)?.ok_or_else(not_registered)?;
    let (start, end) = entry_range(&lines, &block, name).ok_or_else(not_registered)?;
    let remaining = (block.key_line + 1..=block.last_child.unwrap_or(block.key_line))
        .any(|index| !lines[index].blank && (index < start || index > end));
    let drop_key = !remaining;
    let mut out = String::new();

    for (index, line) in lines.iter().enumerate() {
        let removed = (start..=end).contains(&index) || (drop_key && index == block.key_line);

        if !removed {
            out.push_str(line.text);
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn duplication() -> Vec<(String, Scalar)> {
        vec![
            ("threshold".into(), Scalar::Number("0.82".into())),
            ("min_lines".into(), Scalar::Number("4".into())),
            ("min_nodes".into(), Scalar::Number("20".into())),
            ("strict".into(), Scalar::Bool(true)),
            ("label".into(), Scalar::Text("a \"b\"".into())),
        ]
    }

    fn added(text: Option<&str>) -> String {
        add_sensor(text, "duplication", &duplication()).unwrap()
    }

    fn round_trip(text: &str) {
        assert_eq!(
            remove_sensor(&added(Some(text)), "duplication").unwrap(),
            text
        );
    }

    #[test]
    fn no_file_gets_sensors_and_the_entry_and_removing_it_leaves_nothing() {
        let out = added(None);

        assert_eq!(
            out,
            "sensors:\n  duplication:\n    threshold: 0.82\n    min_lines: 4\n    min_nodes: 20\n    strict: true\n    label: \"a \\\"b\\\"\"\n"
        );
        assert_eq!(remove_sensor(&out, "duplication").unwrap(), "");
        assert_eq!(added(Some("")), out);
    }

    #[test]
    fn a_describer_config_with_comments_round_trips() {
        round_trip("# my config\ndescriber:\n  command: [x]\n\n# end\n");
    }

    #[test]
    fn a_block_with_a_third_party_sensor_and_a_trailing_comment_round_trips() {
        let text = "describer: x\nsensors:\n  mine:\n    command: [a, b]\n  # trailing\nother: 1\n";
        let out = added(Some(text));

        assert!(out.contains("    command: [a, b]\n  duplication:\n    threshold: 0.82\n"));
        assert!(out.contains("  # trailing\nother: 1\n"));
        round_trip(text);
    }

    #[test]
    fn a_block_with_four_space_children_indents_the_entry_to_match() {
        let text = "sensors:\n    mine:\n        command: [a]\n";
        let out = added(Some(text));

        assert!(out.contains("\n    duplication:\n        threshold: 0.82\n"));
        round_trip(text);
    }

    #[test]
    fn an_empty_flow_mapping_is_replaced_by_the_block_form() {
        let out = added(Some("a: 1\nsensors: {}\nb: 2\n"));

        assert!(out.starts_with("a: 1\nsensors:\n  duplication:\n    threshold: 0.82\n"));
        assert!(out.ends_with("b: 2\n"));
        assert_eq!(remove_sensor(&out, "duplication").unwrap(), "a: 1\nb: 2\n");
    }

    #[test]
    fn crlf_text_gets_crlf_lines_and_round_trips() {
        let text = "describer: x\r\nsensors:\r\n  mine:\r\n    command: [a]\r\n";
        let out = added(Some(text));

        assert!(!out.replace("\r\n", "").contains('\n'));
        round_trip(text);
        round_trip("describer: x\r\n");
    }

    #[test]
    fn a_file_without_a_trailing_newline_gets_one_before_the_entry() {
        assert!(added(Some("a: 1")).starts_with("a: 1\nsensors:\n"));
    }

    #[test]
    fn an_existing_name_a_tab_indented_block_and_a_flow_mapping_are_refused() {
        let existing = "sensors:\n  duplication: {}\n";

        assert_eq!(
            add_sensor(Some(existing), "duplication", &[]),
            Err("duplication is already registered".to_string())
        );
        assert!(
            add_sensor(Some("sensors:\n\tmine: {}\n"), "duplication", &[])
                .unwrap_err()
                .contains("line 2")
        );
        assert!(add_sensor(Some("sensors: {a: 1}\n"), "duplication", &[])
            .unwrap_err()
            .contains("line 1"));
    }

    #[test]
    fn remove_refuses_a_missing_name_and_structure() {
        assert_eq!(
            remove_sensor("a: 1\n", "duplication"),
            Err("duplication is not registered".to_string())
        );
        assert_eq!(
            remove_sensor("sensors:\n  mine: {}\n", "duplication"),
            Err("duplication is not registered".to_string())
        );
        assert!(remove_sensor(
            "sensors:\n  structure:\n    hub_threshold: 3\n",
            "structure"
        )
        .is_err());
    }

    #[test]
    fn remove_keeps_comments_around_the_entry_and_the_other_children() {
        let text =
            "sensors:\n  # above\n  duplication:\n    threshold: 0.9\n  # below\n  mine: {}\n";

        assert_eq!(
            remove_sensor(text, "duplication").unwrap(),
            "sensors:\n  # above\n  # below\n  mine: {}\n"
        );
    }

    #[test]
    fn removing_the_last_child_deletes_the_sensors_line() {
        assert_eq!(
            remove_sensor("a: 1\nsensors:\n  duplication: {}\nb: 2\n", "duplication").unwrap(),
            "a: 1\nb: 2\n"
        );
    }

    #[test]
    fn a_value_that_is_not_a_scalar_is_refused() {
        assert!(Scalar::from_json(&serde_json::json!({"a": 1})).is_err());
        assert!(Scalar::from_json(&serde_json::json!([1])).is_err());
        assert_eq!(
            Scalar::from_json(&serde_json::json!(0.82)),
            Ok(Scalar::Number("0.82".into()))
        );
    }

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(name);

        std::fs::read_to_string(path).unwrap()
    }

    pub(crate) fn listed_defaults() -> Vec<(String, Scalar)> {
        let list: serde_json::Value = serde_json::from_str(&fixture("sensors/list.json")).unwrap();

        list[0]["defaults"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| (key.clone(), Scalar::from_json(value).unwrap()))
            .collect()
    }

    #[test]
    fn the_shared_fixtures_add_to_exactly_the_text_typescript_parses() {
        let defaults = listed_defaults();

        for shape in ["describer", "third-party", "empty-flow", "four-space"] {
            let input = fixture(&format!("config-edit/{shape}.yaml"));
            let expected = fixture(&format!("config-edit/{shape}.added.yaml"));

            assert_eq!(
                add_sensor(Some(&input), "duplication", &defaults).unwrap(),
                expected,
                "{shape}"
            );
        }
    }

    #[test]
    fn the_listed_defaults_keep_the_order_the_list_gives() {
        let keys: Vec<String> = listed_defaults().into_iter().map(|(key, _)| key).collect();

        assert_eq!(keys, ["threshold", "min_lines", "min_nodes"]);
    }
}
