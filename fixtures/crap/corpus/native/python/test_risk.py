from python.risk import (
    booleans,
    classify,
    comprehensions,
    guarded,
    if_elif,
    loops,
    matching,
    mixed,
    nested,
    one_if,
    sprawl,
    straight,
)


def test_small_functions():
    assert straight(1) == 2
    assert one_if(True) == 1
    assert one_if(False) == 0
    assert if_elif(1) == "one"
    assert if_elif(3) == "many"
    assert loops([1, 2], 2) == 4


def test_guarded_and_comprehensions():
    assert guarded(4, 2) == 2
    assert guarded(1, 0) == 0
    assert sorted(comprehensions([1, -1])) == [-1, 1, 1]
    assert comprehensions([]) == set()


def test_matching_and_booleans():
    assert matching(1, 0) == "a"
    assert matching(9, 3) == "c!"
    assert booleans(True, True, False, False) == 0
    assert booleans(False, False, True, True) == 1


def test_large_functions():
    assert mixed(True, False, False, [1, 2]) == (2, True, False)
    assert nested([[1, 2], []], 1) == 4
    assert classify(5, False, False, False, False, [1]) == "small1"
    assert classify(-1, True, False, False, False, []) == "neg+"
    assert sprawl(5, True, True, True, [1]) == 0
