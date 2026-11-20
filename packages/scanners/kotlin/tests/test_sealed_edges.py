from conftest import edges_of, member

EVENT = """package p

import com.fasterxml.jackson.annotation.JsonSubTypes

@JsonSubTypes(
    JsonSubTypes.Type(Created::class),
    JsonSubTypes.Type(Deleted::class),
)
sealed interface Event
"""


def sample(run) -> dict:
    return run(
        {
            "p/Event.kt": EVENT,
            "p/Created.kt": "package p\n\ndata class Created(val id: Int) : Event\n",
            "p/Deleted.kt": "package p\n\ndata class Deleted(val id: Int) : Event\n",
        }
    )


def test_the_base_is_tagged_sealed(run):
    assert member(sample(run), "p/Event.kt", "Event")["tags"] == ["sealed"]


def test_each_subtype_implements_the_base_by_name(run):
    document = sample(run)

    for subtype in ("Created", "Deleted"):
        found = [
            e
            for e in edges_of(document, f"p/{subtype}.kt", "implements")
            if e["to"] == "p/Event.kt"
        ]

        assert [e["to_member"] for e in found] == ["Event"]
        assert [e["member"] for e in found] == [subtype]
