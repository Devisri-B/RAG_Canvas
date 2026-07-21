"""LTI claim helpers."""

from __future__ import annotations


def extract_lti_user_fields(launch_data: dict) -> dict[str, str | None]:
    """Parse display fields from an LTI 1.3 launch JWT body."""
    custom = launch_data.get("https://purl.imsglobal.org/spec/lti/claim/custom", {}) or {}
    roles = launch_data.get("https://purl.imsglobal.org/spec/lti/claim/roles") or []

    user_role = None
    for role in roles:
        role_str = str(role)
        if any(kw in role_str for kw in ("Instructor", "Teacher", "Faculty", "Staff")):
            user_role = "Teacher"
            break
        if any(kw in role_str for kw in ("Administrator", "Admin", "SysAdmin", "ContentDeveloper")):
            user_role = "Administrator"
            break
        if any(kw in role_str for kw in ("TeachingAssistant", "TA", "Assistant")):
            user_role = "Teaching Assistant"
            break
        if any(kw in role_str for kw in ("Learner", "Student")):
            user_role = "Student"
            break

    return {
        "user_name": launch_data.get("name") or launch_data.get("given_name"),
        "user_email": launch_data.get("email") or custom.get("person_email"),
        "user_role": user_role,
        "lti_sub": launch_data.get("sub"),
    }
