from test_git_listing import make_repository

from recognizer_scan_kotlin.discovery import discover

CLASS = "package a\n\nclass A\n"
SOURCES = {
    "build.gradle.kts": "",
    "src/main/kotlin/A.kt": CLASS,
    "src/test/kotlin/ATest.kt": CLASS,
    "src/pactTest/kotlin/P.kt": CLASS,
}


def test_a_gradle_project_reads_src_main_only(tmp_path):
    make_repository(tmp_path, SOURCES, {"bin/main/A.kt": CLASS}, ignore=False)

    found = discover(tmp_path)

    assert found[0] == "src/main/kotlin/A.kt"
    assert found == ["src/main/kotlin/A.kt"]


def test_a_project_with_no_build_file_is_scanned_as_today(tmp_path):
    files = {k: v for k, v in SOURCES.items() if k != "build.gradle.kts"}
    make_repository(tmp_path, files, {"bin/main/A.kt": CLASS}, ignore=False)

    assert discover(tmp_path) == ["bin/main/A.kt", "src/main/kotlin/A.kt"]


def test_a_pom_build_module_is_scanned_as_today(tmp_path):
    files = {k: v for k, v in SOURCES.items() if k != "build.gradle.kts"}
    make_repository(tmp_path, {**files, "pom.xml": ""}, {"bin/main/A.kt": CLASS}, ignore=False)

    assert discover(tmp_path) == ["bin/main/A.kt", "src/main/kotlin/A.kt"]


def test_a_maven_and_a_gradle_folder_each_apply_their_own_rule(tmp_path):
    make_repository(
        tmp_path,
        {
            "mvn/pom.xml": "",
            "mvn/loose/A.kt": CLASS,
            "gr/build.gradle.kts": "",
            "gr/loose/B.kt": CLASS,
            "gr/src/main/kotlin/C.kt": CLASS,
        },
    )

    assert discover(tmp_path) == ["gr/src/main/kotlin/C.kt", "mvn/loose/A.kt"]


def test_a_gradle_subproject_applies_its_own_source_folders(tmp_path):
    make_repository(
        tmp_path,
        {
            "build.gradle.kts": "",
            "src/main/kotlin/R.kt": CLASS,
            "svc/build.gradle.kts": "",
            "svc/src/main/kotlin/A.kt": CLASS,
        },
        {"svc/bin/A.kt": CLASS, "bin/R.kt": CLASS},
    )

    assert discover(tmp_path) == ["src/main/kotlin/R.kt", "svc/src/main/kotlin/A.kt"]


def test_a_gradle_subproject_without_a_build_file_is_still_read(tmp_path):
    make_repository(
        tmp_path,
        {
            "build.gradle.kts": "",
            "feature-a/src/main/kotlin/A.kt": CLASS,
            "feature-a/src/main/java/B.kt": CLASS,
            "feature-a/src/main/C.kt": CLASS,
        },
        {"bin/main/A.kt": CLASS},
    )

    found = discover(tmp_path)

    assert found[0] == "feature-a/src/main/java/B.kt"
    assert found == ["feature-a/src/main/java/B.kt", "feature-a/src/main/kotlin/A.kt"]


def test_a_source_set_created_in_the_build_file_is_read_through_its_folder(tmp_path):
    make_repository(
        tmp_path,
        {
            "build.gradle.kts": 'sourceSets { create("contract")\n create("pactTest") }\n',
            "src/contract/kotlin/C.kt": CLASS,
            "src/pactTest/kotlin/P.kt": CLASS,
        },
    )

    assert discover(tmp_path) == ["src/contract/kotlin/C.kt"]


def test_a_kotlin_file_under_src_main_java_is_read(tmp_path):
    make_repository(tmp_path, {"build.gradle": "", "src/main/java/A.kt": CLASS})

    assert discover(tmp_path) == ["src/main/java/A.kt"]


def test_a_literal_srcdir_is_read_in_both_dsls(tmp_path):
    declarations = {
        'kotlin.srcDir("gen/kotlin")': ["gen/kotlin/G.kt"],
        "java.srcDir 'gen/java'": ["gen/java/G.kt"],
        'kotlin.srcDirs("a", "b")': ["a/G.kt", "b/G.kt"],
        'kotlin.srcDirs = listOf("x/y")': ["x/y/G.kt"],
        'sourceSets { main { kotlin.srcDir("gen/kotlin") } }': ["gen/kotlin/G.kt"],
    }

    for index, (declaration, expected) in enumerate(declarations.items()):
        folder = tmp_path / str(index)
        files = {"build.gradle.kts": declaration + "\n", "src/main/kotlin/M.kt": CLASS}

        for path in ["gen/kotlin", "gen/java", "a", "b", "x/y", "other"]:
            files[f"{path}/G.kt"] = CLASS

        make_repository(folder, files)

        assert discover(folder) == sorted([*expected, "src/main/kotlin/M.kt"]), declaration


def test_an_unreadable_srcdir_is_reported_and_the_defaults_are_read(tmp_path, capsys):
    make_repository(
        tmp_path,
        {
            "build.gradle.kts": 'kotlin.srcDir("$buildDir/g")\nkotlin.srcDir("lit")\n',
            "src/main/kotlin/A.kt": CLASS,
            "lit/L.kt": CLASS,
            "other/O.kt": CLASS,
        },
    )

    assert discover(tmp_path) == ["lit/L.kt", "src/main/kotlin/A.kt"]

    lines = [x for x in capsys.readouterr().err.splitlines() if "cannot read" in x]

    assert len(lines) == 1
    assert "build.gradle.kts" in lines[0]


def test_a_declared_folder_outside_the_module_is_reported(tmp_path, capsys):
    make_repository(
        tmp_path,
        {
            "svc/build.gradle.kts": 'kotlin.srcDir("../shared")\n',
            "svc/src/main/kotlin/A.kt": CLASS,
            "shared/S.kt": CLASS,
        },
    )

    assert discover(tmp_path) == ["shared/S.kt", "svc/src/main/kotlin/A.kt"]
    assert "svc/build.gradle.kts" in capsys.readouterr().err


def test_the_gitignore_and_listing_still_apply_inside_source_folders(tmp_path):
    make_repository(
        tmp_path,
        {"build.gradle.kts": "", "src/main/kotlin/A.kt": CLASS, ".keep": ""},
        {"src/main/kotlin/Ignored.kt": CLASS},
        ignore=False,
    )
    (tmp_path / ".gitignore").write_text("Ignored.kt\n")

    assert discover(tmp_path) == ["src/main/kotlin/A.kt"]


def test_a_skipped_directory_inside_a_source_folder_stays_skipped(tmp_path):
    make_repository(
        tmp_path,
        {
            "build.gradle.kts": "",
            "src/main/kotlin/A.kt": CLASS,
            "src/main/kotlin/test/X.kt": CLASS,
        },
    )

    assert discover(tmp_path) == ["src/main/kotlin/A.kt"]


def test_a_gradle_module_with_no_standard_source_folder_is_read_as_before(tmp_path):
    make_repository(
        tmp_path,
        {"build.gradle.kts": "", "jvm/src/A.kt": CLASS, "common/src/B.kt": CLASS},
        {"bin/main/C.kt": CLASS},
        ignore=False,
    )

    assert discover(tmp_path) == ["bin/main/C.kt", "common/src/B.kt", "jvm/src/A.kt"]
