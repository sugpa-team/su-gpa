import json
from pathlib import Path


def load_courses() -> list[dict]:
    data_path = Path(__file__).resolve().parent.parent / "data" / "courses_SU.json"
    with data_path.open("r", encoding="utf-8") as file:
        return json.load(file)
