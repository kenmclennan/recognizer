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


def walk_tree(node, visit):
    stack = [node]
    while stack:
        current = stack.pop()
        visit(current)
        stack.extend(reversed(current.children))
    return len(stack)


def clamp_range(low, high, value):
    if low > high:
        low, high = high, low
    if value < low:
        return low
    if value > high:
        return high
    return value


def parse_flags(argv):
    flags = set()
    rest = []
    for token in argv:
        if token.startswith("--"):
            flags.add(token[2:])
        else:
            rest.append(token)
    return flags, rest


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
