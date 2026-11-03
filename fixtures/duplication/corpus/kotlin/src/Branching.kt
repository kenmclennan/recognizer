package corpus

class Budgets {
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
}
