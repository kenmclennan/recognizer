package corpus

class Limits {
    fun retryLimit(): Int {
        return settings.section("limits").entry(
            "retry-limit",
            0,
        )
    }

    fun pageSize(): Int {
        return settings.section("limits").entry(
            "page-size",
            0,
        )
    }

    fun queueDepth(): Int {
        return settings.section("limits").entry(
            "queue-depth",
            0,
        )
    }

    fun idleTimeout(): Int {
        return settings.section("limits").entry(
            "idle-timeout",
            0,
        )
    }
}
