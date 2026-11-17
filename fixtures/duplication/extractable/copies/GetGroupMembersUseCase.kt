class GetGroupMembersUseCase(private val repo: Repository) {
    fun execute(group: String): List<String> {
        val labels = mutableListOf<String>()
        for (member in repo.members(group)) {
            if (member.visible && !labels.contains(member.label)) {
                labels.add(member.label)
            }
        }
        labels.sort()
        return labels
    }

    fun count(group: String): Int {
        var total = 0
        var hidden = 0
        for (member in repo.members(group)) {
            if (member.visible) {
                total += 1
            } else {
                hidden += 1
            }
        }
        log(total + hidden)
        return total
    }
}
