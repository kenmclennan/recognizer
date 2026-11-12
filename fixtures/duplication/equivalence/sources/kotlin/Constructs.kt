class Store {
    fun get(key: String): Int {
        val found = items[key]

        if (found == null) {
            throw IllegalStateException(key)
        }

        return found
    }

    fun get(key: String, fallback: Int): Int {
        return items[key] ?: fallback
    }

    companion object {
        fun create(): Store {
            return Store()
        }
    }
}

object Registry {
    fun register(name: String) {
        names.add(name)
    }
}

fun helper(values: List<Int>): List<Int> {
    return values.map { it * 2 }
}
