package demo

class GetUserUseCase : GetUserPort {
    override fun get(id: String) = id
}
