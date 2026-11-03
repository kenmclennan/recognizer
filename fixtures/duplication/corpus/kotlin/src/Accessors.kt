package corpus

class Limits {
    fun retryLimit(): Int {
        val env = envInt("APP_RETRY_LIMIT")
        if (env != null) {
            return env
        }
        return requiredInt("retry-limit")
    }

    fun pageSize(): Int {
        val env = envInt("APP_PAGE_SIZE")
        if (env != null) {
            return env
        }
        return requiredInt("page-size")
    }

    fun queueDepth(): Int {
        val env = envInt("APP_QUEUE_DEPTH")
        if (env != null) {
            return env
        }
        return requiredInt("queue-depth")
    }

    fun idleTimeout(): Int {
        val env = envInt("APP_IDLE_TIMEOUT")
        if (env != null) {
            return env
        }
        return requiredInt("idle-timeout")
    }
}
