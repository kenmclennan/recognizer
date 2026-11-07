package demo

fun guard(x: Any) {
    when (x) {
        is String if x.isNotEmpty() -> shout(x)
        else -> Unit
    }
}
