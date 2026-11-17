from test_mutation_memory import kotlin_suite

from recognizer_sensors.mutation.runner import GradleHomes, run_test_command


def test_a_worker_run_gets_its_own_home_and_the_daemon_options(tmp_path):
    source = tmp_path / "source"
    (source / "caches" / "modules-2").mkdir(parents=True)
    home = tmp_path / "home"
    home.mkdir()
    suite = kotlin_suite({"GRADLE_USER_HOME": str(source)})

    result = run_test_command(
        'echo "$GRADLE_USER_HOME $GRADLE_RO_DEP_CACHE $GRADLE_OPTS"',
        tmp_path,
        30,
        suite,
        gradle_home=home,
    )

    assert str(home) in result.output
    assert str(source / "caches") in result.output
    assert "-Dorg.gradle.daemon=true" in result.output
    assert "-Dorg.gradle.daemon.idletimeout=300000" in result.output
    assert "-Dorg.gradle.daemon=false" not in result.output


def test_a_worker_home_is_seeded_from_the_source_home(tmp_path):
    source = tmp_path / "source"
    (source / "wrapper").mkdir(parents=True)
    (source / "init.d").mkdir()
    (source / "init.d" / "a.gradle").write_text("x")
    (source / "gradle.properties").write_text("org.gradle.jvmargs=-Xmx1g")
    suite = kotlin_suite({"GRADLE_USER_HOME": str(source)})

    home = GradleHomes(tmp_path / "work").home_for(0, suite)

    assert (home / "wrapper").is_symlink()
    assert (home / "wrapper").resolve() == (source / "wrapper").resolve()
    assert (home / "gradle.properties").read_text() == "org.gradle.jvmargs=-Xmx1g"
    assert (home / "init.d" / "a.gradle").read_text() == "x"

    empty = tmp_path / "empty"
    empty.mkdir()
    bare = GradleHomes(tmp_path / "bare").home_for(
        0, kotlin_suite({"GRADLE_USER_HOME": str(empty)})
    )

    assert sorted(path.name for path in bare.iterdir()) == []
