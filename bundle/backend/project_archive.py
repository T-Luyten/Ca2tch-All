"""Versioned, self-contained project archives (ZIP + JSON + original workbooks)."""
import hashlib
import io
import json
import uuid
import zipfile
import zlib
from datetime import datetime, timezone

FORMAT = "ca2tchall-project"
VERSION = 1
MANIFEST_LIMIT = 4 * 1024 * 1024


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def valid_uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("Invalid project or source identifier.")
    return value


def validate_manifest(manifest, max_files):
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ValueError("This is not a Ca2tchAll project.")
    if manifest.get("version") != VERSION:
        raise ValueError("Unsupported project version. Open this project with a compatible Ca2tchAll version.")
    valid_uuid(manifest.get("project_id"))
    if not isinstance(manifest.get("saved_at"), str):
        raise ValueError("Project save timestamp is missing.")
    datetime.fromisoformat(manifest["saved_at"])
    sources = manifest.get("sources")
    if not isinstance(sources, list) or not sources or len(sources) > max_files:
        raise ValueError(f"A project must contain between 1 and {max_files} workbooks.")
    if not isinstance(manifest.get("workspace"), dict):
        raise ValueError("Project workspace settings are missing or invalid.")
    workspace = manifest["workspace"]
    for key in ("controls", "condColorMap", "dayColorMap", "labelOverrides"):
        if key in workspace and not isinstance(workspace[key], dict):
            raise ValueError(f"Invalid workspace {key}.")
    if "manualConditionOrder" in workspace and not isinstance(workspace["manualConditionOrder"], list):
        raise ValueError("Invalid condition order.")
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("Invalid source entry.")
        sid = valid_uuid(source.get("source_id"))
        if sid in seen:
            raise ValueError("Duplicate source identifier.")
        seen.add(sid)
        name = source.get("file_name")
        if not isinstance(name, str) or len(name) > 4096 or not name.lower().endswith((".xlsx", ".xls")):
            raise ValueError("Invalid source workbook filename.")
        suffix = ".xlsx" if name.lower().endswith(".xlsx") else ".xls"
        if source.get("archive_path") != f"sources/{sid}{suffix}":
            raise ValueError("Invalid embedded workbook reference.")
        for key in ("condition", "day", "uploaded_at"):
            if not isinstance(source.get(key), str) or len(source[key]) > 4096:
                raise ValueError(f"Invalid source {key}.")
        datetime.fromisoformat(source["uploaded_at"])
        digest = source.get("sha256")
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("Invalid workbook fingerprint.")
        if type(source.get("size_bytes")) is not int or source["size_bytes"] <= 0:
            raise ValueError("Invalid embedded workbook size.")
    return manifest


def build_archive(sessions, assignments, workspace, project_id, max_files):
    if set(assignments) != set(sessions):
        raise ValueError("The file list changed. Wait for uploads to finish and save again.")
    manifest = {
        "format": FORMAT, "version": VERSION,
        "project_id": project_id, "saved_at": utc_now(),
        "application": "Ca2tchAll", "workspace": workspace, "sources": [],
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for fid, session in sessions.items():
            content = session.get("source_workbook")
            provenance = session.get("provenance")
            if not content or not provenance:
                raise ValueError("Original workbook data is unavailable. Re-upload this file before saving a project.")
            suffix = ".xlsx" if session["file_name"].lower().endswith(".xlsx") else ".xls"
            path = f"sources/{fid}{suffix}"
            assignment = assignments[fid]
            source = {
                **provenance, "source_id": fid, "file_name": session["file_name"],
                "archive_path": path,
                "condition": assignment.get("condition", ""), "day": assignment.get("day", ""),
            }
            manifest["sources"].append(source)
            archive.writestr(path, content)
        validate_manifest(manifest, max_files)
        data = json.dumps(manifest, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(data) > MANIFEST_LIMIT:
            raise ValueError("Project settings are too large.")
        archive.writestr("manifest.json", data)
    return buffer.getvalue()


def _reject_nonfinite(value):
    raise ValueError(f"Project contains an invalid JSON number: {value}")


def read_archive(content, max_files, max_bytes):
    # Never extract files to disk; names are only exact archive references.
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or len(infos) > max_files + 1:
                raise ValueError("Duplicate or excessive project archive entries.")
            if any(info.flag_bits & 1 for info in infos):
                raise ValueError("Encrypted projects are not supported.")
            info = archive.getinfo("manifest.json")
            if info.file_size > MANIFEST_LIMIT:
                raise ValueError("Project manifest is too large.")
            if sum(info.file_size for info in infos) > max_bytes + MANIFEST_LIMIT:
                raise ValueError("Project exceeds the configured memory limit.")
            manifest = validate_manifest(json.loads(archive.read("manifest.json"), parse_constant=_reject_nonfinite), max_files)
            expected = {"manifest.json", *(s["archive_path"] for s in manifest["sources"])}
            if set(names) != expected:
                raise ValueError("Project has missing or unexpected embedded files.")
            workbooks = []
            for source in manifest["sources"]:
                info = archive.getinfo(source["archive_path"])
                if info.file_size != source["size_bytes"]:
                    raise ValueError(f"Workbook size mismatch: {source['file_name']}")
                workbook = archive.read(info)
                if hashlib.sha256(workbook).hexdigest() != source["sha256"]:
                    raise ValueError(f"Workbook fingerprint mismatch: {source['file_name']}")
                workbooks.append((source, workbook))
            return manifest, workbooks
    except (zipfile.BadZipFile, KeyError, TypeError, UnicodeError, RuntimeError, NotImplementedError, zlib.error) as exc:
        raise ValueError("The project is invalid, incomplete, or damaged.") from exc
