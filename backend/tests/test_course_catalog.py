from app.services import taken_course_service as service
from app.utils import loader


def test_course_catalog_preserves_raw_codes_for_alias_lookups(monkeypatch):
    monkeypatch.setattr(
        service,
        "load_courses",
        lambda: [
            {
                "Course": "DSA 210",
                "Name": "Introduction to Data Science",
                "ECTS Credits": 6.0,
                "SU Credits": 3.0,
                "Faculty": "FENS",
            },
            {
                "Course": "DSA 210 / CS 210",
                "Name": "Introduction to Data Science",
                "ECTS Credits": 6.0,
                "SU Credits": 3.0,
                "Faculty": "FENS",
            },
        ],
    )

    catalog = service._course_catalog()

    assert catalog["DSA 210"]["SU Credits"] == 3.0
    assert catalog["DSA 210 / CS 210"]["SU Credits"] == 3.0


def test_course_db_syncs_existing_database_from_json(tmp_path, monkeypatch):
    json_path = tmp_path / "courses.json"
    db_path = tmp_path / "courses.db"
    monkeypatch.setattr(loader, "DATA_DIR", tmp_path)
    monkeypatch.setattr(loader, "JSON_PATH", json_path)
    monkeypatch.setattr(loader, "DB_PATH", db_path)

    json_path.write_text(
        """
        [
          {
              "Course": "OLD 101",
              "Name": "Old Name",
              "ECTS Credits": 5.0,
              "SU Credits": 2.0,
              "Faculty": "FENS"
          },
          {
              "Course": "STALE 101",
              "Name": "Stale Course",
              "ECTS Credits": 5.0,
              "SU Credits": 2.0,
              "Faculty": "FENS"
          }
        ]
        """,
        encoding="utf-8",
    )
    loader.ensure_courses_db()

    json_path.write_text(
        """
        [
          {
              "Course": "OLD 101",
              "Name": "Updated Name",
              "ECTS Credits": 6.0,
              "SU Credits": 3.0,
              "Faculty": "FENS"
          },
          {
              "Course": "NEW 101",
              "Name": "New Course",
              "ECTS Credits": 7.0,
              "SU Credits": 4.0,
              "Faculty": "FASS"
          }
        ]
        """,
        encoding="utf-8",
    )

    courses = {course["Course"]: course for course in loader.load_courses()}

    assert courses["OLD 101"]["Name"] == "Updated Name"
    assert courses["OLD 101"]["SU Credits"] == 3.0
    assert courses["NEW 101"]["ECTS Credits"] == 7.0
    assert "STALE 101" not in courses
