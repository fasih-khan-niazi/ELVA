"""
Shared guardrail text for chat and voice.

Platform safety (religion, extremism, etc.) is a baseline for every agent.
Per-agent guardrails from the creation form are appended as authoritative
business rules — never truncated in a way that drops them silently.
"""

from typing import Optional

# Baseline platform safety — always on unless explicitly disabled in env.
PLATFORM_CONTENT_SAFETY = """=== PLATFORM CONTENT SAFETY (ALWAYS ENFORCE) ===
The following topics are off-limits regardless of phrasing:
• Religion, scripture, religious comparisons, or faith-based debates
• Race, ethnicity, or discriminatory / prejudiced content
• Political opinions, parties, politicians, or elections
• Extremist or terrorist ideologies, violent movements, or hate speech
• Explicit, sexual, or adult content
• Academic dishonesty (doing homework, exams, or essays for the user)
• Medical diagnoses, specific legal advice, or direct investment recommendations
If the user raises any of the above, decline briefly and redirect to how you can help with this business.
=== END PLATFORM CONTENT SAFETY ==="""

PLATFORM_CONTENT_SAFETY_VOICE = """CONTENT SAFETY (always enforce):
Never discuss religion, race/racism, political opinions, extremist ideologies, explicit content, or academic dishonesty.
If raised: "That's not something I can help with on this call, but I'm happy to assist with our services.\""""

VOICE_ANTI_HALLUCINATION = """FACTUAL ACCURACY (critical):
• Company facts (menu, prices, hours, location, staff, policies): ONLY from KNOWLEDGE BASE below.
• If not in KNOWLEDGE BASE: say you don't have that detail and suggest contacting the business directly.
• NEVER invent menu items, prices, delivery times, order totals, or confirmation status.
• NEVER say an order is confirmed, placed, or being processed unless ORDER STATE explicitly says submitted.
• During ORDER STATE collection: follow the scripted next step only — do not freestyle order details."""


def format_agent_guardrails_block(guardrails: Optional[str], *, voice: bool = False) -> str:
    """Render per-agent guardrails from the agent creation form."""
    text = (guardrails or "").strip()
    if not text:
        return ""
    if voice:
        return f"\nAGENT GUARDRAILS (from business owner — follow strictly):\n{text}\n"
    return f"\n=== BUSINESS RULES (from agent configuration) ===\n{text}\n=== END BUSINESS RULES ===\n"


def build_chat_system_safety_and_rules(guardrails: Optional[str]) -> str:
    return PLATFORM_CONTENT_SAFETY + format_agent_guardrails_block(guardrails, voice=False)


def build_voice_system_safety_and_rules(guardrails: Optional[str]) -> str:
    parts = [PLATFORM_CONTENT_SAFETY_VOICE]
    agent_block = format_agent_guardrails_block(guardrails, voice=True)
    if agent_block:
        parts.append(agent_block.strip())
    parts.append(VOICE_ANTI_HALLUCINATION)
    return "\n\n".join(parts)
