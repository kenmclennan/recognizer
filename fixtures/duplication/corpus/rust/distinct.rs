pub fn read_config(path: &Path) -> HashMap<String, String> {
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut values = HashMap::new();
    for row in text.lines() {
        if let Some((key, value)) = row.split_once('=') {
            values.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    values
}

pub fn render_table(rows: &[Vec<String>], widths: &[usize]) -> String {
    let mut lines = Vec::new();
    for row in rows {
        let cells: Vec<String> = row
            .iter()
            .enumerate()
            .map(|(position, cell)| format!("{:<width$}", cell, width = widths[position]))
            .collect();
        lines.push(cells.join(" | "));
    }
    lines.join("\n")
}

pub fn walk_tree(node: &TreeNode, visit: &mut dyn FnMut(&TreeNode)) -> usize {
    let mut stack = vec![node];
    let mut visited = 0;
    while let Some(current) = stack.pop() {
        visit(current);
        visited += 1;
        stack.extend(current.children.iter().rev());
    }
    visited
}

pub fn clamp_range(low: i64, high: i64, value: i64) -> i64 {
    let lower = low.min(high);
    let upper = low.max(high);
    match value {
        v if v < lower => lower,
        v if v > upper => upper,
        v => v,
    }
}

pub fn parse_flags(argv: &[String]) -> (HashSet<String>, Vec<String>) {
    let mut flags = HashSet::new();
    let mut rest = Vec::new();
    for token in argv {
        match token.strip_prefix("--") {
            Some(flag) => {
                flags.insert(flag.to_string());
            }
            None => rest.push(token.clone()),
        }
    }
    (flags, rest)
}

pub fn merge_sorted(left: &[i64], right: &[i64]) -> Vec<i64> {
    let mut merged = Vec::with_capacity(left.len() + right.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        if left[i] <= right[j] {
            merged.push(left[i]);
            i += 1;
        } else {
            merged.push(right[j]);
            j += 1;
        }
    }
    merged.extend_from_slice(&left[i..]);
    merged.extend_from_slice(&right[j..]);
    merged
}
