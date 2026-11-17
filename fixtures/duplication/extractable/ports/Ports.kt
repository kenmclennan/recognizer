interface ProvisioningEventDispatcher {
    fun dispatch(
        @Parameter(description = "event name") name: String,
        @Parameter(description = "payload") payload: String,
        @Parameter(description = "target") target: String,
    ): Result
}

interface GetGroupPort {
    fun execute(
        @Parameter(description = "group id") id: String,
        @Parameter(description = "page") page: Int,
        @Parameter(description = "size") size: Int,
    ): Result
}

interface GetUserPort {
    fun execute(
        @Parameter(description = "user id") id: String,
        @Parameter(description = "page") page: Int,
        @Parameter(description = "size") size: Int,
    ): Result
}
