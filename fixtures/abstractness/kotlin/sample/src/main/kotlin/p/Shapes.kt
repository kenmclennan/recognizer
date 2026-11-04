package p

typealias Id = String

typealias Ids = List<String>

data class Row(val id: String)

sealed class Shape

class Impl : Store {
    override fun save() {}
}

fun build(): Impl = Impl()

const val LIMIT = 3

enum class Color { RED }

private class Hidden
