import json


def render(document: dict) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"
