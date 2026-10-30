from conftest import call_tuples, member, targets

REPO = "package p\n\ninterface Repo {\n    fun save(x: Int)\n    fun find(): Repo\n}\n"


def caller(body: str) -> str:
    return (
        "package q\n\nimport p.Repo\n\n"
        f"class U(private val repo: Repo) {{\n    fun go() {{\n        {body}\n    }}\n}}\n"
    )


def test_a_receiver_with_a_declared_type_resolves(run):
    document = run({"a/Repo.kt": REPO, "c/U.kt": caller("repo.save(1)")})

    assert call_tuples(document) == [("c::U.go", "a::Repo.save", "call")]


def test_a_call_through_a_local_value_is_not_resolved(run):
    document = run({"a/Repo.kt": REPO, "c/U.kt": caller("val r = repo\n        r.save(1)")})

    assert document["calls"] == []


def test_a_call_through_a_chain_is_not_resolved(run):
    document = run({"a/Repo.kt": REPO, "c/U.kt": caller("repo.find().save(1)")})

    assert call_tuples(document) == [("c::U.go", "a::Repo.find", "call")]


def test_a_local_named_like_an_imported_class_still_counts_as_a_use(run):
    document = run(
        {
            "a/X.kt": "package p\n\nclass X\n",
            "c/U.kt": "package q\n\nimport p.X\n\nfun go() {\n    val X = 1\n}\n",
        }
    )

    assert targets(document, "c") == {"a": ["X"]}


def test_returns_is_present_with_a_declared_type_and_absent_for_an_expression_body(run):
    document = run({"a/F.kt": "package p\n\nfun declared(): Int = 1\n\nfun inferred() = 1\n"})

    assert member(document, "a", "declared")["returns"] == "Int"
    assert "returns" not in member(document, "a", "inferred")


def test_a_factory_made_bean_gives_the_consumer_no_edge_to_the_factory(run):
    document = run(
        {
            "a/Port.kt": "package p\n\ninterface Port\n",
            "f/Factory.kt": (
                "package f\n\nimport p.Port\n\n@Factory\nclass Factory {\n"
                "    @Singleton\n    fun port(): Port = object : Port {}\n}\n"
            ),
            "c/U.kt": "package q\n\nimport p.Port\n\nclass U(private val port: Port)\n",
        }
    )

    assert "f" not in targets(document, "c")
    assert "c" not in targets(document, "f")


def test_two_implementations_of_one_port_are_both_dispatched_to(run):
    document = run(
        {
            "a/Port.kt": "package p\n\ninterface Port {\n    fun go()\n}\n",
            "b/One.kt": "package p\n\nclass One : Port {\n    override fun go() {}\n}\n",
            "c/Two.kt": "package p\n\nclass Two : Port {\n    override fun go() {}\n}\n",
        }
    )

    assert [c["to"] for c in document["calls"]] == ["b::One.go", "c::Two.go"]


def test_a_java_declared_class_stays_foreign_and_the_java_file_is_not_read(run):
    document = run(
        {
            "j/Legacy.java": "package p;\n\npublic class Legacy {}\n",
            "c/U.kt": "package q\n\nimport p.Legacy\n\nclass U(val l: Legacy)\n",
        }
    )

    assert targets(document, "c") == {"foreign:p": []}
    assert [f["path"] for f in document["files"]] == ["c/U.kt"]


def test_a_kotlin_script_file_is_not_read(run):
    document = run({"build.gradle.kts": "val x = 1\n", "a/A.kt": "class A\n"})

    assert [f["path"] for f in document["files"]] == ["a/A.kt"]
