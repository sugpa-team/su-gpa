from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.api import router as api_router
from app.routes.courses import router as courses_router
from app.routes.taken_courses import router as taken_courses_router

app = FastAPI(title="su-gpa backend")

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


@app.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "welcome to sugpa"}
