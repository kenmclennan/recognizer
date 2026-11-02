from functools import cache

import tree_sitter_kotlin
import tree_sitter_python
import tree_sitter_rust
import tree_sitter_typescript
from tree_sitter import Language, Parser, Tree

LANGUAGES = ("python", "typescript", "kotlin", "rust")

EXTENSION_GRAMMARS = {
    ".py": "python",
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".jsx": "tsx",
    ".js": "tsx",
    ".mjs": "tsx",
    ".cjs": "tsx",
    ".kt": "kotlin",
    ".rs": "rust",
}

LOADERS = {
    "python": tree_sitter_python.language,
    "typescript": tree_sitter_typescript.language_typescript,
    "tsx": tree_sitter_typescript.language_tsx,
    "kotlin": tree_sitter_kotlin.language,
    "rust": tree_sitter_rust.language,
}


def grammar_for(path: str) -> str | None:
    dot = path.rfind(".")

    return EXTENSION_GRAMMARS.get(path[dot:].lower()) if dot != -1 else None


@cache
def parser_for(grammar: str) -> Parser:
    return Parser(Language(LOADERS[grammar]()))


def parse(grammar: str, source: bytes) -> Tree:
    return parser_for(grammar).parse(source)
