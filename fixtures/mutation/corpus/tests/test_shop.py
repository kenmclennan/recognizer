from app.shop import both, clamp, default_enabled, invert, is_adult, tiered, total


def test_all():
    assert clamp(0, 1, 5) == 1
    assert clamp(9, 1, 5) == 5
    assert clamp(3, 1, 5) == 3
    assert clamp(1, 1, 5) == 1
    assert clamp(5, 1, 5) == 5
    assert is_adult(30) is True
    assert is_adult(5) is False
    assert total(3, 4) == 12
    assert both(True, True) is True
    assert both(False, False) is False
    assert invert(True) is False
    default_enabled()
    assert tiered(11, True) == 22
    assert tiered(5, False) == 6
