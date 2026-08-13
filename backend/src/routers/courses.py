import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.db import get_db, Course
from src.routers.contacts import resolve_school_id
from src.routers.auth import get_current_user

router = APIRouter(prefix="/api/courses", tags=["Courses"])

DEFAULT_COURSES = [
    {
        "name": "IB Diploma Program (DP)",
        "code": "IB-DP",
        "target_grade": "Grade 11 - 12",
        "stream": "International Baccalaureate",
        "fee_structure": "₹ 4,50,000 / annum",
        "duration": "2 Years",
        "status": "Active",
        "description": "Rigorous pre-university program emphasizing global perspectives, TOK (Theory of Knowledge), and Extended Essay."
    },
    {
        "name": "Cambridge IGCSE Program",
        "code": "IGCSE-10",
        "target_grade": "Grade 9 - 10",
        "stream": "Cambridge International",
        "fee_structure": "₹ 3,80,000 / annum",
        "duration": "2 Years",
        "status": "Active",
        "description": "Globally recognized curriculum building problem-solving, analytical thinking, and practical application."
    },
    {
        "name": "Senior Secondary - Science Stream",
        "code": "CBSE-SCI",
        "target_grade": "Grade 11 - 12",
        "stream": "Physics, Chemistry, Math / Bio",
        "fee_structure": "₹ 2,80,000 / annum",
        "duration": "2 Years",
        "status": "Active",
        "description": "Comprehensive preparation for engineering (JEE) and medical (NEET) entrance exams alongside CBSE syllabus."
    },
    {
        "name": "Senior Secondary - Commerce & Economics",
        "code": "CBSE-COMM",
        "target_grade": "Grade 11 - 12",
        "stream": "Accounts, Business Studies, Econ",
        "fee_structure": "₹ 2,60,000 / annum",
        "duration": "2 Years",
        "status": "Active",
        "description": "Focus on financial accounting, business management, economics, and corporate leadership skills."
    },
    {
        "name": "Primary Years Program (PYP)",
        "code": "IB-PYP",
        "target_grade": "Nursery - Grade 5",
        "stream": "Early Years & Primary",
        "fee_structure": "₹ 2,20,000 / annum",
        "duration": "6 Years",
        "status": "Active",
        "description": "Inquiry-based learning fostering curiosity, holistic growth, emotional wellbeing, and foundation skills."
    }
]

class CoursePayload(BaseModel):
    name: str
    code: str | None = None
    target_grade: str | None = None
    stream: str | None = None
    fee_structure: str | None = None
    duration: str = "1 Year"
    status: str = "Active"
    description: str | None = None

@router.get("")
def get_courses(
    search: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    query = db.query(Course).filter(Course.school_id == school_id)

    # Seed default courses if empty for this school
    existing_count = query.count()
    if existing_count == 0:
        for c in DEFAULT_COURSES:
            db.add(Course(
                school_id=school_id,
                name=c["name"],
                code=c["code"],
                target_grade=c["target_grade"],
                stream=c["stream"],
                fee_structure=c["fee_structure"],
                duration=c["duration"],
                status=c["status"],
                description=c["description"]
            ))
        db.commit()
        query = db.query(Course).filter(Course.school_id == school_id)

    if search:
        s = f"%{search.strip()}%"
        query = query.filter((Course.name.ilike(s)) | (Course.code.ilike(s)) | (Course.target_grade.ilike(s)))
    if status:
        query = query.filter(Course.status == status)

    courses = query.order_by(Course.created_at.desc()).all()
    return courses

@router.post("")
def create_course(
    payload: CoursePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Course name is required")

    school_id = resolve_school_id(db, current_user)
    course = Course(
        school_id=school_id,
        name=payload.name.strip(),
        code=payload.code.strip() if payload.code else None,
        target_grade=payload.target_grade.strip() if payload.target_grade else None,
        stream=payload.stream.strip() if payload.stream else None,
        fee_structure=payload.fee_structure.strip() if payload.fee_structure else None,
        duration=payload.duration.strip() if payload.duration else "1 Year",
        status=payload.status,
        description=payload.description.strip() if payload.description else None
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course

@router.put("/{course_id}")
def update_course(
    course_id: str,
    payload: CoursePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    course = db.query(Course).filter(Course.id == course_id, Course.school_id == school_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    course.name = payload.name.strip()
    course.code = payload.code.strip() if payload.code else None
    course.target_grade = payload.target_grade.strip() if payload.target_grade else None
    course.stream = payload.stream.strip() if payload.stream else None
    course.fee_structure = payload.fee_structure.strip() if payload.fee_structure else None
    course.duration = payload.duration.strip() if payload.duration else "1 Year"
    course.status = payload.status
    course.description = payload.description.strip() if payload.description else None

    db.commit()
    db.refresh(course)
    return course

@router.delete("/{course_id}")
def delete_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    course = db.query(Course).filter(Course.id == course_id, Course.school_id == school_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    db.delete(course)
    db.commit()
    return {"success": True, "message": "Course deleted successfully"}
