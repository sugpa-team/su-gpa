from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.api import router as api_router
from app.routes.course_feedback import router as course_feedback_router
from app.routes.courses import router as courses_router
from app.routes.plans import router as plans_router
from app.routes.profile import router as profile_router
from app.routes.schedule import router as schedule_router
from app.routes.taken_courses import router as taken_courses_router
from app.services.taken_course_service import init_program_requirements_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_program_requirements_db()
    yield


app = FastAPI(title="su-gpa backend", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses_router, prefix="/courses", tags=["courses"])
app.include_router(taken_courses_router, prefix="/taken-courses", tags=["taken-courses"])
app.include_router(api_router, prefix="/api", tags=["live-gpa"])
app.include_router(profile_router, prefix="/api", tags=["profile"])
app.include_router(schedule_router, prefix="/api/schedule", tags=["schedule"])
app.include_router(plans_router, prefix="/api/plans", tags=["plans"])
app.include_router(course_feedback_router, prefix="/api/course-feedback", tags=["course-feedback"])


@app.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "welcome to sugpa"}
