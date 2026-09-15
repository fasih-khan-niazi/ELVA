"""Colored terminal logging for AI service startup."""

from __future__ import annotations

_C = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "red": "\033[31m",
    "cyan": "\033[36m",
    "blue": "\033[34m",
    "magenta": "\033[35m",
}


def banner(title: str) -> None:
    line = "═" * max(20, len(title) + 4)
    print(f"\n{_C['cyan']}{_C['bold']}╔{line}╗{_C['reset']}")
    print(f"{_C['cyan']}{_C['bold']}║  {title:<{len(line)-2}}║{_C['reset']}")
    print(f"{_C['cyan']}{_C['bold']}╚{line}╝{_C['reset']}")


def ok(tag: str, message: str) -> None:
    print(f"{_C['green']}✓{_C['reset']} {_C['bold']}{tag}{_C['reset']} {message}")


def warn(tag: str, message: str) -> None:
    print(f"{_C['yellow']}⚠{_C['reset']} {_C['bold']}{tag}{_C['reset']} {message}")


def err(tag: str, message: str) -> None:
    print(f"{_C['red']}✗{_C['reset']} {_C['bold']}{tag}{_C['reset']} {message}")


def info(tag: str, message: str) -> None:
    print(f"{_C['blue']}●{_C['reset']} {_C['bold']}{tag}{_C['reset']} {message}")


def dim(message: str) -> None:
    print(f"{_C['dim']}  {message}{_C['reset']}")


def voice(tag: str, message: str) -> None:
    print(f"{_C['magenta']}♪{_C['reset']} {_C['bold']}{tag}{_C['reset']} {message}")


def row(label: str, value: str, ok: bool | None = None) -> None:
    if ok is True:
        icon = f"{_C['green']}●{_C['reset']}"
    elif ok is False:
        icon = f"{_C['red']}●{_C['reset']}"
    else:
        icon = f"{_C['dim']}○{_C['reset']}"
    print(f"  {icon} {_C['dim']}{label}:{_C['reset']} {value}")
