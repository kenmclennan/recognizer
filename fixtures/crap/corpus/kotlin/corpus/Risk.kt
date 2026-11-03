package corpus

fun straight(a: Int): Int {
    val b = a + 1
    return b
}

fun oneIf(a: Boolean): Int {
    if (a) {
        return 1
    }
    return 0
}

fun ifElse(a: Int): String {
    if (a == 1) {
        return "one"
    } else if (a == 2) {
        return "two"
    }
    return "many"
}

fun loops(xs: List<Int>, a: Int): Int {
    var total = 0
    var n = a
    for (x in xs) {
        total += x
    }
    while (n > 0) {
        n -= 1
    }
    do {
        total += 1
    } while (total < 3)
    return total
}

fun whenThree(v: Int, a: Boolean): String {
    var r = ""
    when (v) {
        1 -> r = "a"
        2 -> r = "b"
        else -> r = "c"
    }
    if (a) {
        r += "!"
    }
    return r
}

fun tryCatch(xs: List<String>, a: Boolean, b: Boolean): Int {
    var total = 0
    try {
        total = xs.size / xs.size
    } catch (e: ArithmeticException) {
        total = 0
    } catch (e: IllegalStateException) {
        total = -1
    }
    for (x in xs) {
        total += x.length
    }
    if (total > 10) {
        total = 10
    }
    val both = a && b
    return total
}

fun booleans(a: Boolean, b: Boolean, c: Boolean, xs: List<Int>): Int {
    var x = 0
    if (a && b || c) {
        x = 1
    }
    var p = a
    while (p || b) {
        p = false
    }
    for (y in xs) {
        x += y
    }
    return x
}

fun mixed(v: Int, a: Boolean, b: Boolean, xs: List<Int>): Int {
    var r = 0
    when (v) {
        1 -> r = 1
        2 -> r = 2
        3 -> r = 3
        else -> r = 4
    }
    if (a) {
        r += 1
    } else if (b) {
        r += 2
    }
    for (x in xs) {
        r += x
    }
    return r
}

fun nested(v: Int, a: Boolean, xs: List<Int>): Int {
    var r = 0
    for (x in xs) {
        r += x
    }
    var n = v
    while (n > 0) {
        n -= 1
    }
    do {
        r += 1
    } while (r < 3)
    when (v) {
        1 -> r = 1
        2 -> r = 2
        else -> r = 3
    }
    try {
        r /= v
    } catch (e: ArithmeticException) {
        r = 0
    }
    if (a) {
        r += 1
    }
    return r
}

fun classify(n: Int, a: Boolean, b: Boolean, c: Boolean, d: Boolean, xs: List<String>): String {
    var label = ""
    if (n < 0) {
        label = "neg"
    } else if (n == 0) {
        label = "zero"
    } else if (n < 10) {
        label = "small"
    } else if (n < 100) {
        label = "medium"
    }
    val ok = a || b || c && d
    for (x in xs) {
        label += x
    }
    try {
        label += (100 / n).toString()
    } catch (e: ArithmeticException) {
        label = ""
    }
    return label
}

fun wide(v: Int, a: Boolean, b: Boolean, xs: List<Int>): Int {
    var r = 0
    when (v) {
        1 -> r = 1
        2 -> r = 2
        3 -> r = 3
        4 -> r = 4
        else -> r = 5
    }
    if (a) {
        r += 1
    } else if (b) {
        r += 2
    } else if (r > 3) {
        r += 3
    }
    for (x in xs) {
        r += x
    }
    var n = r
    while (n > 100) {
        n -= 100
    }
    return n
}

fun sprawl(n: Int, v: Int, a: Boolean, b: Boolean, xs: List<Int>): Int {
    var label = 0
    if (n < 0) {
        label = 0
    } else if (n == 0) {
        label = 1
    } else if (n < 10) {
        label = 2
    } else if (n < 100) {
        label = 3
    } else if (n < 1000) {
        label = 4
    } else if (n < 10000) {
        label = 5
    }
    do {
        label += 1
    } while (label < 3)
    when (v) {
        1 -> label += 1
        else -> label += 2
    }
    val ok = a && b
    try {
        label /= n
    } catch (e: ArithmeticException) {
        label = 0
    }
    return label
}
