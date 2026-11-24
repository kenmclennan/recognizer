package p

class LoggingDispatcher(private val inner: Dispatcher) : Dispatcher {
    override fun dispatch(event: String) = inner.dispatch(event)
}
