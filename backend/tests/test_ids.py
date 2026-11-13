from app.db.models import new_uuid


def test_new_uuid_is_v7_and_time_ordered() -> None:
    first = new_uuid()
    assert first.version == 7
    assert first.variant == "specified in RFC 4122"
    assert len({new_uuid() for _ in range(1000)}) == 1000
    # 앞 48비트가 ms 시각이다. 같은 ms 안의 순서는 보장하지 않으므로 시각 부분만 비교한다
    assert new_uuid().int >> 80 >= first.int >> 80
