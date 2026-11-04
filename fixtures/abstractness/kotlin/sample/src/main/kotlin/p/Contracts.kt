package p

interface Store {
    fun save()
}

fun interface Handler {
    fun handle()
}

abstract class Base {
    abstract fun run()
}
