"""
密码策略：长度 8–64，至少满足 4 类中的 3 类（大写/小写/数字/符号）。
bcrypt 最多 72 字节，此处提供截断辅助。
"""
from __future__ import annotations

import re

# bcrypt 只使用密码的前 72 字节，超出部分会被忽略；统一截断避免跨平台差异
BCRYPT_MAX_BYTES = 72


def truncate_for_bcrypt(password: str) -> str:
    """将密码截断为 bcrypt 可接受的长度（72 字节），按 UTF-8 截断并安全解码。"""
    if not password:
        return password
    raw = password.encode("utf-8")
    if len(raw) <= BCRYPT_MAX_BYTES:
        return password
    return raw[:BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore") or password[:1]


def validate_password(password: str) -> tuple[bool, str]:
    """
    校验密码是否符合策略。
    返回 (是否通过, 错误信息)。
    """
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters"
    if len(password) > 64:
        return False, "Password must be at most 64 characters"
    has_upper = bool(re.search(r"[A-Z]", password))
    has_lower = bool(re.search(r"[a-z]", password))
    has_digit = bool(re.search(r"\d", password))
    has_special = bool(re.search(r"[^A-Za-z0-9]", password))
    count = sum([has_upper, has_lower, has_digit, has_special])
    if count < 3:
        return False, "Password must contain at least 3 of: uppercase, lowercase, digit, symbol"
    return True, ""
