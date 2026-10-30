from conftest import call_tuples, edges_of

PORT = "package p\n\ninterface Port {\n    fun save(x: Int)\n}\n"


def test_a_constructor_parameter_receiver_resolves_to_the_declared_method(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "c/U.kt": "package q\n\nimport p.Port\n\nclass U(private val port: Port) {\n    fun go() {\n        port.save(1)\n    }\n}\n",
        }
    )

    assert ("c::U.go", "a::Port.save", "call") in call_tuples(document)


def test_a_property_receiver_resolves_to_the_declared_method(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "c/U.kt": "package q\n\nimport p.Port\n\nclass U {\n    private val port: Port? = null\n\n    fun go() {\n        port?.save(1)\n    }\n}\n",
        }
    )

    assert ("c::U.go", "a::Port.save", "call") in call_tuples(document)


def test_a_call_to_a_top_level_function_resolves_by_name(run):
    document = run(
        {
            "a/F.kt": "package p\n\nfun helper() = 1\n",
            "c/U.kt": "package q\n\nimport p.helper\n\nfun go() {\n    helper()\n}\n",
        }
    )

    assert call_tuples(document) == [("c::go", "a::helper", "call")]


def test_a_constructor_call_of_a_scanned_class_is_a_construct(run):
    document = run(
        {
            "a/X.kt": "package p\n\nclass X\n",
            "c/U.kt": "package q\n\nimport p.X\n\nfun go() {\n    X()\n}\n",
        }
    )

    assert call_tuples(document) == [("c::go", "a::X", "construct")]


def test_an_object_member_is_called_through_the_object_name(run):
    document = run(
        {
            "a/O.kt": "package p\n\nobject O {\n    fun f() = 1\n}\n",
            "c/U.kt": "package q\n\nimport p.O\n\nfun go() {\n    O.f()\n}\n",
        }
    )

    assert call_tuples(document) == [("c::go", "a::O.f", "call")]


def test_a_companion_member_is_called_through_the_class_name(run):
    document = run(
        {
            "a/X.kt": "package p\n\nclass X {\n    companion object {\n        fun make() = 1\n    }\n}\n",
            "c/U.kt": "package q\n\nimport p.X\n\nfun go() {\n    X.make()\n}\n",
        }
    )

    assert call_tuples(document) == [("c::go", "a::X.Companion.make", "call")]


def test_an_inherited_method_resolves_to_the_supertype_that_declares_it(run):
    document = run(
        {
            "a/Base.kt": "package p\n\nopen class Base {\n    fun hello() = 1\n}\n",
            "c/U.kt": "package q\n\nimport p.Base\n\nclass Child : Base()\n\nclass U(private val c: Child) {\n    fun go() {\n        c.hello()\n    }\n}\n",
        }
    )

    assert ("c::U.go", "a::Base.hello", "call") in call_tuples(document)


def test_an_interface_method_dispatches_to_each_implementation(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "b/One.kt": "package r\n\nimport p.Port\n\nclass One : Port {\n    override fun save(x: Int) {}\n}\n",
            "c/Two.kt": "package q\n\nimport p.Port\n\nclass Two : Port {\n    override fun save(x: Int) {}\n}\n",
        }
    )

    assert call_tuples(document) == [
        ("a::Port.save", "b::One.save", "dispatch"),
        ("a::Port.save", "c::Two.save", "dispatch"),
    ]


def test_a_method_a_data_repository_inherits_resolves_to_the_interface_itself(run):
    document = run(
        {
            "a/Repo.kt": "package p\n\nimport io.micronaut.data.repository.CrudRepository\n\ninterface Repo : CrudRepository<String, Long>\n",
            "c/U.kt": 'package q\n\nimport p.Repo\n\nclass U(private val repo: Repo) {\n    fun go() {\n        repo.save("")\n    }\n}\n',
        }
    )

    assert call_tuples(document) == [("c::U.go", "a::Repo", "call")]


def test_a_call_in_a_class_body_outside_a_function_has_no_caller(run):
    document = run(
        {
            "a/F.kt": "package p\n\nfun helper() = 1\n",
            "c/U.kt": "package q\n\nimport p.helper\n\nclass U {\n    val x = helper()\n}\n",
        }
    )

    assert document["calls"] == []


def test_a_call_in_an_annotation_has_no_caller(run):
    document = run(
        {
            "a/F.kt": "package p\n\nfun helper() = 1\n",
            "c/U.kt": "package q\n\nimport p.helper\n\n@Anno(helper())\nclass U\n",
        }
    )

    assert document["calls"] == []


def test_a_call_whose_far_end_is_not_a_member_is_dropped(run):
    document = run(
        {
            "c/U.kt": "package q\n\nimport z.helper\n\nfun go() {\n    helper()\n}\n",
        }
    )

    assert document["calls"] == []
    assert edges_of(document, "c")[0]["to"] == "foreign:z"
