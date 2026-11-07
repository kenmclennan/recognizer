package m

fun describe(value: Any): String =
    when (value) {
        is String if value.isNotEmpty() -> shout(value)
        else -> "other"
    }
