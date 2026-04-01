from fastapi import FastAPI

from app.routes.courses import router as courses_router
from app.routes.taken_courses import router as taken_courses_router

app = FastAPI(title="su-gpa backend")

app.include_router(courses_router, prefix="/courses", tags=["courses"])
app.include_router(taken_courses_router, prefix="/taken-courses", tags=["taken-courses"])


@app.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "welcome to sugpa"}
