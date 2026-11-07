package m

interface Logger {
    fun info(message: String)
}

context(logger: Logger)
fun report(message: String) {
    logger.info(message)
}

class Service {
    context(logger: Logger)
    fun run() {
        report("run")
    }
}
