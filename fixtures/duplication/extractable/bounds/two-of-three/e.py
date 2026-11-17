def read_config(path):
    with open(path) as handle:
        text = handle.read()
    values = {}
    for row in text.splitlines():
        key, _, value = row.partition("=")
        values[key.strip()] = value.strip()
    return values


def render_table(rows, widths):
    lines = []
    for index, row in enumerate(rows):
        cells = [str(cell).ljust(widths[position]) for position, cell in enumerate(row)]
        lines.append(" | ".join(cells))
    return "\n".join(lines)


def merge_sorted(left, right):
    merged = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
    return merged + left[i:] + right[j:]
