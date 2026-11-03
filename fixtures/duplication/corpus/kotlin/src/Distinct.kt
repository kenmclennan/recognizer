package corpus

fun readConfig(path: String): Map<String, String> {
    val text = File(path).readText()
    val values = mutableMapOf<String, String>()
    for (row in text.lines()) {
        val parts = row.split("=", limit = 2)
        values[parts[0].trim()] = parts.getOrElse(1) { "" }.trim()
    }
    return values
}

fun renderTable(rows: List<List<String>>, widths: List<Int>): String {
    val lines = mutableListOf<String>()
    rows.forEach { row ->
        val cells = row.mapIndexed { position, cell -> cell.padEnd(widths[position]) }
        lines.add(cells.joinToString(" | "))
    }
    return lines.joinToString("\n")
}

fun walkTree(node: TreeNode, visit: (TreeNode) -> Unit): Int {
    val stack = ArrayDeque<TreeNode>()
    stack.addLast(node)
    while (stack.isNotEmpty()) {
        val current = stack.removeLast()
        visit(current)
        current.children.reversed().forEach { stack.addLast(it) }
    }
    return stack.size
}

fun clampRange(low: Int, high: Int, value: Int): Int {
    val lower = minOf(low, high)
    val upper = maxOf(low, high)
    return when {
        value < lower -> lower
        value > upper -> upper
        else -> value
    }
}

fun parseFlags(argv: List<String>): Pair<Set<String>, List<String>> {
    val flags = mutableSetOf<String>()
    val rest = mutableListOf<String>()
    for (token in argv) {
        if (token.startsWith("--")) {
            flags.add(token.substring(2))
        } else {
            rest.add(token)
        }
    }
    return Pair(flags, rest)
}

fun mergeSorted(left: List<Int>, right: List<Int>): List<Int> {
    val merged = mutableListOf<Int>()
    var i = 0
    var j = 0
    while (i < left.size && j < right.size) {
        if (left[i] <= right[j]) {
            merged.add(left[i++])
        } else {
            merged.add(right[j++])
        }
    }
    return merged + left.drop(i) + right.drop(j)
}
