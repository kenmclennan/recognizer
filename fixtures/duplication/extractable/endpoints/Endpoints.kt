class GroupController {
    @Get("/members")
    fun members(
        @PathVariable id: String,
        @Parameter(description = "page number") @QueryValue page: Int,
        @Parameter(description = "page size") @QueryValue size: Int,
        @Parameter(description = "sort key") @QueryValue sort: String,
        @Parameter(description = "sort order") @QueryValue order: String,
        @Parameter(description = "filter text") @QueryValue filter: String,
    ): HttpResponse<Page> {
        return HttpResponse.ok(groups.listMembers(id, page, size, sort, order, filter))
    }

    @Get("/owners")
    fun owners(
        @PathVariable id: String,
        @Parameter(description = "page number") @QueryValue page: Int,
        @Parameter(description = "page size") @QueryValue size: Int,
        @Parameter(description = "sort key") @QueryValue sort: String,
        @Parameter(description = "sort order") @QueryValue order: String,
        @Parameter(description = "filter text") @QueryValue filter: String,
    ): HttpResponse<Page> {
        return HttpResponse.ok(users.listOwners(id, page, size, sort, order, filter))
    }
}
