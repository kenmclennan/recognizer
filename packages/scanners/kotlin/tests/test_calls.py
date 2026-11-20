from conftest import call_tuples, edges_of

PORT = "package p\n\ninterface Port {\n    fun save(x: Int)\n}\n"


def test_a_constructor_parameter_receiver_resolves_to_the_declared_method(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "c/U.kt": "package q\n\nimport p.Port\n\nclass U(private val port: Port) {\n    fun go() {\n        port.save(1)\n    }\n}\n",
        }
    )

    assert ("c/U.kt::U.go", "a/Port.kt::Port.save", "call") in call_tuples(document)


def test_a_property_receiver_resolves_to_the_declared_method(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "c/U.kt": "package q\n\nimport p.Port\n\nclass U {\n    private val port: Port? = null\n\n    fun go() {\n        port?.save(1)\n    }\n}\n",
        }
    )

    assert ("c/U.kt::U.go", "a/Port.kt::Port.save", "call") in call_tuples(document)


def test_a_call_to_a_top_level_function_resolves_by_name(run):
    document = run(
        {
            "a/F.kt": "package p\n\nfun helper() = 1\n",
            "c/U.kt": "package q\n\nimport p.helper\n\nfun go() {\n    helper()\n}\n",
        }
    )

    assert call_tuples(document) == [("c/U.kt::go", "a/F.kt::helper", "call")]


def test_a_constructor_call_of_a_scanned_class_is_a_construct(run):
    document = run(
        {
            "a/X.kt": "package p\n\nclass X\n",
            "c/U.kt": "package q\n\nimport p.X\n\nfun go() {\n    X()\n}\n",
        }
    )

    assert call_tuples(document) == [("c/U.kt::go", "a/X.kt::X", "construct")]


def test_an_object_member_is_called_through_the_object_name(run):
    document = run(
        {
            "a/O.kt": "package p\n\nobject O {\n    fun f() = 1\n}\n",
            "c/U.kt": "package q\n\nimport p.O\n\nfun go() {\n    O.f()\n}\n",
        }
    )

    assert call_tuples(document) == [("c/U.kt::go", "a/O.kt::O.f", "call")]


def test_a_companion_member_is_called_through_the_class_name(run):
    document = run(
        {
            "a/X.kt": "package p\n\nclass X {\n    companion object {\n        fun make() = 1\n    }\n}\n",
            "c/U.kt": "package q\n\nimport p.X\n\nfun go() {\n    X.make()\n}\n",
        }
    )

    assert call_tuples(document) == [("c/U.kt::go", "a/X.kt::X.Companion.make", "call")]


def test_an_inherited_method_resolves_to_the_supertype_that_declares_it(run):
    document = run(
        {
            "a/Base.kt": "package p\n\nopen class Base {\n    fun hello() = 1\n}\n",
            "c/U.kt": "package q\n\nimport p.Base\n\nclass Child : Base()\n\nclass U(private val c: Child) {\n    fun go() {\n        c.hello()\n    }\n}\n",
        }
    )

    assert ("c/U.kt::U.go", "a/Base.kt::Base.hello", "call") in call_tuples(document)


def test_an_interface_method_dispatches_to_each_implementation(run):
    document = run(
        {
            "a/Port.kt": PORT,
            "b/One.kt": "package r\n\nimport p.Port\n\nclass One : Port {\n    override fun save(x: Int) {}\n}\n",
            "c/Two.kt": "package q\n\nimport p.Port\n\nclass Two : Port {\n    override fun save(x: Int) {}\n}\n",
        }
    )

    assert call_tuples(document) == [
        ("a/Port.kt::Port.save", "b/One.kt::One.save", "dispatch"),
        ("a/Port.kt::Port.save", "c/Two.kt::Two.save", "dispatch"),
    ]


def test_a_method_a_data_repository_inherits_resolves_to_the_interface_itself(run):
    document = run(
        {
            "a/Repo.kt": "package p\n\nimport io.micronaut.data.repository.CrudRepository\n\ninterface Repo : CrudRepository<String, Long>\n",
            "c/U.kt": 'package q\n\nimport p.Repo\n\nclass U(private val repo: Repo) {\n    fun go() {\n        repo.save("")\n    }\n}\n',
        }
    )

    assert call_tuples(document) == [("c/U.kt::U.go", "a/Repo.kt::Repo", "call")]


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
    assert edges_of(document, "c/U.kt")[0]["to"] == "foreign:z"


def own(document):
    return [(f, t) for f, t, how in call_tuples(document) if how == "call"]


def test_a_constant_read_in_each_kind_of_scope_records_a_call(run):
    source = (
        "package p\n\nconst val LIMIT = 1\n\n"
        "fun a() = LIMIT\n\n"
        "val b = LIMIT\n\n"
        "val c = listOf(1).map { it + LIMIT }\n\n"
        "fun d() {\n    fun inner() = LIMIT\n    inner()\n}\n\n"
        "class E {\n    val x = LIMIT\n}\n"
    )

    document = run({"a/K.kt": source})

    assert own(document) == [
        ("a/K.kt::E", "a/K.kt::LIMIT"),
        ("a/K.kt::a", "a/K.kt::LIMIT"),
        ("a/K.kt::b", "a/K.kt::LIMIT"),
        ("a/K.kt::c", "a/K.kt::LIMIT"),
        ("a/K.kt::d", "a/K.kt::LIMIT"),
    ]


def test_a_method_body_use_is_attributed_to_the_method(run):
    document = run(
        {"a/K.kt": "package p\n\nconst val LIMIT = 1\n\nclass E {\n    fun go() = LIMIT\n}\n"}
    )

    assert own(document) == [("a/K.kt::E.go", "a/K.kt::LIMIT")]


def test_a_type_reference_to_a_same_file_type_records_a_call(run):
    source = (
        "package p\n\ninterface Base\n\nclass Sub : Base\n\n"
        "fun take(x: Base) {}\n\nfun Base.ext() {}\n"
    )

    document = run({"a/K.kt": source})

    assert own(document) == [
        ("a/K.kt::Sub", "a/K.kt::Base"),
        ("a/K.kt::ext", "a/K.kt::Base"),
        ("a/K.kt::take", "a/K.kt::Base"),
    ]


def test_an_extension_call_by_name_records_a_call_and_a_member_access_does_not(run):
    source = (
        "package p\n\nconst val CONST = 1\n\nfun String.ext() = 1\n\n"
        'fun go(o: Other) {\n    "s".ext()\n    o.CONST\n}\n\nclass Other\n'
    )

    document = run({"a/K.kt": source})

    assert ("a/K.kt::go", "a/K.kt::ext") in own(document)
    assert ("a/K.kt::go", "a/K.kt::CONST") not in own(document)


def test_a_shadowed_name_records_nothing(run):
    source = (
        "package p\n\nconst val X = 1\n\n"
        "fun a(X: Int) = X\n\n"
        "fun b() {\n    val X = 2\n    println(X)\n}\n\n"
        "fun c() = listOf(1).map { X -> X }\n\n"
        "fun d() {\n    for (X in listOf(1)) println(X)\n}\n\n"
        "fun e() {\n    try {\n    } catch (X: Exception) {\n        println(X)\n    }\n}\n"
    )

    document = run({"a/K.kt": source})

    assert own(document) == []


def test_a_named_argument_label_records_nothing(run):
    source = (
        "package p\n\nconst val name = 1\n\nfun f(name: Int) = name\n\nfun go() = f(name = 2)\n"
    )

    document = run({"a/K.kt": source})

    assert ("a/K.kt::go", "a/K.kt::name") not in own(document)


def test_a_recursive_call_and_a_class_using_its_own_name_record_nothing(run):
    source = "package p\n\nfun r(n: Int): Int = if (n > 0) r(n - 1) else 0\n\nclass C {\n    fun copy(): C = C()\n}\n"

    document = run({"a/K.kt": source})

    assert own(document) == []


def test_only_the_used_member_of_a_file_gets_a_call(run):
    document = run(
        {"a/K.kt": "package p\n\nconst val USED = 1\n\nconst val IDLE = 2\n\nfun go() = USED\n"}
    )

    assert own(document) == [("a/K.kt::go", "a/K.kt::USED")]


def test_an_expect_file_records_a_call_for_its_used_member_only(run):
    document = run(
        {
            "common/Env.kt": "package p\n\nexpect val USED: Int\n\nexpect val IDLE: Int\n\nfun go() = USED\n",
            "jvm/Env.jvm.kt": "package p\n\nactual val USED: Int = 1\n\nactual val IDLE: Int = 2\n",
        }
    )

    assert own(document) == [("common/Env.kt::go", "common/Env.kt::USED")]


ACCESSOR_HEAD = "package p\n\nconst val D = 1\n\nconst val E = 2\n\n"


def accessor_calls(run, body):
    return own(run({"a/K.kt": ACCESSOR_HEAD + body}))


def test_a_next_line_getter_of_a_top_level_property_records_its_use(run):
    found = accessor_calls(run, "val lim: Long\n    get() = D\n")

    assert found == [("a/K.kt::lim", "a/K.kt::D")]


def test_an_extension_var_with_a_next_line_getter_records_its_use(run):
    found = accessor_calls(run, "var String.lim: Long\n    get() = D\n    set(v) {}\n")

    assert ("a/K.kt::lim", "a/K.kt::D") in found


def test_a_block_bodied_next_line_getter_records_its_use(run):
    found = accessor_calls(run, "val lim: Long\n    get() {\n        return D\n    }\n")

    assert found == [("a/K.kt::lim", "a/K.kt::D")]


def test_a_next_line_setter_records_its_use(run):
    found = accessor_calls(run, "var lim: Long = 0\n    set(v) { field = v + D }\n")

    assert found == [("a/K.kt::lim", "a/K.kt::D")]


def test_a_getter_after_a_comment_line_records_its_use(run):
    found = accessor_calls(run, "val lim: Long\n    // note\n    get() = D\n")

    assert found == [("a/K.kt::lim", "a/K.kt::D")]


def test_an_annotated_getter_records_its_use(run):
    found = accessor_calls(run, 'val lim: Long\n    @JvmName("x") get() = D\n')

    assert found == [("a/K.kt::lim", "a/K.kt::D")]


def test_a_getter_and_a_setter_record_one_call_per_distinct_target(run):
    found = accessor_calls(
        run, "var lim: Long = 0\n    get() = D\n    set(v) { field = v + E + D }\n"
    )

    assert sorted(found) == [("a/K.kt::lim", "a/K.kt::D"), ("a/K.kt::lim", "a/K.kt::E")]


def test_only_the_property_with_an_accessor_records_a_call(run):
    found = accessor_calls(run, "val a: Long = 0\n\nval b: Long\n    get() = D\n")

    assert found == [("a/K.kt::b", "a/K.kt::D")]


def test_a_setter_parameter_named_like_a_constant_shadows_it(run):
    found = accessor_calls(run, "var lim: Long = 0\n    set(D) { field = D }\n")

    assert found == []


def test_a_one_line_accessor_records_exactly_one_call(run):
    found = accessor_calls(run, "val String.lim: Long get() = D\n")

    assert found == [("a/K.kt::lim", "a/K.kt::D")]
