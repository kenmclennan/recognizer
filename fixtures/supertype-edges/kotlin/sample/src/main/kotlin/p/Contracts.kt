package p

interface Dispatcher {
    fun dispatch(event: String)
}

open class Base
