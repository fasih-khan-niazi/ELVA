import hashlib
import json
import os
import re
import threading
import httpx
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from llm_provider import invoke_llm, invoke_llm_order_extract
from guardrails_text import (
    build_chat_system_safety_and_rules,
    build_voice_system_safety_and_rules,
    format_agent_guardrails_block,
)
from voice_sanitize import sanitize_voice_llm_response
from menu_index import MenuIndex
from order_flow import (
    address_skip_allowed,
    can_final_submit,
    mark_submit_attempt,
    phone_skip_allowed,
    validate_items_for_submit,
)


def _internal_api_headers():
    """Same value as backend INTERNAL_API_SECRET — required in production for /api/internal/*."""
    secret = os.environ.get("INTERNAL_API_SECRET", "").strip()
    return {"x-internal-secret": secret} if secret else {}

TONE_GUIDELINES: dict = {
    "professional": (
        "Use formal, precise language. Avoid slang or contractions. "
        "Be authoritative and concise. Structure responses clearly."
    ),
    "friendly": (
        "Be warm, approachable, and conversational. Use light informal language. "
        "Make the customer feel welcome and at ease."
    ),
    "empathetic": (
        "Show genuine warmth and care - naturally, not mechanically. "
        "Do NOT start every message with 'I understand you're X, and that makes sense' or any formulaic opener. "
        "When a customer shares a concern or frustration, briefly acknowledge it before moving to the solution. "
        "For neutral or positive messages, respond warmly and helpfully without force-fitting an acknowledgment. "
        "Keep the tone human, not scripted."
    ),
    "humorous": (
        "Incorporate light wit, wordplay, or gentle jokes where naturally appropriate - through words alone, not emojis. "
        "Keep the mood fun and upbeat without sacrificing accuracy or helpfulness. "
        "Never make jokes at the customer's expense. "
        "For voice, keep humor brief and delivery-friendly; for chat, playful phrasing over emoji."
    ),
    "formal": (
        "Use titles and respectful forms of address where applicable. Maintain strict decorum. "
        "Avoid all colloquialisms, abbreviations, or casual phrasing."
    ),
    "casual": (
        "Talk like a knowledgeable friend - relaxed, easy, and natural. "
        "Short sentences, contractions are welcome. Skip the corporate language."
    ),
}


@dataclass
class AgentConfig:
    name: str
    business_name: str = ""
    system_prompt: str = ""
    persona: Dict[str, Any] = field(default_factory=dict)
    tone: Optional[str] = None
    objectives: List[str] = field(default_factory=list)
    capabilities: List[str] = field(default_factory=list)
    guardrails: Optional[str] = None
    memory_window: int = 8
    response_config: Dict[str, Any] = field(default_factory=dict)


class AgentRuntime:
    """Core agent orchestrator: retrieves context, plans, then responds faithfully."""

    # Thread-local storage for per-request state that must not bleed between threads.
    _tls: threading.local = threading.local()

    # Per-process catalog cache (agent menu) — avoids repeated backend fetches mid-call.
    _catalog_cache: Dict[str, tuple] = {}
    _catalog_items_cache: Dict[str, tuple] = {}
    _catalog_cache_lock = threading.Lock()
    # Tier A: max items spoken aloud on voice menu questions (rest summarized).
    VOICE_MENU_SPOKEN_MAX = 6
    _CATALOG_CACHE_TTL_SEC = int(os.environ.get("CATALOG_CACHE_TTL_SECONDS", "300"))

    @property
    def _currency_symbol(self) -> str:
        return getattr(AgentRuntime._tls, "currency_symbol", "$")

    @_currency_symbol.setter
    def _currency_symbol(self, value: str) -> None:
        AgentRuntime._tls.currency_symbol = value

    @property
    def _current_currency(self) -> str:
        return getattr(AgentRuntime._tls, "current_currency", "USD")

    @_current_currency.setter
    def _current_currency(self, value: str) -> None:
        AgentRuntime._tls.current_currency = value

    # Queries that are vague/navigational and need synthesis
    NAVIGATIONAL_QUERIES = {
        "proceed", "next", "continue", "go on", "what else", "more",
        "go ahead", "and", "then",
        "show me more", "tell me more", "keep going",
    }

    # Keywords indicating user wants ALL information at once
    COMPLETENESS_KEYWORDS = {
        "full menu", "complete menu", "full list", "entire menu",
        "everything on the menu", "everything you have", "everything available",
        "whole menu", "all items", "all of them",
        "list all", "name all", "all options", "all the options",
        "all flavors", "all flavours", "all categories", "all types",
        "all pizzas", "all burgers", "all the pizzas", "all the burgers",
        "just list", "please list", "list them", "name them",
    }

    NAVIGATION_HINTS = {
        "next", "continue", "proceed", "go on", "what else", "more", "anything else",
    }

    # Single-word chitchat triggers (matched by word intersection)
    CHITCHAT_WORDS = {"hi", "hello", "hey", "yo"}
    # Multi-word chitchat triggers (matched by substring)
    CHITCHAT_PHRASES = {"how are you", "good morning", "good evening"}

    # Order-related keywords
    ORDER_TRIGGER_PHRASES = [
        "i want to order", "i'd like to order", "id like to order",
        "can i order", "can i get", "i'll have", "ill have", "i will have",
        "i want", "i'd like", "id like", "give me", "get me",
        "add to order", "add to my order", "add to cart",
        "place an order", "place order", "make an order",
        "order for delivery", "order for pickup",
        "i need", "let me get", "let me have",
        "wanted to order", "want to order", "wanna order",
        "would like to order", "i would like to order",
        "i would like", "would like to get",
        "deliver ", "send me ", "ship me ",
        "deliver to ", "delivery of ",
        "i'll take ", "ill take ", "i will take ",
        "can i buy", "want to buy", "wanted to buy",
        "pack of ", "packs of ", "box of ", "boxes of ",
        "bottle of ", "bottles of ", "strip of ", "strips of ",
        "it's an order", "its an order", "an order for me",
        "order for me", "i'd like an order", "id like an order",
        "i want an order", "it is an order",
        "help me place an order", "help me order", "help me with an order",
    ]
    # Regex for detecting quantity + item patterns (e.g. "20 packs of panadol", "3 bottles")
    ORDER_QUANTITY_PATTERN = re.compile(
        r'\b(\d{1,4})\s*(?:x\s+)?(?:pack|packs|box|boxes|bottle|bottles|strip|strips|piece|pieces|unit|units|tablet|tablets|capsule|capsules)?\s+(?:of\s+)?',
        re.IGNORECASE
    )
    ORDER_ITEM_PHRASES = [
        "one ", "two ", "three ", "four ", "five ", "six ",
        "seven ", "eight ", "nine ", "ten ",
        "a ", "an ", "some ",
    ]
    ORDER_CONFIRM_PHRASES = [
        "confirm order", "confirm my order", "place order", "place my order",
        "submit order", "submit my order", "finalize order",
        "that's all", "thats all", "that is all", "that's it", "thats it",
        "nothing else", "no that's all", "no thats all",
        "yes confirm", "yes place", "yes submit",
        "looks good", "looks correct", "order looks good",
        "yes that's correct", "yes thats correct",
        "go ahead", "go ahead and place",
        "confirmed", "yeah confirmed", "yep confirmed",
        "done", "i'm done", "im done", "done ordering",
        "that will be all", "place it", "submit it",
        "just this", "no just this", "only this", "that's my order",
        "no more", "no nothing else", "nothing more",
        "no just", "nope just this", "nah just this",
        "just these", "no just these", "only these", "these only",
        "confirm and place", "place and confirm",
        "yes place it", "yes confirmed", "yes confirm it",
        "place my order now", "go ahead and confirm",
        "just place", "just place it", "just placed", "just place the order",
        "placed the order", "place the order", "lets place", "let's place",
        "just order", "just order it", "we're done", "were done",
        "order it", "order now", "complete order", "complete the order",
        "please order", "please place", "please place order",
        "yes that's it", "yeah that's it", "yep that's it",
    ]
    # Short affirmative words that confirm an order when in active ordering context
    ORDER_CONFIRM_SHORT = {
        "yes", "yeah", "yep", "yup", "sure", "ok", "okay",
        "correct", "confirmed", "confirm", "done", "perfect",
        "absolutely", "definitely", "right", "alright",
        "place", "placed", "complete",
    }
    # Fuzzy spellings of confirm/place - catches typos like "cnfirm", "confrim"
    ORDER_CONFIRM_FUZZY = {
        "confirm", "cnfirm", "confrim", "comfirm", "confim", "confrm",
        "confirmed", "cnfirmed", "confrimed", "comfirmed", "confimed",
        "confirmd", "confrmed", "placed", "plase", "plce",
    }

    ORDER_CANCEL_PHRASES = [
        "cancel order", "cancel my order", "nevermind", "never mind",
        "forget it", "forget the order", "remove order", "clear order",
        "don't order", "dont order", "scratch that",
        "don't want to order", "dont want to order",
        "i dont want to order", "i don't want to order",
        "not want to order", "no i dont want",
    ]
    ORDER_MODIFY_PHRASES = [
        "remove ", "take off ", "no more ", "without ",
        "change ", "modify ", "update ",
        "actually ", "instead ",
        "add more", "extra ",
    ]

    # Menu / catalog info — route here so "tell me the menu" isn't misread as order_add.
    MENU_INFO_PHRASES = [
        "tell me the menu", "tell me about the menu", "what's on the menu", "whats on the menu",
        "what is on the menu", "show me the menu", "see the menu", "read the menu",
        "can i see the menu", "could i see the menu", "share the menu", "send the menu",
        "list the menu", "full menu", "entire menu", "complete menu", "whole menu",
        "menu please", "the menu please", "please tell me the menu", "please show the menu",
        "what's on your menu", "whats on your menu", "on your menu", "from the menu only",
        "what do you serve", "what are you serving", "what have you got",
        "what do you sell", "what do you guys sell", "what do you offer",
        "do you have a menu", "may i have the menu",
    ]

    # Lead detection patterns
    EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    PHONE_PATTERN = re.compile(r'(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}')

    # Menu token normalisation for fuzzy voice matching (bbq ↔ barbecue, etc.)
    MENU_SYNONYMS: Dict[str, str] = {
        "bbq": "barbecue",
        "barbeque": "barbecue",
        "mix": "mixed",
        "plater": "platter",
        "bar": "barbecue",
    }

    # Common Deepgram mis-hearings collapsed before token synonym mapping.
    STT_MENU_PHRASE_FIXES: List[tuple] = [
        (r"\bthree foods\b", "niazi foods"),
        (r"\bniyadhi foods?\b", "niazi foods"),
        (r"\bniyazi foods?\b", "niazi foods"),
        (r"\bsuits\b", "sweets"),
        (r"\bmix\s*bar\b", "mixed barbecue"),
        (r"\bmixed\s*bar\b", "mixed barbecue"),
        (r"\bbar\s*barbecue\b", "barbecue"),
        (r"\bpassword\s+menu\b", "fast food menu"),
        (r"\bsour\s+soup\b", "hot and sour soup"),
        (r"\bhot\s+sour\s+soup\b", "hot and sour soup"),
    ]

    ORDER_ALSO_PHRASES = [
        "what about", "how about", "also the", "and also", "as well",
        "plus the", "add the", "add a", "can i also", "i also want",
        "please add", "in the cart", "in my cart", "put in",
    ]

    GLOBAL_GENERAL_QUESTION_PATTERNS = [
        "best food in the world", "best fruit in the world", "best dish in the world",
        "best restaurant in the world", "rankings of the best", "greatest food",
        "top food in the world", "food in this world", "fruit in this world",
    ]

    ORDER_RESIDUE_FILLER = {
        "i", "id", "i'd", "im", "i'm", "can", "could", "would", "want", "wanna",
        "wanted", "like", "to", "for", "me", "us", "the", "a", "an", "some",
        "please", "kindly", "now", "just", "yes", "okay", "ok", "sure",
        "do", "does", "you", "your", "make", "start", "begin", "new",
        "place", "order", "orders", "any", "get", "give", "have", "need",
        "let", "take", "buy", "add", "my", "our", "this", "that", "these",
        "those", "it", "its", "it's", "am", "are", "is", "was", "will",
        "say", "said", "tell", "also", "too", "and", "or", "with",
    }

    SPOKEN_DIGIT_WORDS: Dict[str, str] = {
        "zero": "0", "oh": "0", "o": "0",
        "one": "1", "two": "2", "three": "3", "four": "4",
        "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    }

    # Stricter email regex used by validators (no leading/trailing dots, sane TLD).
    _EMAIL_STRICT = re.compile(
        r'^[a-zA-Z0-9](?:[a-zA-Z0-9._%+\-]{0,62}[a-zA-Z0-9])?'
        r'@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?'
        r'(?:\.[a-zA-Z]{2,24})+$'
    )

    @staticmethod
    def _validate_email(value: Optional[str]) -> tuple:
        """
        Returns (ok, normalized_email, reason).

        Rules:
            - Must contain exactly one '@'.
            - Local part 1-64 chars, no leading/trailing dot, no '..'.
            - Domain has at least one dot, valid TLD (2-24 letters).
            - Lower-cased on success.
        """
        raw = (value or "").strip().strip(",.;:")
        if not raw:
            return (False, None, "missing")
        if " " in raw:
            return (False, None, "spaces_in_email")
        if raw.count("@") != 1:
            return (False, None, "needs_one_at_sign")
        local, _, domain = raw.partition("@")
        if not local or local.startswith(".") or local.endswith(".") or ".." in local:
            return (False, None, "bad_local_part")
        if "." not in domain:
            return (False, None, "missing_tld")
        if not AgentRuntime._EMAIL_STRICT.match(raw):
            return (False, None, "invalid_format")
        return (True, raw.lower(), "ok")

    @staticmethod
    def _validate_phone(value: Optional[str], currency: str = "USD") -> tuple:
        """
        Returns (ok, normalized_digits, reason).

        Rules:
            - All non-digit characters are stripped (parens, dashes, '+').
            - Pakistani agents (currency=PKR): exactly 11 digits starting with '03'.
            - Other markets: exactly 11 digits (matches the user's spec).
            - Country-code prefixes are tolerated: '+92 300...' becomes '03001234567'
              when the leading '92' looks like Pakistan's country code.
        """
        raw = (value or "").strip()
        if not raw:
            return (False, None, "missing")

        digits = re.sub(r'\D', '', raw)
        if not digits:
            return (False, None, "no_digits")

        # Tolerate country-code prefixes for Pakistani numbers entered as
        # "+92 300 1234567" → strip leading 92 and re-insert the leading 0.
        if (currency or "USD").upper() == "PKR":
            if digits.startswith("92") and len(digits) == 12:
                digits = "0" + digits[2:]
            elif digits.startswith("0092") and len(digits) == 14:
                digits = "0" + digits[4:]

            # Voice STT often drops the leading 0 ("0333…" → "333…").
            if len(digits) == 10 and digits.startswith("3"):
                digits = "0" + digits

            if len(digits) != 11:
                return (False, None, "wrong_length_pkr")
            if not digits.startswith("03"):
                return (False, None, "must_start_with_03")
            return (True, digits, "ok")

        # International: strip a leading country-code if present and length is 12-13.
        if len(digits) in (12, 13):
            digits = digits[-11:]

        if len(digits) != 11:
            return (False, None, "wrong_length")
        return (True, digits, "ok")

    LEAD_NAME_PHRASES = [
        "my name is ", "i'm ", "im ", "i am ", "call me ",
        "this is ", "name's ", "names ",
    ]
    LEAD_CONTACT_PHRASES = [
        "reach me at", "contact me at", "my email is", "my phone is",
        "my number is", "email me at", "you can reach me",
        "send it to", "send me", "text me at",
        "my email", "my phone", "my contact",
    ]
    LEAD_INTEREST_PHRASES = [
        "interested in", "looking for", "i need", "i want",
        "i'm looking", "im looking", "looking to",
        "can you help with", "need help with",
        "want to know about", "tell me about pricing",
        "how much", "what's the price", "what is the cost",
        "do you offer", "do you have", "is there",
        "sign me up", "sign up", "get started",
        "book", "schedule", "appointment", "consultation",
        "demo", "trial", "quote",
    ]

    def __init__(self, model_name: Optional[str] = None) -> None:
        # Model selection is now handled by llm_provider.py
        self.model_name = model_name or os.environ.get("LLM_MODEL", "llama3.2")

    def _invoke_with_fallback(
        self,
        prompt: str,
        temperature: float = 0.1,
        max_tokens: int = 1024,
        system_message: Optional[str] = None,
    ) -> str:
        """Delegate to unified LLM provider (Groq with Ollama fallback).

        ``system_message`` is sent as a real system role on Groq (better
        instruction-following) and prepended for Ollama (the best it supports).
        """
        return invoke_llm(
            prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            system_message=system_message,
        )

    @staticmethod
    def _history_to_text(history: List[Dict[str, str]], limit: Optional[int] = None) -> str:
        """
        Render conversation history as text for the LLM prompt.

        If ``limit`` is provided, only the last ``limit`` messages are rendered
        (each turn is 2 messages: user + assistant). When ``limit`` is None the
        full passed-in history is rendered - callers that have already sliced
        the history (e.g. ``_extract_order_items``) should leave it as None.
        """
        if not history:
            return "No prior conversation."
        sliced = history if limit is None else history[-limit:]
        rendered = []
        for entry in sliced:
            role = "User" if entry.get("role") == "user" else "Assistant"
            rendered.append(f"{role}: {entry.get('content', '').strip()}")
        return "\n".join(rendered)

    @staticmethod
    def _safe_parse_json(block: str) -> Dict[str, Any]:
        try:
            start = block.find("{")
            end = block.rfind("}")
            if start == -1 or end == -1:
                return {}
            return json.loads(block[start : end + 1])
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _is_closing_statement(text: str) -> bool:
        normalized = text.lower().strip()
        if not normalized:
            return False
        # Also create a punctuation-stripped version for matching
        clean = re.sub(r'[,.\?!;:]+', '', normalized).strip()
        clean = re.sub(r'\s+', ' ', clean)

        # Exact closing phrases
        # NOTE: Only GENUINE goodbye phrases belong here.
        # Bare acknowledgements (ok, thanks, cool, alright, got it) are EXCLUDED
        # because they are normal mid-conversation responses, NOT closing signals.
        # On voice calls, a false closing = call hangup = terrible UX.
        closing_exact = {
            "bye", "goodbye", "bye bye", "good bye", "byee", "byeee",
            "cheers", "cheers thanks", "thanks bye", "thank you bye",
            "thanks", "thank you", "thanku", "thnx", "thx",
            "ok thanks", "okay thanks", "ok thank you", "okay thank you",
            "that's all", "thats all", "that is all",
            "no that's all", "no thats all", "no that is all",
            "nothing else", "nothing more", "that's it", "thats it",
            "no thanks", "no thank you", "nah thanks",
            "i'm good", "im good", "i'm fine", "im fine",
            "that's all i need", "thats all i need",
            "cool thanks", "great thanks", "perfect thanks",
            "alright thanks", "alright thank you",
            "got it thanks",
            # Explicit call-ending commands
            "end the call", "end call", "hang up", "hangup",
            "disconnect", "cut the call", "drop the call",
            "please end", "please hang up", "stop the call",
            "close the call", "end this call", "terminate the call",
        }

        # Patterns that indicate closing/postponement (substring match)
        closing_patterns = [
            "maybe later", "some other time", "another time", "any other day",
            "not right now", "not now",
            "will call later", "call back later", "call you later",
            "will come back", "i'll come back", "ill come back",
            "talk later", "catch you later", "see you later",
            "that will be all", "that would be all",
            "have a good", "have a nice", "take care",
            "good night", "good day",
            # Explicit end-call patterns
            "end the call", "hang up now", "please disconnect",
            "thanks for the call", "thank you for the call",
            "we're done", "were done", "all done", "i'm done", "im done",
            "nothing more for me", "no more questions", "that's enough", "thats enough",
            "i'm all set", "im all set", "we're all set", "were all set",
            "so long", "see ya", "cheerio",
            "have to go", "gotta go", "need to run", "got to go",
            "appreciate it", "much appreciated",
        ]

        words = clean.split()
        if len(words) > 10:
            return False

        # Clarification questions — not a hangup ("is that it?")
        if clean.startswith("is that it") or clean.startswith("was that it"):
            return False

        # Short utterances containing "that's it" / "that is it" (e.g. "okay that's it thank you")
        if len(words) <= 14:
            if any(seg in clean for seg in ("that's it", "thats it", "that is it")):
                return True

        # Exact match (try both raw and punctuation-stripped)
        if normalized in closing_exact or clean in closing_exact:
            return True

        # Fuzzy match for common typos (Levenshtein distance 1-2)
        # Require longer prefix match (5 chars) to avoid false positives
        for phrase in closing_exact:
            if len(phrase) >= 5 and len(clean) >= 5:
                # Require 5-char prefix match + similar length + few words
                if (clean[:5] == phrase[:5] and
                    abs(len(clean) - len(phrase)) <= 2 and
                    len(words) <= 3):
                    return True

        # Prefix match (e.g. "thanks a lot" starts with "thanks")
        if any(clean.startswith(p) and len(clean) < len(p) + 12
               for p in closing_exact):
            return True

        # Pattern/substring match for postponement phrases
        if any(p in clean for p in closing_patterns):
            return True

        # Compound closing: contains closing keyword + farewell
        # e.g. "no that's all you have a great day"
        has_closing_keyword = any(kw in clean for kw in [
            "thats all", "that is all", "no thanks", "no thank you",
            "bye", "goodbye", "nothing else",
            "that's it", "thats it", "that is it",
            "we're done", "were done", "all done", "i'm done", "im done",
        ])
        has_farewell = any(fw in clean for fw in [
            "great day", "good day", "nice day", "take care",
            "have a good", "have a nice", "have a great",
        ])
        if has_closing_keyword or has_farewell:
            return True

        return False

    @staticmethod
    def _is_explicit_end_call_request(query: str) -> bool:
        clean = re.sub(r"[,\.\?!;:]+", " ", (query or "").lower()).strip()
        clean = re.sub(r"\s+", " ", clean)
        if not clean:
            return False
        markers = (
            "end the call",
            "end call",
            "hang up",
            "hangup",
            "disconnect",
            "close the call",
            "terminate the call",
            "stop the call",
        )
        return any(m in clean for m in markers)

    @staticmethod
    def _closing_message(config: AgentConfig) -> str:
        persona_name = config.persona.get("name") if config.persona else None
        agent_name = persona_name or config.name or "our team"
        return f"Happy to help! If you need anything else, {agent_name} is here for you."

    def _is_completeness_request(self, query: str) -> bool:
        """Detect if the user is asking for ALL information (e.g. 'complete menu', 'full list')."""
        normalized = query.lower()
        return any(kw in normalized for kw in self.COMPLETENESS_KEYWORDS)

    @staticmethod
    def _is_question(query: str) -> bool:
        lowered = query.lower().strip()
        if "?" in lowered:
            return True
        starters = (
            "what", "when", "where", "who", "why", "how", "can", "could", "do", "does",
            "is", "are", "will", "which", "tell me", "explain", "list", "show",
        )
        if lowered.startswith(starters):
            return True
        # Info-request patterns anywhere in the message
        info_patterns = [
            "let me know", "tell me about", "know about", "inform me",
            "what are the", "what is the", "what type", "what kind",
            "what options", "available options", "what flavors", "what flavours",
        ]
        return any(p in lowered for p in info_patterns)

    @staticmethod
    def _is_menu_availability_question(query: str) -> bool:
        """Menu inventory questions ('do you have sweets?') are not lead-capture triggers."""
        lowered = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        lowered = re.sub(r"\s+", " ", lowered)
        if not AgentRuntime._is_question(query):
            return False
        patterns = (
            "do you have", "do you sell", "do you offer", "do you carry",
            "is there a", "is there any", "are there any", "any of the",
            "got any", "have any",
        )
        return any(p in lowered for p in patterns)

    @staticmethod
    def _is_info_only_pushback(query: str) -> bool:
        """Caller is pushing back on order/lead collection — stay in Q&A mode."""
        n = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        n = re.sub(r"\s+", " ", n)
        phrases = (
            "for what order", "not ordering", "not here to order", "not placing",
            "just asking", "only asking", "menu and other", "talk about menu",
            "about the menu", "not here to give", "don't want to give",
            "dont want to give", "won't give", "wont give", "without giving",
            "not giving my phone", "no phone number", "just information",
            "just info", "no order", "what order",
        )
        return any(p in n for p in phrases)

    @staticmethod
    def _last_user_topic(history: List[Dict[str, str]]) -> str:
        for entry in reversed(history):
            if entry.get("role") != "user":
                continue
            content = (entry.get("content") or "").strip()
            if not content:
                continue
            words = re.findall(r"[a-zA-Z0-9']+", content.lower())
            if len(words) >= 2:
                return " ".join(words[:8])
        return ""

    def _classify_intent(self, query: str, history: List[Dict[str, str]], order_state: Optional[Dict] = None) -> str:
        # Strip punctuation from STT output (Twilio adds "." "," etc.)
        normalized = re.sub(r'[,\.\?!;:]+', '', query.lower().strip()).strip()
        normalized = re.sub(r'\s+', ' ', normalized)  # collapse multiple spaces
        words = set(normalized.split())
        word_list = normalized.split()

        # Off-menu / non-restaurant requests — always Q&A, never order capture.
        off_menu_hints = (
            "sneaker", "sneakers", "apartment", "condo", "real estate",
            "go on a date", "on a date", "property", "bitcoin", "crypto",
        )
        if any(h in normalized for h in off_menu_hints):
            return "question"
        is_awaiting_details = (order_state and order_state.get("status") == "awaiting_details"
                               and order_state.get("items"))
        has_active_order = (order_state and order_state.get("status") in ("collecting", "reviewing")
                           and order_state.get("items"))
        has_collecting_no_items = (
            order_state
            and order_state.get("status") == "collecting"
            and not order_state.get("items")
        )

        # Order already submitted — soft goodbyes must hang up, not become generic Q&A.
        if order_state and order_state.get("status") == "submitted":
            if self._is_closing_statement(query):
                return "closing"

        # --- When awaiting customer details, most messages are detail submissions ---
        if is_awaiting_details:
            # Cancel always wins
            if any(p in normalized for p in self.ORDER_CANCEL_PHRASES):
                return "order_cancel"
            # Check for corrections - user wants to modify their order items
            # e.g. "no I just want one burger", "only the Zinger", "remove chicken burger"
            correction_signals = [
                "only ", "just one", "just the ", "single ",
                "remove", "don't want", "dont want", "didn't order", "didnt order",
                "i said ", "i only ", "not the ", "wrong ",
            ]
            negation_plus_item = normalized.startswith("no ") and len(word_list) > 3
            has_correction = any(s in normalized for s in correction_signals) or negation_plus_item
            if has_correction:
                # Also check for modify phrases
                if any(p in normalized for p in self.ORDER_MODIFY_PHRASES):
                    return "order_modify"
                # "No I just wanted single burger" → order_modify
                return "order_modify"
            # Questions / info requests during awaiting_details - user wants info before proceeding
            # e.g. "can you tell me the ingredients?", "I am asking for the ingredients", "what is in the pizza?"
            info_request_patterns = [
                "asking for", "asking about", "tell me", "let me know",
                "ingredients", "what about", "what is", "what are",
                "information", "info about", "details about",
                "how much", "price of", "cost of", "describe",
            ]
            is_info_request = (
                (self._is_question(query) and len(word_list) > 3)
                or any(p in normalized for p in info_request_patterns)
            )
            if is_info_request:
                return "question"
            # Takeaway/delivery answer during detail collection (not a KB question)
            order_type_words = [
                "takeaway", "take away", "take-away", "pickup", "pick up",
                "delivery", "deliver", "dine in", "dine-in", "eat in", "eat here",
            ]
            if any(w in normalized for w in order_type_words) and not self._is_question(query):
                return "order_details"
            # The user is providing their name/phone/address - don't classify as anything else
            return "order_details"

        # --- Helper: check if message has a quantity+item pattern (e.g. "20 packs of panadol") ---
        has_quantity_pattern = bool(self.ORDER_QUANTITY_PATTERN.search(normalized))
        # Also check for digits followed by product-like words
        has_digit_item = bool(re.search(r'\b\d+\s+\w+', normalized)) and len(word_list) <= 8

        # --- Order intents take priority when an order is active ---
        if has_active_order:
            if any(p in normalized for p in self.MENU_INFO_PHRASES):
                return "question"
            # Cancel always wins
            if any(p in normalized for p in self.ORDER_CANCEL_PHRASES):
                return "order_cancel"
            # Explicit confirm phrases
            if any(p in normalized for p in self.ORDER_CONFIRM_PHRASES):
                return "order_confirm"
            # Fuzzy confirm: common misspellings of "confirm"/"place"
            if words.intersection(self.ORDER_CONFIRM_FUZZY):
                return "order_confirm"
            # "place" as standalone word during active order → confirm
            if "place" in words and len(words) <= 5:
                return "order_confirm"
            # "just [this/these/that/X]" or "just place" → confirm
            if "just" in words and len(words) <= 8 and not any(p in normalized for p in self.ORDER_TRIGGER_PHRASES):
                # Check for order-related words following 'just'
                if words.intersection({"place", "placed", "this", "these", "that", "it", "done"}):
                    return "order_confirm"
                if len(words) <= 4:
                    return "order_confirm"
            # Short affirmative words during active order when assistant asked for confirmation
            if self._last_assistant_asked_confirm(history):
                if words.intersection(self.ORDER_CONFIRM_SHORT):
                    return "order_confirm"
            # Short affirmative words even without explicit confirm question
            # covers "yes", "yeah", "ok" when assistant was discussing order details
            if len(words) <= 4 and words.intersection({"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "perfect", "correct", "right"}):
                if self._last_assistant_discussed_order(history):
                    return "order_confirm"
            # "What about the hot and sour soup as well?" → add item, not Q&A.
            if self._looks_like_add_item_request(query):
                return "order_add"
            if self._looks_like_add_to_cart(query):
                return "order_add"
            if self._looks_like_cart_total_question(query):
                return "order_status"
            if self._looks_like_order_payment_or_type(query) and not self._is_menu_availability_question(query):
                return "order_details"
            # Modify
            if any(p in normalized for p in self.ORDER_MODIFY_PHRASES):
                return "order_modify"
            # Correction: "only"/"single" = user restricting order to specific items
            # e.g. "No that's only the Zinger", "only 1 burger", "single burger"
            if ("only" in words or "single" in words) and not any(w in normalized for w in ["add", "also", "plus", "too", "another", "extra"]):
                return "order_modify"
            # Correction: "just" + explicit quantity = correcting the count/items
            # e.g. "just to order 1 Burger", "I am just using 1 Zinger Burger"
            if "just" in words and any(w.isdigit() for w in word_list):
                if not any(w in normalized for w in ["add", "also", "plus", "more", "another", "extra"]):
                    return "order_modify"
            # CLOSING detection during active order - user wants to end
            # "no thanks that's all", "that's all have a great day", "bye" etc.
            if self._is_closing_statement(query):
                # User wants to leave → treat as order_confirm to finalize
                return "order_confirm"
            # Add more items
            if any(p in normalized for p in self.ORDER_TRIGGER_PHRASES):
                return "order_add"
            if any(normalized.startswith(p) for p in self.ORDER_ITEM_PHRASES):
                return "order_add"
            # Numeric quantity patterns (e.g. "20 packs of panadol")
            if has_quantity_pattern or has_digit_item:
                return "order_add"
            # If it's a question, check if it's about confirming the order or something else
            if self._is_question(query):
                if self._looks_like_cart_total_question(query):
                    return "order_status"
                if self._looks_like_order_payment_or_type(query) and not self._is_menu_availability_question(query):
                    return "order_details"
                # Only treat as order_confirm for SHORT questions specifically about confirming/placing
                # NOT long questions that incidentally mention "order" ("before proceeding to order, tell me about...")
                confirm_q_words = {"confirm", "cnfirm", "confirmed", "cnfirmed", "place", "placed", "status"}
                if words.intersection(confirm_q_words) and len(word_list) <= 10:
                    return "order_confirm"
                return "question"  # Genuine question (ingredients, info, etc.) - let RAG answer
            # Short non-question messages while ordering → likely adding items
            if len(words) <= 6 and normalized not in self.NAVIGATIONAL_QUERIES:
                return "order_add"
            # Default: stay in order context, don't fall through to closing
            return "order_add"

        # --- Collecting flow with empty cart (item phrase may be split across STT turns) ---
        if has_collecting_no_items:
            if any(p in normalized for p in self.MENU_INFO_PHRASES):
                return "question"
            if any(p in normalized for p in self.ORDER_CANCEL_PHRASES):
                return "order_cancel"
            # General questions win over order_add heuristics (e.g. "what do you guys sell?").
            if self._is_question(query) and len(word_list) > 3:
                return "question"
            if self._is_info_only_pushback(query):
                return "question"
            # Item-naming phrases stay order_add even when phrased as questions.
            if self._utterance_names_order_item(query):
                return "order_add"
            if self._looks_like_add_to_cart(query):
                return "order_add"
            if any(p in normalized for p in self.ORDER_TRIGGER_PHRASES):
                return "order_add"
            if has_quantity_pattern or has_digit_item:
                return "order_add"
            if any(p in normalized for p in self.ORDER_CONFIRM_PHRASES):
                return "order_confirm"
            if words.intersection(self.ORDER_CONFIRM_FUZZY):
                return "order_confirm"
            if "just" in words and len(words) <= 8:
                if words.intersection({"this", "these", "that", "it", "done", "place"}):
                    return "order_confirm"
            if len(words) <= 10 and normalized not in self.NAVIGATIONAL_QUERIES:
                return "order_add"
            return "order_add"

        # --- Non-order or no active order path ---

        # Check if there are orphaned order items (order not yet submitted)
        has_pending_items = (order_state and order_state.get("items")
                            and order_state.get("status") not in ("submitted", "idle", None))

        # Confirm/cancel/modify only make sense if there are pending order items
        if has_pending_items:
            if any(p in normalized for p in self.MENU_INFO_PHRASES):
                return "question"
            if self._looks_like_cart_total_question(query):
                return "order_status"
            if self._looks_like_order_payment_or_type(query) and not self._is_menu_availability_question(query):
                return "order_details"
            if self._looks_like_add_to_cart(query) or self._looks_like_add_item_request(query):
                return "order_add"
            if self._looks_like_place_order_confirm(query):
                return "order_confirm"
            if any(p in normalized for p in self.ORDER_CANCEL_PHRASES):
                return "order_cancel"
            if any(p in normalized for p in self.ORDER_CONFIRM_PHRASES):
                return "order_confirm"
            if words.intersection(self.ORDER_CONFIRM_FUZZY):
                return "order_confirm"
            if any(p in normalized for p in self.ORDER_MODIFY_PHRASES):
                return "order_modify"

        # Order triggers - phrases like "wanted to order" should start an order
        # But skip if user is clearly asking for information ("can I get to know about your menu")
        _info_override = any(ip in normalized for ip in [
            "know about", "tell me about", "let me know", "about your menu",
            "about the menu", "information about", "info about", "details about",
            "to know", "about your", "available options", "what options",
        ])
        if any(p in normalized for p in self.ORDER_TRIGGER_PHRASES) and not _info_override:
            return "order_add"
        if self._looks_like_add_to_cart(query) and not _info_override:
            return "order_add"
        if any(normalized.startswith(p) for p in self.ORDER_ITEM_PHRASES) and len(word_list) <= 12:
            if not self._is_menu_availability_question(query):
                return "order_add"
        # "order" as standalone word in short messages with ordering context
        # e.g. "it's an order", "order please", "yes order"
        if "order" in words and len(word_list) <= 6 and not self._is_question(query):
            return "order_add"
        # Numeric quantity patterns even without active order (e.g. "20 packs of panadol")
        # But not when user is asking a question ("Do you have only 2 flavors?")
        if has_quantity_pattern and not self._is_question(query):
            return "order_add"

        # Completeness request - "list all pizzas", "name all flavors", "all options"
        # Check early so it doesn't get swallowed by contextual order detection
        if self._is_completeness_request(query):
            return "complete_request"

        # --- Contextual order detection ---
        # If the last assistant message was offering SPECIFIC items to choose from,
        # and the user responds with a short item-selection phrase, treat as order_add.
        # BUT if the user is asking for information, keep it as question.
        if history and self._last_assistant_offered_items(history):
            # User is selecting an item from what was offered
            if not self._is_closing_statement(query) and not self._is_question(query):
                # Exclude info-seeking patterns that aren't item selections
                info_seeking = any(p in normalized for p in [
                    "looking for", "interested in", "know about", "about your",
                    "information", "not interested", "not ordering",
                    "just information", "just info",
                ])
                if not info_seeking and len(word_list) <= 12:
                    return "order_add"

        # Also catch "the X" / "just X" / "only X" patterns as item selection
        if history and len(word_list) <= 8:
            starts_with_selection = any(normalized.startswith(p) for p in [
                "the ", "just ", "only ", "i'll go with", "ill go with",
                "i'll take", "ill take", "i want the", "gimme ", "give me the",
                "let me get the", "that ", "this ",
            ])
            if starts_with_selection and self._last_assistant_offered_items(history):
                return "order_add"

        # Closing detection
        if self._is_closing_statement(query):
            return "closing"

        # --- Bare acknowledgement / refusal detection ---
        # Short words like "ok", "no", "sure", "alright" that are NOT closing
        # and NOT navigational should be treated as acknowledgements.
        # This prevents the agent from dumping random topics when user just says "ok".
        BARE_ACKNOWLEDGEMENTS = {
            "ok", "okay", "no", "nope", "nah", "sure", "alright",
            "got it", "understood", "cool", "fine", "right",
            "noted", "hmm", "hm", "ah", "oh", "i see",
            "not really", "not now", "not yet",
        }
        if normalized in BARE_ACKNOWLEDGEMENTS or (len(word_list) <= 2 and normalized in {"no", "nope", "nah", "yes", "yeah", "yep"}):
            if self._last_assistant_asked_yesno(history):
                return "acknowledgement"
            if len(word_list) <= 2:
                return "acknowledgement"

        if self._is_completeness_request(query):
            return "complete_request"
        if any(hint in normalized for hint in self.NAVIGATION_HINTS) or normalized in self.NAVIGATIONAL_QUERIES:
            return "navigation"
        # Use word-level match for single words, substring for phrases
        is_chitchat = (words.intersection(self.CHITCHAT_WORDS) or
                       any(p in normalized for p in self.CHITCHAT_PHRASES))
        if is_chitchat and len(words) <= 5:
            return "smalltalk"
        if self._looks_like_add_to_cart(query) and not _info_override:
            return "order_add"
        if self._looks_like_place_order_confirm(query) and has_pending_items:
            return "order_confirm"
        if self._is_question(query):
            return "question"
        if len(words) <= 3 and history:
            return "acknowledgement"
        return "question"

    @staticmethod
    def _last_assistant_asked_yesno(history: List[Dict[str, str]]) -> bool:
        """Check if the last assistant message asked a yes/no question."""
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").lower()
                yesno_signals = [
                    "would you like", "do you want", "shall i", "should i",
                    "interested in", "ready to", "anything else",
                    "something else", "is there anything", "can i help",
                    "want me to", "like to know", "like to order",
                    "like to try", "like to see", "like to hear",
                    "?",
                ]
                return any(signal in content for signal in yesno_signals)
            if entry.get("role") == "user":
                break
        return False

    @staticmethod
    def _last_assistant_offered_items(history: List[Dict[str, str]]) -> bool:
        """Check if the last assistant message was offering SPECIFIC items to choose from.
        Must be a genuine selection prompt (which one? / choose from these) - not just
        mentioning food categories or asking general questions."""
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").lower()
                # Only genuine selection prompts where user should pick an item
                offer_signals = [
                    "which one", "which pizza", "which burger", "which item",
                    "which would you", "which do you", "which of these",
                    "choose from", "to choose",
                    "would you like to order",
                    "can i get you", "what can i get",
                ]
                return any(signal in content for signal in offer_signals)
            if entry.get("role") == "user":
                break
        return False

    @staticmethod
    def _last_assistant_asked_confirm(history: List[Dict[str, str]]) -> bool:
        """Check if the last assistant message asked the user to confirm an order."""
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").lower()
                # Only SPECIFIC confirmation signals - NOT offering signals
                # "would you like to order" is OFFERING items, NOT asking for confirmation.
                # "deliver"/"delivery" alone is too broad, matches item offering.
                confirm_signals = [
                    "confirm your order", "confirm the order", "shall i confirm",
                    "place the order", "place your order", "shall i place",
                    "ready to place", "go ahead and place",
                    "anything else", "something else", "add anything",
                    "finalize", "submit", "that everything",
                    "is that all", "is that correct", "is that right",
                    "would you like to confirm", "would you like to place",
                    "would you like to proceed", "would you like to finalize",
                    "cash on delivery", "pay via", "payment method",
                    "would you like to pay", "how would you like to pay",
                    "provide your", "your address", "your name", "your phone",
                    "may i have your", "can i get your",
                ]
                return any(signal in content for signal in confirm_signals)
            if entry.get("role") == "user":
                break
        return False

    @staticmethod
    def _last_assistant_discussed_order(history: List[Dict[str, str]]) -> bool:
        """Check if the last assistant message was discussing order details (price, delivery, payment)."""
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").lower()
                # Only signals that mean the assistant was summarizing/discussing an existing order
                # NOT offering items or asking what to order
                order_signals = [
                    "pkr", "rs.", "rs ", "$", "€", "£",
                    "your order", "order summary", "order total",
                    "delivery address", "delivery charge",
                    "cash on delivery", "pay via", "payment",
                    "total comes to", "total is", "subtotal",
                    "anything else to add", "confirm your order",
                ]
                return any(signal in content for signal in order_signals)
            if entry.get("role") == "user":
                break
        return False

    @staticmethod
    def _was_last_response_closing(history: List[Dict[str, str]]) -> bool:
        """Check if the last assistant message was a closing/goodbye message.
        ONLY check the last 200 characters to avoid matching greetings like
        'I'd be happy to help you with your order' which contain closing phrases.
        """
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").lower()
                # Only check the TAIL of the message - a genuine closing ends with
                # the closing phrase, a greeting/helpful response has it in the middle.
                tail = content[-200:] if len(content) > 200 else content
                # Also skip if message is long (>300 chars) - closing messages are short
                if len(content) > 300:
                    return False
                closing_signals = [
                    "happy to help!", "glad to help!", "glad i could help",
                    "here for you", "here to help",
                    "goodbye", "bye bye", "take care",
                    "have a great", "have a good", "have a nice",
                ]
                # Removed "anything else" and "need anything" - too generic,
                # they appear in order confirmation prompts causing false closing.
                return any(signal in tail for signal in closing_signals)
            if entry.get("role") == "user":
                break
        return False

    @staticmethod
    def _shingles(text: str, n: int = 5) -> set:
        """N-gram shingle set over content tokens - used for near-duplicate detection."""
        tokens = re.findall(r"[a-zA-Z0-9']+", (text or "").lower())
        if len(tokens) < n:
            return set()
        return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}

    @staticmethod
    def _dedupe_chunks_against_history(
        context_text: str,
        history: Optional[List[Dict[str, str]]],
        max_history_msgs: int = 4,
        overlap_threshold: float = 0.6,
    ) -> str:
        """
        Drop retrieved-context blocks that have already been substantially shared
        in recent assistant messages. Prevents the LLM from re-serving identical
        catalog/menu/policy text turn after turn.

        Uses 5-word shingles for fuzzy matching. If a chunk's shingle set
        overlaps ≥ overlap_threshold with the union of recent assistant shingles,
        the chunk is dropped.

        If ALL chunks would be dropped, the original context is returned -
        better stale info than no info.
        """
        if not context_text or context_text == "No relevant context found." or not history:
            return context_text

        recent_assistant: List[str] = []
        for entry in reversed(history):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").strip()
                if content:
                    recent_assistant.append(content)
                    if len(recent_assistant) >= max_history_msgs:
                        break
        if not recent_assistant:
            return context_text

        history_shingles: set = set()
        for msg in recent_assistant:
            history_shingles |= AgentRuntime._shingles(msg, n=5)
        if not history_shingles:
            return context_text

        parts = [p for p in context_text.split("\n\n---\n\n") if p.strip()]
        kept: List[str] = []
        dropped = 0
        for part in parts:
            chunk_shingles = AgentRuntime._shingles(part, n=5)
            if not chunk_shingles:
                kept.append(part)
                continue
            overlap = len(chunk_shingles & history_shingles) / len(chunk_shingles)
            # Only drop near-duplicate chunks (≥ 0.85 overlap). The old 0.60 threshold
            # was too aggressive: chunks partially mentioned in history (e.g. a menu item
            # the agent listed in its previous turn) were being dropped, causing the agent
            # to deny items it had just confirmed when the user followed up on them.
            if overlap >= max(overlap_threshold, 0.85):
                dropped += 1
                continue
            kept.append(part)

        if dropped:
            print(f"[RAG] History-dedup dropped {dropped}/{len(parts)} chunks "
                  f"(threshold={overlap_threshold})")

        if not kept:
            return context_text
        return "\n\n---\n\n".join(kept)

    @staticmethod
    def _merge_contexts(contexts: List[str], max_blocks: int = 10) -> str:
        blocks: List[str] = []
        seen = set()

        for ctx in contexts:
            if not ctx or ctx.strip() == "No relevant context found.":
                continue
            parts = [part.strip() for part in ctx.split("\n\n---\n\n") if part.strip()]
            for part in parts:
                fingerprint = part[:220].lower()
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                blocks.append(part)
                if len(blocks) >= max_blocks:
                    return "\n\n---\n\n".join(blocks)

        return "\n\n---\n\n".join(blocks) if blocks else "No relevant context found."

    # Pronouns / referring expressions that signal the query depends on prior context.
    _COREF_TOKENS = {
        "it", "its", "that", "this", "these", "those",
        "they", "them", "their", "there",
        "one", "ones", "same", "another",
        "him", "her", "his", "hers",
    }

    def _query_needs_rewrite(self, query: str, history: List[Dict[str, str]]) -> bool:
        """Decide whether a query is ambiguous enough to benefit from LLM rewriting."""
        if not history:
            return False
        normalized = query.lower().strip()
        words = re.findall(r"[a-zA-Z']+", normalized)
        if not words:
            return False
        # Short queries are usually follow-ups
        if len(words) <= 4:
            return True
        # Contains a coreference / referring expression
        if any(w in self._COREF_TOKENS for w in words):
            return True
        # Navigational / continuation queries
        if normalized in self.NAVIGATIONAL_QUERIES:
            return True
        if any(hint in normalized for hint in self.NAVIGATION_HINTS):
            return True
        return False

    def _rewrite_query_with_context(
        self,
        query: str,
        history: List[Dict[str, str]],
    ) -> str:
        """
        Rewrite a possibly-ambiguous follow-up query into a self-contained search
        query using the recent conversation. Resolves coreferences like "it",
        "that one", "the burger" by replacing them with the entity actually
        referenced in the prior turns.

        Falls back to the original query on any error or implausible output.
        Costs one cheap LLM call (≈300-500ms with Groq).
        """
        if os.environ.get("DISABLE_QUERY_REWRITE", "").lower() in ("1", "true", "yes"):
            return query
        if not self._query_needs_rewrite(query, history):
            return query

        recent_text = self._history_to_text(history[-8:], limit=8)

        prompt = (
            "You rewrite a customer's latest message into a single, self-contained "
            "search query suitable for a knowledge-base retrieval. Resolve every "
            "pronoun or referring expression (\"it\", \"that one\", \"the burger\") "
            "into the actual entity from the conversation. Keep the query specific "
            "and short.\n\n"
            f"CONVERSATION:\n{recent_text}\n\n"
            f"CUSTOMER'S LATEST MESSAGE: {query}\n\n"
            "Output ONLY the rewritten query - 3 to 15 words, no quotes, no "
            "preamble, no explanation."
        )

        try:
            raw = invoke_llm(prompt=prompt, temperature=0.0, max_tokens=60)
        except Exception as e:
            print(f"[QUERY REWRITE] LLM error, falling back to original: {e}")
            return query

        rewritten = (raw or "").strip()
        # Strip surrounding quotes / trailing punctuation the model may add
        rewritten = re.sub(r'^["\'\s]+|["\'\s.,;:!?]+$', "", rewritten)
        # Take only the first line - the model occasionally adds explanation below
        rewritten = rewritten.splitlines()[0].strip() if rewritten else ""
        # Sanity bounds: 1–25 words, non-empty, not the same as the original
        word_count = len(rewritten.split())
        if not rewritten or word_count < 1 or word_count > 25:
            return query
        if rewritten.lower() == query.lower().strip():
            return query

        print(f"[QUERY REWRITE] '{query}' → '{rewritten}'")
        return rewritten

    def _build_retrieval_queries(
        self,
        query: str,
        history: List[Dict[str, str]],
        intent: str,
        channel: str = "chat",
    ) -> List[str]:
        """
        Build retrieval queries. Minimized: 1 query for simple questions,
        2 for navigation, 2-3 only for completeness requests.
        Fewer queries = fewer embedding calls = lower latency.

        For CHAT channel only, ambiguous follow-ups are rewritten via a small
        LLM call to resolve coreferences. Voice skips this for latency.
        """
        queries: List[str] = []
        topic = self._last_user_topic(history)
        # Chat: try LLM-based rewriter for ambiguous follow-ups; otherwise fall
        # back to the heuristic synthesizer. Voice always uses the heuristic.
        if channel == "chat":
            rewritten = self._rewrite_query_with_context(query, history)
            synthesized = (
                rewritten if rewritten and rewritten != query
                else self._synthesize_search_query(query, history)
            )
        else:
            synthesized = self._synthesize_search_query(query, history)

        if intent == "complete_request":
            # Completeness: cast a wide net (2-3 queries)
            queries.extend([
                synthesized,
                "all services products policies information",
            ])
            if topic:
                queries.append(f"complete details {topic}")
        elif intent == "navigation":
            # Navigation: synthesized + original (max 2)
            queries.append(synthesized)
            if synthesized.lower() != query.lower():
                queries.append(query)
        elif intent == "smalltalk":
            # Smalltalk: single broad retrieval is enough
            queries.append(query)
        else:
            # Standard question: use original query (1 query usually sufficient)
            queries.append(query)
            # Only add synthesized if it's meaningfully different
            if synthesized.lower() != query.lower() and len(synthesized.split()) > 2:
                queries.append(synthesized)

        # Deduplicate
        deduped: List[str] = []
        seen = set()
        for candidate in queries:
            cleaned = " ".join(candidate.split()).strip()
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(cleaned)
        return deduped[:3]

    def _synthesize_search_query(self, query: str, history: List[Dict[str, str]]) -> str:
        """
        Convert vague/navigational queries into a specific search query for RAG.
        Uses ZERO LLM calls - pure heuristic for instant results.

        For substantive queries: return as-is.
        For navigational/short queries: derive from conversation context.
        """
        normalized = query.lower().strip()

        # If user wants everything, return a broad query
        if self._is_completeness_request(query):
            print(f"[QUERY SYNTHESIS] Completeness request - broad query")
            return "all items services information"

        # If the query is substantive (>4 words, not navigational), use it directly
        if normalized not in self.NAVIGATIONAL_QUERIES and len(query.split()) > 4:
            return query

        # Short but specific (1-4 words, not navigational) - treat as a topic keyword
        if normalized not in self.NAVIGATIONAL_QUERIES and len(query.split()) >= 1:
            # e.g. "maincourse", "drinks", "pricing" → use directly as search
            topic = self._last_user_topic(history) if history else ""
            if topic and normalized not in topic:
                expanded = f"{query} {topic}"
                print(f"[QUERY SYNTHESIS] Short topic + context: '{query}' → '{expanded}'")
                return expanded
            return query

        # For navigational queries ("next", "proceed", "continue"), derive from history
        if not history:
            return query

        topic = self._last_user_topic(history)
        if topic:
            synthesized = f"more information about {topic}"
            print(f"[QUERY SYNTHESIS] Navigation + topic: '{query}' → '{synthesized}'")
            return synthesized

        # Last resort: extract keywords from recent assistant response
        for entry in reversed(history[-6:]):
            if entry.get("role") == "assistant":
                content = (entry.get("content") or "").strip()
                # Extract key nouns from the last response (first 200 chars)
                words = re.findall(r"[a-zA-Z]{4,}", content[:200].lower())
                # Remove common words
                stopwords = {"this", "that", "with", "from", "have", "been", "will", "would", "could",
                             "your", "they", "them", "their", "about", "what", "which", "when",
                             "here", "there", "also", "more", "like", "just", "than", "very",
                             "some", "other", "each", "only", "into"}
                keywords = [w for w in words if w not in stopwords][:5]
                if keywords:
                    synthesized = " ".join(keywords)
                    print(f"[QUERY SYNTHESIS] Navigation from assistant context: '{query}' → '{synthesized}'")
                    return synthesized
                break

        return query

    def plan(self, config: AgentConfig, query: str, history_text: str) -> Dict[str, Any]:
        """
        Fast heuristic planner - NO LLM call needed.
        Determines domain membership and close intent using pattern matching.
        This eliminates ~5-8s latency from the old LLM-based planner.
        """
        is_closing = self._is_closing_statement(query)

        # Out-of-domain heuristic: only flag clearly unrelated requests
        OUT_OF_DOMAIN_PATTERNS = [
            "write me a poem", "write a poem", "write me a story",
            "explain quantum", "what is the meaning of life",
            "tell me a joke", "sing a song", "play a game",
            "what's the weather", "translate this",
        ]
        normalized = query.lower().strip()
        out_of_domain = any(p in normalized for p in OUT_OF_DOMAIN_PATTERNS) and len(normalized.split()) <= 10

        plan_result = {
            "in_domain": not out_of_domain,
            "domain_reason": "Heuristic: out-of-domain pattern matched" if out_of_domain else "Heuristic: assuming in-domain",
            "should_close": is_closing,
            "closing_reason": "User signaled end of conversation" if is_closing else "",
        }
        print(f"[PLANNER] in_domain={plan_result['in_domain']}, should_close={plan_result['should_close']} (heuristic, 0ms)")
        return plan_result

    # Phrases that indicate a GENERAL wish to order (no specific items yet)
    GENERIC_ORDER_PHRASES = [
        "place an order", "place order", "place my order",
        "make an order", "want to order", "wanna order", "wanted to order",
        "like to order", "can i order", "order for me", "order please",
        "it's an order", "its an order", "an order for me",
        "start an order", "begin an order", "new order",
        "i'd like to order", "id like to order",
        "can you place an order", "place an order for me",
    ]

    def _is_generic_order_request(self, query: str) -> bool:
        """Check if the user is asking to order in general WITHOUT naming specific items.

        Returns True only if a generic ordering phrase ("place an order", "i'd like to order",
        etc.) is present AND there is no substantive content remaining once that phrase is
        stripped. This prevents false positives like "i want to place an order for bbq platter"
        where the user named a specific item alongside the generic phrase.
        """
        normalized = query.lower().strip()
        words = normalized.split()
        if len(words) > 10:
            return False
        if not any(p in normalized for p in self.GENERIC_ORDER_PHRASES):
            return False

        # Strip the longest matching generic phrase, then check what's left.
        residue = normalized
        for phrase in sorted(self.GENERIC_ORDER_PHRASES, key=len, reverse=True):
            if phrase in residue:
                residue = residue.replace(phrase, " ", 1)
                break

        # Drop filler words that often accompany generic phrases.
        residue_tokens = re.findall(r"[a-zA-Z0-9']+", residue.lower())
        substantive = [
            t for t in residue_tokens
            if t not in self.ORDER_RESIDUE_FILLER and len(t) >= 3
        ]
        # If there's any substantive word left, the user named something specific -
        # not a generic request.
        return len(substantive) == 0

    def _substantive_item_tokens(self, text: str) -> List[str]:
        tokens = re.findall(r"[a-zA-Z0-9']+", (text or "").lower())
        return [
            t for t in tokens
            if t not in self.ORDER_RESIDUE_FILLER and len(t) >= 3
        ]

    def _strip_order_item_residue(self, query: str) -> str:
        """Remove generic order wrappers and return the likely item phrase."""
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower()).strip()
        normalized = re.sub(r"\s+", " ", normalized)
        if not normalized:
            return ""

        wrappers = sorted(
            {
                *self.GENERIC_ORDER_PHRASES,
                *self.ORDER_TRIGGER_PHRASES,
                "place the order for",
                "place order for",
                "can i place an order for",
                "i want to order the",
                "i would like the",
                "order the",
                "get the",
                "want the",
                "for the",
                "what about the",
                "how about the",
                "what about",
                "how about",
                "also the",
                "and also the",
                "can i also get",
                "can i also have",
            },
            key=len,
            reverse=True,
        )
        residue = normalized
        for phrase in wrappers:
            if phrase in residue:
                residue = residue.replace(phrase, " ", 1)
        residue = re.sub(r"\bas well\b", " ", residue)
        residue = re.sub(r"\s+", " ", residue).strip(" ,.")
        tokens = self._substantive_item_tokens(residue)
        return " ".join(tokens)

    def _looks_like_add_item_request(self, query: str) -> bool:
        """Detect add-another-item phrasing during an active cart."""
        normalized = query.lower().strip()
        if not any(p in normalized for p in self.ORDER_ALSO_PHRASES):
            return False
        info_only = [
            "delivery time", "opening hours", "your location", "payment method",
            "refund", "return policy", "wifi", "parking",
        ]
        if any(p in normalized for p in info_only):
            return False
        return self._utterance_names_order_item(query)

    @staticmethod
    def _looks_like_add_to_cart(query: str) -> bool:
        """Detect explicit add-to-cart phrasing (voice STT often drops 'I want')."""
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        normalized = re.sub(r"\s+", " ", normalized)
        if AgentRuntime._is_info_only_pushback(query):
            return False
        add_patterns = (
            "add ", "please add", "put in the cart", "in the cart", "in my cart",
            "to my order", "to the order", "to my cart", "to the cart",
            "can you add", "could you add", "also want", "want to add",
            "help me place an order", "help me order", "help me with an order",
        )
        if any(p in normalized for p in add_patterns):
            if "how to add" in normalized or "how do i add" in normalized:
                return False
            return True
        if any(normalized.startswith(p) for p in AgentRuntime.ORDER_ITEM_PHRASES):
            return True
        return False

    @staticmethod
    def _looks_like_cart_total_question(query: str) -> bool:
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        normalized = re.sub(r"\s+", " ", normalized)
        patterns = (
            "how much is", "how much would", "what's the total", "whats the total",
            "what is the total", "total so far", "cart total", "order total",
            "final total", "final cart", "how did the total", "what do i owe",
            "what's my total", "whats my total", "breakdown", "what am i paying",
            "how much do i", "cost so far", "current total", "running total",
            "what would the total", "how much will it",
        )
        if any(p in normalized for p in patterns):
            return True
        words = normalized.split()
        return "total" in words and len(words) <= 10

    @staticmethod
    def _looks_like_place_order_confirm(query: str) -> bool:
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        normalized = re.sub(r"\s+", " ", normalized)
        words = set(normalized.split())
        if any(p in normalized for p in AgentRuntime.ORDER_CONFIRM_PHRASES):
            return True
        if words.intersection(AgentRuntime.ORDER_CONFIRM_FUZZY):
            return True
        if "place" in words and "order" in words:
            return True
        return normalized.startswith("okay place") or normalized.startswith("ok place")

    @staticmethod
    def _looks_like_order_payment_or_type(query: str) -> bool:
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        normalized = re.sub(r"\s+", " ", normalized)
        if AgentRuntime._is_question(query) and len(normalized.split()) > 6:
            if not any(
                w in normalized
                for w in ("cash on delivery", "cod", "takeaway", "pickup", "pay cash")
            ):
                return False
        type_words = (
            "cash on delivery", "cod", "pay on delivery", "pay cash",
            "takeaway", "take away", "pickup", "pick up", "pick-up",
            "delivery", "deliver", "dine in", "dine-in", "eat in",
            "card payment", "pay by card", "online payment",
        )
        return any(w in normalized for w in type_words)

    @staticmethod
    def _is_global_general_question(query: str) -> bool:
        normalized = re.sub(r"\s+", " ", (query or "").lower()).strip()
        return any(p in normalized for p in AgentRuntime.GLOBAL_GENERAL_QUESTION_PATTERNS)

    def _utterance_names_order_item(self, query: str) -> bool:
        """True when the utterance names a specific item, not just 'place an order'."""
        if self._is_generic_order_request(query):
            return False
        residue = self._strip_order_item_residue(query)
        return len(self._substantive_item_tokens(residue)) >= 1

    def _resolve_order_catalog_context(
        self,
        context: str,
        agent_id: Optional[str],
        tenant_id: Optional[str],
    ) -> str:
        blob = context or ""
        if agent_id and tenant_id:
            full_catalog = self._get_cached_catalog(agent_id, tenant_id)
            if full_catalog:
                blob = f"{full_catalog}\n\n{blob}" if blob else full_catalog
        return blob

    def _get_menu_index(
        self,
        agent_id: Optional[str],
        tenant_id: Optional[str],
        order_state: Optional[Dict] = None,
    ) -> Optional[MenuIndex]:
        if not agent_id or not tenant_id:
            return None
        idx = MenuIndex.from_order_state(agent_id, tenant_id, order_state)
        if not idx.items:
            idx.warm_from_catalog()
        if idx.currency and idx.currency != "PKR":
            sym = self.CURRENCY_SYMBOLS.get(idx.currency, self._currency_symbol)
            if not getattr(self, "_lock_workspace_currency", False):
                self._current_currency = idx.currency
                self._currency_symbol = sym
        return idx

    def _render_voice_menu_summary(
        self,
        idx: MenuIndex,
        *,
        max_items: Optional[int] = None,
    ) -> str:
        cap = max_items or self.VOICE_MENU_SPOKEN_MAX
        sym = "Rs." if idx.currency == "PKR" else self.CURRENCY_SYMBOLS.get(idx.currency, "$")
        sorted_items = sorted(idx.items.values(), key=lambda x: x.name.lower())
        spoken = sorted_items[:cap]
        parts = [f"{it.name} for {sym}{it.price:.0f}" for it in spoken]
        if not parts:
            return ""
        if len(sorted_items) > cap:
            extra = len(sorted_items) - cap
            lead = ", ".join(parts[:-1]) + f", and {parts[-1]}" if len(parts) > 1 else parts[0]
            return (
                f"Here's a taste of our menu: {lead}. "
                f"We have {extra} more items — name any dish to order, or ask about a category."
            )
        if len(parts) == 1:
            return f"We have {parts[0]} on the menu. Would you like to add it to your order?"
        lead = ", ".join(parts[:-1]) + f", and {parts[-1]}"
        return f"On our menu we have {lead}. What would you like to order?"

    def _is_menu_info_request(self, query: str) -> bool:
        normalized = re.sub(r"[,\.\?!;:]+", "", (query or "").lower()).strip()
        normalized = re.sub(r"\s+", " ", normalized)
        return any(p in normalized for p in self.MENU_INFO_PHRASES)

    def _try_catalog_match_items(
        self,
        query: str,
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        order_state: Optional[Dict] = None,
    ) -> List[Dict[str, Any]]:
        idx = self._get_menu_index(agent_id, tenant_id, order_state)
        if idx:
            idx.ensure_context(order_state, kb_context=context)
            matched, unmatched = idx.fuzzy_match_all(
                query, strip_residue=self._strip_order_item_residue,
            )
            if order_state is not None:
                if unmatched:
                    order_state["_last_unmatched_phrases"] = unmatched
                else:
                    order_state.pop("_last_unmatched_phrases", None)
            if matched:
                return matched

        catalog_blob = self._resolve_order_catalog_context(context, agent_id, tenant_id)
        if not catalog_blob:
            return []
        hit = self._catalog_fuzzy_match_items(query, catalog_blob)
        if hit:
            return hit
        residue = self._strip_order_item_residue(query)
        if residue and residue != query.strip().lower():
            return self._catalog_fuzzy_match_items(residue, catalog_blob)
        return []

    def _apply_items_to_order_state(
        self,
        order_state: Dict,
        new_items: List[Dict[str, Any]],
        combined_query: str,
        intent: str,
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> bool:
        if not new_items:
            return False
        order_state.pop("pending_item_phrase", None)
        order_state.pop("pending_item_phrase_at", None)
        self._enrich_items_prices(
            new_items, context, agent_id=agent_id, tenant_id=tenant_id,
            order_state=order_state,
        )
        for item in new_items:
            if not item.get("quantity"):
                item["quantity"] = 1

        normalized_q = combined_query.lower()
        if intent == "order_modify":
            if any(w in normalized_q for w in ["remove", "take off", "no more", "without"]):
                remove_names = {
                    self._normalize_menu_text(i.get("name", "")) for i in new_items
                }
                order_state["items"] = [
                    i for i in order_state.get("items", [])
                    if self._normalize_menu_text(i.get("name", "")) not in remove_names
                ]
            elif any(w in normalized_q for w in ["only", "just", "single", "no i", "instead"]):
                order_state["items"] = new_items
            else:
                order_state.setdefault("items", []).extend(new_items)
        elif any(w in normalized_q for w in ["only", "just", "instead", "not that", "change to"]):
            order_state["items"] = new_items
        else:
            order_state.setdefault("items", []).extend(new_items)

        order_state["items"] = self._dedupe_order_items(order_state.get("items", []))
        order_state["status"] = "collecting"
        return True

    def _render_order_fragment_prompt(
        self,
        combined_query: str,
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> str:
        near = self._try_catalog_match_items(
            combined_query,
            context,
            agent_id=agent_id,
            tenant_id=tenant_id,
            order_state=None,
        )
        if near:
            name = near[0].get("name", "that item")
            return f"Did you mean the {name}? Say yes to add it, or tell me the full item name."
        residue = self._strip_order_item_residue(combined_query)
        if residue:
            return (
                f"I caught {residue} — what's the full item name from our menu?"
            )
        return "What item would you like to add?"

    # Browsing patterns: user is asking ABOUT items, not ordering them
    BROWSING_PATTERNS = [
        "looking for", "interested in", "tell me about", "what do you have",
        "show me", "do you have", "any options for", "what kind of",
        "what types of", "what flavors", "what flavours",
        "anything in", "any good", "recommend",
    ]

    # Currency markers in order of specificity (checked against catalog context text)
    _CURRENCY_CONTEXT_PATTERNS: List[tuple] = [
        ("PKR", "Rs.", re.compile(r'Rs\.?\s*[\d,]|PKR\s*[\d,]|\bRs\b')),
        ("INR", "₹",   re.compile(r'₹\s*[\d,]|INR\s*[\d,]')),
        ("EUR", "€",   re.compile(r'€\s*[\d,]|EUR\s*[\d,]')),
        ("GBP", "£",   re.compile(r'£\s*[\d,]|GBP\s*[\d,]')),
        ("AED", "AED ", re.compile(r'AED\s*[\d,]')),
        ("SAR", "SAR ", re.compile(r'SAR\s*[\d,]')),
    ]

    def _sync_currency_from_context(self, context: str) -> None:
        """Optional catalog auto-detect — disabled when workspace currency is locked."""
        if getattr(self, "_lock_workspace_currency", False):
            return
        if os.environ.get("ALLOW_CURRENCY_AUTO_DETECT", "").lower() not in ("1", "true", "yes"):
            return
        if not context:
            return
        for code, sym, pattern in self._CURRENCY_CONTEXT_PATTERNS:
            if pattern.search(context):
                if self._current_currency != code:
                    print(f"[CURRENCY] Auto-detected {code} from catalog context (was {self._current_currency})")
                    self._current_currency = code
                    self._currency_symbol = sym
                return  # stop at first match

    @staticmethod
    def _voice_plain(text: str) -> str:
        """Strip markdown emphasis so Azure TTS does not speak asterisks aloud."""
        if not text:
            return text
        return re.sub(r"\*\*([^*]+)\*\*", r"\1", text)

    def _normalize_menu_text(self, text: str) -> str:
        t = re.sub(r"[,\.\?!;:]+", "", (text or "").lower()).strip()
        t = re.sub(r"\s+", " ", t)
        for pattern, repl in self.STT_MENU_PHRASE_FIXES:
            t = re.sub(pattern, repl, t)
        return " ".join(self.MENU_SYNONYMS.get(w, w) for w in t.split())

    @staticmethod
    def _looks_like_item_fragment(text: str) -> bool:
        """True only when STT likely cut off mid-phrase — not for complete item names."""
        if not text or len(text) > 120:
            return False
        n = re.sub(r"[,\.\?!;:]+", "", (text or "").lower()).strip()
        n = re.sub(r"\s+", " ", n)
        if not n:
            return False

        # Clearly incomplete tails — user was interrupted before naming the item.
        if re.search(
            r"\b(for the|for a|order for|like to order for|place an order for|"
            r"i want|i need|give me|get me|can i get|let me get)\s*$",
            n,
        ):
            return True
        if re.search(r"\b(and|the|a|an|with|for|mix|hot|sour)\s*$", n):
            return True
        if n.startswith("and ") and len(n.split()) <= 4:
            return True

        words = n.split()
        # Single very short token stub (e.g. "mix", "the") — wait for continuation.
        if len(words) == 1 and len(words[0]) <= 4:
            return True
        return False

    @staticmethod
    def _looks_like_phone_fragment(text: str) -> bool:
        """Partial spoken phone — merge across STT turns before validating."""
        if not text or len(text) > 80:
            return False
        low = text.lower().strip()
        if re.search(r"\b(triple|double|zero|oh|o)\b", low):
            return True
        if re.search(
            r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\b",
            low,
        ):
            return True
        digits = re.sub(r"\D", "", text)
        return 1 <= len(digits) <= 10

    def _dedupe_order_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Merge duplicate line items by normalized name."""
        merged: Dict[str, Dict[str, Any]] = {}
        for item in items:
            key = self._normalize_menu_text(item.get("name", ""))
            if not key:
                continue
            if key in merged:
                merged[key]["quantity"] = int(merged[key].get("quantity") or 1) + int(
                    item.get("quantity") or 1
                )
            else:
                merged[key] = dict(item)
        return list(merged.values())

    def _build_combined_order_query(
        self,
        query: str,
        order_state: Dict,
        history: List[Dict[str, str]],
    ) -> str:
        """Merge pending item phrase + current utterance without corrupting corrections."""
        _ = history  # kept for call-site compatibility
        q = query.strip()
        pending = (order_state.get("pending_item_phrase") or "").strip()

        if not pending:
            return q

        pending_norm = self._normalize_menu_text(pending)
        q_norm = self._normalize_menu_text(q)

        # New utterance supersedes pending when it's a correction or full re-statement.
        if q_norm == pending_norm:
            combined = q
        elif pending_norm in q_norm or q_norm in pending_norm:
            combined = q if len(q) >= len(pending) else pending
        elif self._utterance_names_order_item(q):
            combined = q
        else:
            combined = re.sub(r"\s+", " ", f"{pending} {q}").strip()

        if combined != q:
            print(f"[ORDER] Combined query: '{query}' + pending -> '{combined}'")
        return combined

    def _spoken_digit_char(self, token: str) -> str:
        t = (token or "").strip().lower()
        if t.isdigit() and len(t) == 1:
            return t
        return self.SPOKEN_DIGIT_WORDS.get(t, "")

    def _parse_spoken_phone(self, query: str, currency: str = "USD") -> Optional[str]:
        """
        Parse voice phone numbers: 03331234567, '0 triple 3 1 2 3 4 5 6 7', digit-by-digit, etc.
        """
        raw = (query or "").strip()
        if not raw:
            return None

        low = raw.lower()
        # Strip country-code spoken prefixes
        low = re.sub(r"\b(?:plus\s*)?(?:nine\s*two|92)\b", " ", low)
        low = re.sub(r"\bcountry\s*code\b", " ", low)

        # Expand triple/double digit words before tokenisation
        def _expand_repeat(match: re.Match) -> str:
            count = 3 if match.group(1) == "triple" else 2
            digit = self._spoken_digit_char(match.group(2))
            return digit * count if digit else match.group(0)

        low = re.sub(r"\b(triple|double)\s+(\w+)\b", _expand_repeat, low)

        # Fast path: already mostly digits (e.g. '03331234567')
        digit_run = re.sub(r"\D", "", low)
        if len(digit_run) >= 10:
            ok, val, _ = self._validate_phone(digit_run, currency=currency)
            if ok:
                return val

        digits: List[str] = []
        for tok in re.findall(r"\w+", low):
            if tok.isdigit():
                digits.extend(list(tok))
            elif len(tok) == 1 and tok.isdigit():
                digits.append(tok)
            else:
                ch = self._spoken_digit_char(tok)
                if ch:
                    digits.append(ch)

        if not digits:
            return None

        candidate = "".join(digits)
        ok, val, reason = self._validate_phone(candidate, currency=currency)
        if ok:
            print(f"[ORDER] Spoken phone parsed: '{query}' -> {val}")
            return val
        print(f"[ORDER] Spoken phone rejected ({reason}): '{query}' -> {candidate}")
        return None

    def _extract_menu_entries_from_text(self, text: str) -> List[tuple]:
        """Parse menu item names from catalog blobs OR RAG prose (PKR/Rs formats)."""
        if not text:
            return []
        entries: List[tuple] = []
        seen: set = set()
        price_tail = r"(?:\$|€|£|₹|Rs\.?\s*|PKR\s*|AED\s*|SAR\s*)(\d+(?:[.,]\d{1,2})?)"

        for line in text.split("\n"):
            line = line.strip()
            if not line or len(line) < 4:
                continue

            name: Optional[str] = None
            price: float = 0.0

            m = re.match(rf"^[•\-\*]?\s*(.+?):\s*{price_tail}", line, re.I)
            if m:
                name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
            if not name:
                m = re.match(rf"^(.+?)\s+for\s+{price_tail}\b", line, re.I)
                if m:
                    name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
            if not name:
                m = re.match(rf"^(.+?)\s*[-–—]\s*{price_tail}\b", line, re.I)
                if m:
                    name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
            if not name:
                m = re.match(r"^(.+?)\s*[-–—]\s*(\d+(?:\.\d{1,2})?)\s*$", line)
                if m:
                    name, price = m.group(1).strip(), float(m.group(2))

            if not name or len(name) < 2:
                continue
            name = re.sub(r"\s+", " ", name).strip(" ,.")
            key = self._normalize_menu_text(name)
            if key in seen:
                continue
            seen.add(key)
            entries.append((name, key, price))

        # RAG answers often embed items inline: "French Fries for PKR 350, Hot & Sour Soup for PKR 450"
        inline_pat = re.compile(
            rf"([A-Za-z][A-Za-z0-9 &'/&/-]{{2,55}}?)\s+for\s+{price_tail}",
            re.I,
        )
        for m in inline_pat.finditer(text):
            name = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
            name = re.sub(
                r"^(?:we have|like|and|our|also|including|such as|starters? like|bbq items? like)\s+",
                "",
                name,
                flags=re.I,
            ).strip()
            price = float(m.group(2).replace(",", "."))
            key = self._normalize_menu_text(name)
            if key not in seen and len(name) >= 3:
                seen.add(key)
                entries.append((name, key, price))

        return entries

    def _ensure_order_menu_context(
        self,
        order_state: Optional[Dict],
        context: str,
        agent_id: Optional[str],
        tenant_id: Optional[str],
        context_provider: Optional[Callable[[str], str]] = None,
    ) -> str:
        """
        Build a menu blob for order extraction. Catalog API is authoritative when populated;
        otherwise reuse session cache or a lightweight RAG menu fetch (KB-only agents).
        """
        idx = self._get_menu_index(agent_id, tenant_id, order_state)
        if idx:
            rag_fetch = None
            if context_provider and agent_id and tenant_id:
                rag_fetch = lambda: context_provider("complete menu items with prices")
            blob = idx.ensure_context(order_state, kb_context=context, rag_fetch=rag_fetch)
            if blob and self._extract_menu_entries_from_text(blob):
                return blob

        parts: List[str] = []
        if agent_id and tenant_id:
            catalog = self._get_cached_catalog(agent_id, tenant_id)
            if catalog and self._extract_menu_entries_from_text(catalog):
                parts.append(catalog)
            elif not catalog:
                print(f"[ORDER] Catalog API empty for agent={agent_id} — using KB/RAG fallback")

        if order_state:
            session_blob = (order_state.get("_session_menu_blob") or "").strip()
            if session_blob and self._extract_menu_entries_from_text(session_blob):
                parts.append(session_blob)

        if context and self._extract_menu_entries_from_text(context):
            parts.append(context)

        merged = self._merge_contexts(parts)
        if merged and self._extract_menu_entries_from_text(merged):
            if order_state is not None:
                order_state["_session_menu_blob"] = merged
            return merged

        if context_provider and agent_id and tenant_id:
            try:
                rag_menu = context_provider("complete menu items with prices")
                if rag_menu and rag_menu != "No relevant context found.":
                    if self._extract_menu_entries_from_text(rag_menu):
                        print("[ORDER] Loaded menu from RAG fallback for order extraction")
                        if order_state is not None:
                            order_state["_session_menu_blob"] = rag_menu
                        return rag_menu
            except Exception as exc:
                print(f"[ORDER] RAG menu fallback failed: {exc}")

        return merged or context or ""

    def _catalog_fuzzy_match_items(self, query: str, context: str) -> List[Dict[str, Any]]:
        """
        Deterministic menu match for voice — avoids LLM JSON failures on short utterances.
        """
        if not query or not context:
            return []

        q_norm = self._normalize_menu_text(query)
        q_words = {w for w in q_norm.split() if len(w) > 1}
        if not q_words:
            return []

        parsed = self._extract_menu_entries_from_text(context)
        catalog_entries: List[tuple] = []
        for name, name_norm, price in parsed:
            name_words = {w for w in name_norm.split() if len(w) > 1}
            if name_words:
                catalog_entries.append((name, name_norm, name_words, price))

        if not catalog_entries:
            return []

        best_name: Optional[str] = None
        best_price: float = 0.0
        best_score = 0

        for name, name_norm, name_words, listed_price in catalog_entries:
            if name_norm in q_norm or q_norm in name_norm:
                score = 100 + len(name_norm)
            else:
                overlap = q_words & name_words
                if not overlap:
                    continue
                overlap_n = len(overlap)
                if overlap_n < 2:
                    only = next(iter(overlap))
                    if len(only) < 4:
                        continue
                coverage = overlap_n / max(len(q_words), 1)
                score = overlap_n * 25 + int(coverage * 30) + len(name_norm)
            if score > best_score:
                best_score = score
                best_name = name
                best_price = listed_price

        if not best_name and len(q_words) == 1:
            word = next(iter(q_words))
            if len(word) >= 4:
                matches = [
                    (n, p) for n, nn, _, p in catalog_entries if word in nn.split()
                ]
                if len(matches) == 1:
                    best_name, best_price = matches[0]
                    best_score = 80

        if not best_name or best_score < 55:
            return []

        price = best_price or self._match_price_from_context(best_name, context)
        print(f"[ORDER] Catalog fuzzy match (score={best_score}): '{query}' -> '{best_name}'")
        return [{"name": best_name, "quantity": 1, "price": price}]

    def _extract_order_items(
        self,
        query: str,
        history: List[Dict[str, str]],
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Use LLM + catalog fuzzy match to extract structured order items."""
        self._sync_currency_from_context(context)

        if self._is_generic_order_request(query):
            print(f"[ORDER] Generic order request detected, skipping item extraction: '{query}'")
            return []

        normalized_q = query.lower().strip()
        if any(p in normalized_q for p in self.BROWSING_PATTERNS):
            print(f"[ORDER] Browsing pattern detected, skipping item extraction: '{query}'")
            return []

        fuzzy = self._catalog_fuzzy_match_items(query, context or "")
        if fuzzy:
            return fuzzy

        catalog_blob = context or ""
        if agent_id and tenant_id:
            full_catalog = self._get_cached_catalog(agent_id, tenant_id)
            if full_catalog:
                catalog_blob = full_catalog + "\n\n" + catalog_blob
                fuzzy_full = self._catalog_fuzzy_match_items(query, catalog_blob)
                if fuzzy_full:
                    return fuzzy_full

        recent_turns = self._history_to_text(history[-6:]) if history else ""

        prompt = f"""Extract ONLY the specific product/food items the customer asked for in their MESSAGE below.

AVAILABLE ITEMS (from catalog/menu):
{catalog_blob}

CUSTOMER MESSAGE: {query}

CRITICAL RULES:
1. Extract ONLY items explicitly named in CUSTOMER MESSAGE — ignore all prior conversation.
2. Do NOT extract items just because they appear in the catalog unless the customer asked for them.
3. Generic "place an order" with NO item names → return [].
4. Category browsing only (e.g. "burgers") without a specific item → return [].
5. Match typos and voice variants (bbq/barbecue, mix/mixed, hot and sour soup).
6. Use EXACT item name from AVAILABLE ITEMS.
7. If a quantity is mentioned, use that quantity.
8. Return AT MOST 2 items unless the customer clearly lists more (e.g. "soup and pizza").

Return a JSON array. Each item:
- "name": exact catalog name
- "quantity": number (default 1)
- "price": number from catalog (0 if unknown)
- "options": optional array
- "notes": optional string

If no specific items were named, return: []

JSON ARRAY:"""

        def _parse_items(raw: str) -> List[Dict[str, Any]]:
            try:
                start = raw.find("[")
                end = raw.rfind("]")
                if start == -1 or end == -1:
                    return []
                items = json.loads(raw[start : end + 1])
                return items if isinstance(items, list) else []
            except (json.JSONDecodeError, ValueError):
                return []

        raw = invoke_llm(prompt, temperature=0.0, max_tokens=400)
        items = _parse_items(raw)
        if items:
            items = items[:3]
            print(f"[ORDER] LLM extracted {len(items)} item(s) from '{query[:60]}'")
            return items

        print(f"[ORDER] 8b extraction empty for '{query[:60]}' — retrying with order-extract model")
        raw_heavy = invoke_llm_order_extract(prompt, temperature=0.0, max_tokens=512)
        items = _parse_items(raw_heavy)
        if items:
            print(f"[ORDER] Order-extract model got {len(items)} item(s)")
        else:
            print(f"[ORDER] No items extracted for '{query[:80]}'")
        return items

    # Mapping from order_type value to human-readable payment label (payment methods come from KB)
    ORDER_TYPE_PAYMENT: dict = {
        "delivery": "Pay on delivery",
        "takeaway": "Pay on pickup",
        "dine-in": "Pay at restaurant",
    }

    # Default delivery charge for PKR (Pakistani) agents
    _DELIVERY_CHARGE_PKR: int = 175

    @staticmethod
    def _is_simple_affirmation(text: Optional[str]) -> bool:
        """Loose yes-detection after name confirmation (STT-tolerant)."""
        raw = (text or "").strip().lower()
        if not raw:
            return False
        n = re.sub(r"[,.?!;:]+", "", raw)
        n = re.sub(r"\s+", " ", n).strip()
        if not n:
            return False
        one_word_ok = {
            "yes", "yeah", "yep", "yup", "correct", "right", "sure",
            "ok", "okay", "affirmative", "indeed",
        }
        tokens = set(n.split())
        if n in {"mm hmm", "uh huh"}:
            return True
        if n in {
            "thats correct",
            "that is correct",
            "thats right",
            "that is right",
            "sounds correct",
            "sounds good",
            "sounds right",
        }:
            return True
        if tokens & one_word_ok and len(tokens) <= 3:
            return True
        if n.startswith("yes ") and len(tokens) <= 5:
            return True
        if n.endswith(" yes") or n.endswith(" yeah"):
            return True
        return False

    def _wants_skip_contact_detail(
        self,
        query: str,
        field: str,
        channel: str = "chat",
        order_state: Optional[Dict] = None,
    ) -> bool:
        """
        Detect when the user opts out of sharing phone/email/address on voice/chat.
        Kept conservative on bare \"no\" to avoid skipping on simple corrections.
        """
        if field == "phone" and not phone_skip_allowed(channel):
            return False
        if field == "address" and order_state and not address_skip_allowed(order_state, channel):
            return False

        n = re.sub(r"[,\.\?!;:]+", "", (query or "").lower().strip())
        n = re.sub(r"\s+", " ", n)
        words = n.split()
        if field == "email":
            if any(
                p in n
                for p in (
                    "skip",
                    "skip email",
                    "skip it",
                    "skip that",
                    "please skip",
                    "just skip",
                    "no email",
                    "without email",
                    "don't have email",
                    "dont have email",
                    "don't have an email",
                    "dont have an email",
                    "i have no email",
                    "no email address",
                    "not sharing my email",
                    "prefer not to say",
                    "rather not say",
                    "pass on email",
                    "forget it",
                    "never mind",
                    "rather not give",
                    "won't give email",
                    "wont give email",
                )
            ):
                return True
            if len(words) <= 3 and "skip" in words:
                return True
            if len(words) <= 6 and "skip" in n and "don" not in n:  # not "don't skip"
                return True
            return False

        if field == "phone":
            if any(
                p in n
                for p in (
                    "skip",
                    "skip phone",
                    "skip number",
                    "skip that",
                    "please skip",
                    "no phone",
                    "without phone",
                    "don't have phone",
                    "dont have phone",
                    "don't have a phone",
                    "dont have a phone",
                    "i have no phone",
                    "not sharing my number",
                    "pass on phone",
                    "pass on the number",
                )
            ):
                return True
            if "skip" in words and len(words) <= 6 and "don't skip" not in n and "dont skip" not in n:
                return True
            return False

        if field == "address":
            if any(
                p in n
                for p in (
                    "skip",
                    "skip address",
                    "skip the address",
                    "skip delivery address",
                    "skip that",
                    "please skip",
                    "no address",
                    "without address",
                    "don't have an address",
                    "dont have an address",
                    "no delivery address",
                    "not sharing address",
                    "forget it",
                    "never mind",
                )
            ):
                return True
            if "skip" in words and len(words) <= 8 and "don't skip" not in n and "dont skip" not in n:
                return True
            return False

        return False

    @staticmethod
    def _looks_like_skip_address_placeholder(text: Optional[str]) -> bool:
        """True if the 'address' is really an opt-out phrase (e.g. 'Skip the address')."""
        if not text or len(text.strip()) < 4:
            return False
        n = re.sub(r"[,\.\?!;:]+", "", text.lower().strip())
        n = re.sub(r"\s+", " ", n)
        digit_count = sum(1 for c in n if c.isdigit())
        if digit_count >= 2:
            return False
        markers = (
            "skip",
            "no address",
            "without address",
            "don't have",
            "dont have",
            "not giving",
            "rather not",
            "prefer not",
            "forget",
            "never mind",
        )
        return any(m in n for m in markers)

    def _parse_spoken_email(self, query: str) -> Optional[str]:
        """
        Turn phrases like \"name at gmail dot com\" / \"john dot doe at company dot co\"
        into a normal email for strict validation.
        """
        raw = (query or "").strip()
        if not raw or "@" in raw:
            return None
        low = raw.lower()
        if " at " not in low and not re.search(r"\s+at\s+", low):
            return None

        s = low
        s = re.sub(r"\s+underscore\s+", "_", s)
        s = re.sub(r"\s+dash\s+", "-", s)
        s = re.sub(r"\s+hyphen\s+", "-", s)
        s = re.sub(r"\s+dot\s+", ".", s)
        s = re.sub(r"\bdot\s+", ".", s)
        s = re.sub(r"\s+dot\b", ".", s)
        s = re.sub(r"\s+at\s+", "@", s)
        s = re.sub(r"\s+", "", s)
        if "@" not in s or "." not in s.split("@", 1)[-1]:
            return None
        ok, val, _ = self._validate_email(s)
        return val if ok else None

    def _extract_customer_details_fast(self, query: str, order_state: Dict) -> Optional[Dict[str, str]]:
        """
        Fast heuristic extraction of customer details - avoids LLM call for simple cases.

        Returns a dict with normalised values for whichever fields the user just
        provided. Phone and email are normalised through the strict validators;
        when the validator rejects the input, the raw input is still returned so
        the caller can re-prompt with a tailored error message.
        """
        normalized = query.strip()
        current_step = order_state.get("detail_step", "name")
        currency = getattr(self, "_current_currency", "USD")

        # Order-type detection (delivery / takeaway / dine-in)
        if current_step == "order_type":
            norm_lower = normalized.lower()
            if any(w in norm_lower for w in ["delivery", "deliver", "delivered"]):
                return {"order_type": "delivery"}
            if any(w in norm_lower for w in ["takeaway", "take away", "take-away",
                                              "pickup", "pick up", "pick-up",
                                              "to go", "collection", "collect"]):
                return {"order_type": "takeaway"}
            if any(w in norm_lower for w in ["dine in", "dine-in", "dinein",
                                              "eat in", "eat-in", "eat here",
                                              "here", "table", "dine"]):
                return {"order_type": "dine-in"}
            return None  # ambiguous - fall to LLM

        # Spoken email (voice): "name at gmail dot com"
        if current_step == "email":
            spoken_email = self._parse_spoken_email(normalized)
            if spoken_email:
                return {"email": spoken_email}

        # Email step or any message containing a clearly-formed email.
        if "@" in normalized:
            email_match = self.EMAIL_PATTERN.search(normalized)
            candidate = email_match.group(0) if email_match else normalized.split()[-1]
            ok, value, _reason = self._validate_email(candidate)
            if ok:
                return {"email": value}
            if current_step == "email":
                # Surface the raw candidate so caller can re-prompt.
                return {"email_invalid": candidate}

        # Phone number: detect digits or spoken formats ("0 triple 3 1 2 3…").
        if current_step == "phone" or re.match(r'^[\+]?[\d\s\-\(\)]{7,18}$', normalized):
            if current_step == "phone":
                pending_phone = (order_state.get("pending_phone_fragment") or "").strip()
                merged_phone = (
                    f"{pending_phone} {normalized}".strip()
                    if pending_phone
                    else normalized
                )
                spoken = self._parse_spoken_phone(merged_phone, currency=currency)
                if spoken:
                    order_state.pop("pending_phone_fragment", None)
                    return {"phone": spoken}
                if self._looks_like_phone_fragment(normalized) or (
                    pending_phone and len(re.sub(r"\D", "", merged_phone)) < 11
                ):
                    order_state["pending_phone_fragment"] = merged_phone
                    return {"phone_fragment_pending": True}
            ok, value, _reason = self._validate_phone(normalized, currency=currency)
            if ok:
                return {"phone": value}
            if current_step == "phone":
                bad = re.sub(r'\D', '', normalized)
                if not bad:
                    spoken_try = self._parse_spoken_phone(normalized, currency=currency)
                    if spoken_try:
                        return {"phone": spoken_try}
                    bad = re.sub(
                        r'\D', '',
                        ''.join(
                            self._spoken_digit_char(t) or t
                            for t in re.findall(r'\w+', normalized.lower())
                        ),
                    )
                return {"phone_invalid": bad or normalized}

        # Name: short phrase, no digits (allow longer South Asian compound names).
        words = normalized.split()
        if current_step == "name" and 0 < len(words) <= 8 and not any(c.isdigit() for c in normalized):
            if self._is_plausible_customer_name(normalized):
                return {"name": normalized}
            return None

        # Address: 2+ words and at least 3 alpha characters.
        if current_step == "address" and len(words) >= 2:
            if self._looks_like_skip_address_placeholder(normalized):
                return None
            alpha_chars = sum(1 for c in normalized if c.isalpha())
            if alpha_chars < 3:
                return None
            return {"address": normalized}

        # Ambiguous - fall back to LLM
        return None

    def _extract_customer_details(self, query: str, history: List[Dict[str, str]]) -> Dict[str, str]:
        """
        Extract customer details with the LLM - used only when the fast
        heuristic returns None. Validates phone/email before returning so we
        never persist garbage values to the order state.
        """
        recent_turns = self._history_to_text(history[-4:]) if history else ""
        currency = getattr(self, "_current_currency", "USD")

        prompt = f"""Extract customer contact details from the message below.

RECENT CONVERSATION:
{recent_turns}

CUSTOMER'S LATEST MESSAGE: {query}

Return a JSON object with any of these fields that you can find:
- "name": customer's name
- "phone": phone number (digits only)
- "email": email address
- "address": delivery/street address
- "order_type": "delivery", "takeaway", or "dine-in" - only if clearly stated

Only include fields that are clearly stated. Do NOT guess or invent details.
If the customer SPELLS an email verbally (e.g. "john at gmail dot com"), convert it to normal form (john@gmail.com) in the email field.
If no details are found, return an empty object: {{}}

JSON:"""

        raw = invoke_llm(prompt, temperature=0.0, max_tokens=256)
        parsed = self._safe_parse_json(raw)
        result: Dict[str, str] = {}
        for key in ("name", "order_type"):
            if parsed.get(key):
                val = str(parsed[key]).strip()
                if key == "name" and not self._is_plausible_customer_name(val):
                    continue
                result[key] = val

        if parsed.get("address"):
            addr = str(parsed["address"]).strip()
            if not self._looks_like_skip_address_placeholder(addr):
                result["address"] = addr

        if parsed.get("phone"):
            ok, value, _ = self._validate_phone(str(parsed["phone"]), currency=currency)
            if ok:
                result["phone"] = value
        if parsed.get("email"):
            ok, value, _ = self._validate_email(str(parsed["email"]))
            if ok:
                result["email"] = value
        if "email" not in result:
            spoken = self._parse_spoken_email(query)
            if spoken:
                result["email"] = spoken
        return result

    def _phone_validation_hint(self) -> str:
        """
        Technical wording for LLM / internal prompts only — not for verbatim TTS.
        """
        currency = getattr(self, "_current_currency", "USD")
        if currency == "PKR":
            return (
                "valid Pakistani mobile: exactly 11 digits starting with 03 "
                "(or +92… forms normalised upstream)"
            )
        return "valid phone: exactly 11 digits"

    def _phone_ask_spoken_fragment(self, include_skip_offer: bool, channel: str = "chat") -> str:
        """Natural wording for scripted replies asking for the caller's number."""
        currency = getattr(self, "_current_currency", "USD")
        if channel == "chat":
            skip = " Or type **skip** if you'd rather not share one." if include_skip_offer else ""
            if currency == "PKR":
                return "What's the best mobile number for your order? Just type it below." + skip
            return "What's the best phone number to reach you on? Just type it below." + skip
        # voice — phone is mandatory for orders; never offer skip
        skip = ""
        if currency == "PKR":
            return "What's the best mobile number for this order?"
        return "What's the best number to reach you on?"

    def _phone_invalid_spoken_fragment(
        self,
        include_skip_offer: bool,
        channel: str = "chat",
        digit_count: Optional[int] = None,
    ) -> str:
        """Natural apology + re-prompt when phone validation failed."""
        currency = getattr(self, "_current_currency", "USD")
        if channel == "chat":
            skip_tail = " Or type **skip**." if include_skip_offer else ""
            if currency == "PKR":
                return (
                    "Hmm, that doesn't look like a valid mobile number."
                    " Could you type the full number?" + skip_tail
                )
            return "Hmm, that number doesn't look right — could you type it again?" + skip_tail
        # voice — phone is mandatory; no skip on re-prompt
        skip_tail = ""
        count_hint = ""
        if digit_count is not None and digit_count > 0:
            need = "eleven" if currency == "PKR" else "eleven"
            count_hint = f" I counted {digit_count} digits — I need {need}. "
        if currency == "PKR":
            return (
                "Hmm, that didn't sound like a valid mobile number."
                + count_hint
                + " Could you say the full number again?"
                + skip_tail
            )
        return (
            "Hmm, that number didn't come through cleanly — could you try again slowly?"
            + skip_tail
        )

    @staticmethod
    def _is_plausible_customer_name(text: Optional[str]) -> bool:
        """Reject STT fragments misclassified as names (e.g. 'place your', 'top selling')."""
        if not text:
            return False
        n = re.sub(r"[,\.\?!;:]+", "", (text or "").lower()).strip()
        if not n or len(n.split()) > 8:
            return False
        if any(c.isdigit() for c in n):
            return False
        blocked = (
            "place your", "place the", "place an", "place order", "confirm",
            "order for", "can you", "can i", "hear me", "would like",
            "top selling", "mixed", "barbecue", "platter", "tell me",
            "where are", "located", "menu", "special",
            "what do you", "what do u", "like sir", "do you like",
        )
        if "?" in (text or ""):
            return False
        if AgentRuntime._is_question(text or ""):
            return False
        if any(p in n for p in blocked):
            return False
        if any(w in n.split() for w in ("order", "confirm", "hear", "located", "menu")):
            return False
        return True

    @staticmethod
    def _first_name(value: Optional[str]) -> str:
        """First whitespace-token of a name, title-cased. Empty string if blank."""
        if not value:
            return ""
        parts = str(value).strip().split()
        return parts[0].title() if parts else ""

    @staticmethod
    def _spelled_digit_tail(phone_normalized: Optional[str], last_n: int = 4) -> str:
        """Digits from the tail of the known-good phone, spaced for clearer TTS (caller-ID confirm)."""
        d = re.sub(r"\D", "", phone_normalized or "")
        if not d:
            return ""
        tail = d[-last_n:] if len(d) >= last_n else d
        return " ".join(tail)

    @staticmethod
    def _implies_other_number_than_network_line(text: Optional[str]) -> bool:
        if not text or len(text.strip()) < 2:
            return False
        n = re.sub(r"[,\.\?!;:]+", "", text.lower()).strip()
        n = re.sub(r"\s+", " ", n)
        if any(p in n for p in (
            "different number", "different phone", "not my number", "that's not mine",
            "that is not mine", "wrong number", "not this number", "another number",
            "someone else's", "borrowed phone", "use a different",
        )):
            return True
        if re.search(r"\bno\b", n) and any(w in n for w in ("number", "phone", "line", "that")):
            return True
        return False

    def _detail_reply_variant(self, summary: str, step: str) -> int:
        """Stable index 0..2 for rotating deterministic copy without RNG."""
        key = f"{step}|{(summary or '')[:160]}"
        h = hashlib.md5(key.encode("utf-8")).hexdigest()
        return int(h[:8], 16) % 3

    def _render_order_details_text(
        self,
        order_state: Dict,
        next_step: str,
        summary: str,
        invalid_field: Optional[str] = None,
        channel: str = "chat",
    ) -> str:
        """
        Build the EXACT customer-facing reply for deterministic order-detail
        steps (name → confirm caller line → …).
        """
        customer = order_state.get("customer", {}) or {}
        name_first = self._first_name(customer.get("name"))
        full_name = (customer.get("name") or "").strip()
        # Voice detail steps should not repeat the full cart every turn — only at review.
        voice_detail = channel == "voice" and next_step not in ("review",)
        recap = "" if voice_detail else summary

        if invalid_field == "phone":
            dc = order_state.get("last_phone_digit_count")
            return self._phone_invalid_spoken_fragment(
                include_skip_offer=True,
                channel=channel,
                digit_count=int(dc) if dc is not None else None,
            )
        if invalid_field == "email":
            if channel == "chat":
                return (
                    "That email doesn't look quite right. "
                    "Try again — type it like **name@gmail.com** — "
                    "or type **skip** to continue without an email."
                )
            return (
                "That email doesn't look quite right. "
                "Try again — say it like name at gmail.com — "
                "or say **skip** to continue without an email."
            )

        if next_step == "name":
            v = self._detail_reply_variant(recap, "name")
            if channel == "chat":
                bodies = [
                    (
                        f"Awesome — here's what we've got so far:\n\n{summary}\n\n"
                        "Could I get your full name?"
                    ),
                    (
                        f"Great — quick recap:\n\n{summary}\n\n"
                        "Who should I put this order under? Your full name, please."
                    ),
                    (
                        f"Perfect — so far:\n\n{summary}\n\n"
                        "May I have your full name as you'd like it on the order?"
                    ),
                ]
            else:
                bodies = [
                    "Who should I put this order under? Your full name, please.",
                    "May I have your full name for the order?",
                    "What name should go on this order?",
                ]
            return bodies[v]

        if next_step == "phone":
            v = self._detail_reply_variant(recap, "phone")
            tail = self._phone_ask_spoken_fragment(include_skip_offer=False, channel=channel)
            if channel == "voice":
                prefix = f"Thanks, {name_first}. " if name_first else "Thanks. "
                return prefix + tail
            if full_name:
                prefixes = [
                    f"I have **{full_name}** for the ticket — ",
                    f"Perfect — recording this as **{full_name}** — ",
                    f"Lovely — I'll use **{full_name}**. ",
                ]
            elif name_first:
                prefixes = [
                    f"Thanks, {name_first}! ",
                    f"Lovely — thanks, {name_first}. ",
                    f"Got it, {name_first}. ",
                ]
            else:
                prefixes = ["Got it. ", "Thanks! ", "Perfect. "]
            return prefixes[v] + tail

        if next_step == "email":
            v = self._detail_reply_variant(recap, "email")
            if channel == "chat":
                lines = [
                    (
                        "Thanks for that — what's your email for the receipt?"
                        " Type it like **sara@gmail.com**."
                        " Type **skip** if you'd rather not share one."
                    ),
                    (
                        "Perfect. Which email gets your receipt and updates?"
                        " Type it like **name@domain.com** — or type **skip**."
                    ),
                    (
                        "Lastly, an email for confirmations —"
                        " or type **skip** if you prefer not to."
                    ),
                ]
            else:
                lines = [
                    "What's your email for the receipt? Say skip if you'd rather not.",
                    "Which email should we send your receipt to? Or say skip.",
                    "An email for your confirmation — or say skip to continue without one.",
                ]
            return lines[v]

        if next_step == "order_type":
            v = self._detail_reply_variant(summary, "order_type")
            blocks = [
                "Got it. Would you like delivery, takeaway, or dine-in?",
                "How would you like this — delivery, takeaway, or dine-in?",
                "Almost there. Is this for delivery, takeaway, or dine-in?",
            ]
            return blocks[v]

        if next_step == "address":
            if channel == "chat":
                return (
                    "Sure thing — what's your full delivery address? "
                    "Type **skip** if you can't share one right now."
                )
            return (
                "What's your full delivery address? "
                "We'll need it to deliver your order."
            )

        if next_step == "review":
            self._sync_order_totals(order_state)
            order_type = (order_state.get("order_type") or "").lower()
            payment = self.ORDER_TYPE_PAYMENT.get(order_type, "Pay on delivery")
            voice_review = self._format_order_summary(
                order_state, channel=channel, for_review=(channel == "voice"),
            )
            if channel == "voice":
                # Two-part review: summary + confirm (supports barge-in skip on backend).
                order_state["_review_summary_line"] = voice_review
                order_state["_review_confirm_line"] = "Say yes to place your order."
                return voice_review
            header = (
                f"Here's a quick review of your order, {name_first}:"
                if name_first
                else "Here's a quick review of your order:"
            )
            lines = [header, "", summary, ""]
            if customer.get("name"):
                lines.append(f"Name: {customer['name']}")
            if customer.get("phone"):
                lines.append(f"Phone: {customer['phone']}")
            elif order_state.get("skip_phone_detail"):
                lines.append("Phone: (not provided)")
            if customer.get("email"):
                lines.append(f"Email: {customer['email']}")
            elif order_state.get("skip_email_detail"):
                lines.append("Email: (not provided)")
            if order_type:
                lines.append(f"Order Type: {order_type.title()}")
            if order_type == "delivery" and customer.get("address"):
                lines.append(f"Address: {customer['address']}")
            elif order_type == "delivery" and order_state.get("skip_address_detail"):
                lines.append("Address: (not provided)")
            lines.append(f"Payment: {payment}")
            lines.append("")
            confirm_cta = (
                "Does everything look right? Type **yes** to confirm and I'll place the order."
                if channel == "chat"
                else "Does everything look right? Just say **yes** to confirm and I'll place the order."
            )
            lines.append(confirm_cta)
            return "\n".join(lines)

        if next_step == "confirm_name":
            full = (customer.get("name") or "").strip()
            v = self._detail_reply_variant(summary, "confirm_name")
            if channel == "chat":
                prompts = [
                    (
                        f"I have **{full}** — is that right?"
                        " Type **yes** to continue, or type your correct name."
                    ),
                    (
                        f"Got it — I have **{full}**. Should I keep that spelling?"
                        " Type **yes**, or correct it below."
                    ),
                    (
                        f"Recording the name **{full}**."
                        " If that's right, type **yes** — otherwise correct it below."
                    ),
                ]
            else:
                prompts = [
                    (
                        f"I heard **{full}** — is that exactly right?"
                        " Say **yes** to continue, or say your correct name slowly."
                    ),
                    (
                        f"Got it — I have **{full}**. Should I keep that spelling?"
                        " Say **yes**, or spell your name clearly if I misheard anything."
                    ),
                    (
                        f"Recording the name **{full}**."
                        " If that's perfect, say **yes** — otherwise tell me how it should sound."
                    ),
                ]
            return prompts[v] if full else ""

        if next_step == "confirm_email":
            email = (customer.get("email") or "").strip()
            v = self._detail_reply_variant(recap, "confirm_email")
            if channel == "chat":
                prompts = [
                    f"I have **{email}** — is that correct? Type **yes** or correct it.",
                    f"Got it — **{email}**. Right spelling? Type **yes** or fix it below.",
                ]
            else:
                prompts = [
                    f"I have {email} on file — is that correct? Say yes, or say the email again.",
                    f"Got it — {email}. Is that right? Say yes, or spell the correct email.",
                ]
            return prompts[v % len(prompts)] if email else ""

        if next_step == "confirm_caller_phone":
            tail_spaced = self._spelled_digit_tail(customer.get("phone"))
            tail_commas = ", ".join(tail_spaced.split()) if tail_spaced else ""
            vn = full_name or (name_first or "there")
            v = self._detail_reply_variant(summary, "confirm_caller_phone")
            opts = [
                (
                    f"Thanks, {vn}. The line you're calling from shows a number ending {tail_commas} — "
                    "that's each last digit in order. "
                    "Is that the right mobile to keep on this order? "
                    "Say **yes**, or give me a different number slowly."
                ),
                (
                    f"Got it, {vn}. Can we use the number you're calling from — it ends {tail_commas} — "
                    "for updates about this order? "
                    "Say **yes**, or tell me another mobile you'd rather we use."
                ),
                (
                    f"One quick check: you're reaching us from a line ending {tail_commas}. "
                    "Should we use that same number for your order? "
                    "Say **yes**, or share a different mobile."
                ),
            ]
            return opts[v] if tail_commas else ""

        return ""

    def _render_lead_capture_text(
        self,
        data: Dict,
        next_step: str,
        invalid_field: Optional[str] = None,
        channel: str = "chat",
    ) -> str:
        """Deterministic reply for the proactive lead-capture flow."""
        name_first = self._first_name(data.get("name") if data else None)

        if invalid_field == "phone":
            return self._phone_invalid_spoken_fragment(include_skip_offer=False, channel=channel)
        if invalid_field == "email":
            if channel == "chat":
                return (
                    "That email doesn't look quite right. "
                    "Try once more — something like **zain@gmail.com**?"
                )
            return (
                "That email doesn't sound quite right. "
                "Try once more slowly — something like **zain at gmail dot com**?"
            )

        if next_step == "name":
            if channel == "chat":
                return "By the way — may I have your full name?"
            return "By the way — may I have your full name, clearly, so nothing gets misheard?"
        if next_step == "phone":
            prefix = f"Thanks, {name_first}! " if name_first else "Thanks! "
            return prefix.strip() + " " + self._phone_ask_spoken_fragment(include_skip_offer=False, channel=channel).strip()
        if next_step == "email":
            if channel == "chat":
                return "And your email? Type it like **umar@gmail.com**."
            return (
                "And your email? Say it in words like **umar at gmail dot com**, slowly — I'll match it."
            )
        if next_step == "captured":
            prefix = f"Thanks, {name_first}!" if name_first else "Thanks!"
            return (
                f"{prefix} I've got your details - we'll be in touch shortly. "
                "Is there anything else I can help with?"
            )
        if next_step == "decline":
            return "No worries - let me know if you need anything else."

        return ""

    def _render_order_add_text(
        self,
        order_state: Dict,
        summary: str,
        items_added: bool,
        channel: str = "chat",
        added_items: Optional[List[Dict[str, Any]]] = None,
        removed_items: Optional[List[Dict[str, Any]]] = None,
    ) -> str:
        """
        Deterministic reply for order_add / order_modify turns.
        """
        sym = getattr(self, "_currency_symbol", "Rs.")
        if removed_items and channel == "voice":
            bits: List[str] = []
            for item in removed_items[:2]:
                name = item.get("name", "item")
                price = float(item.get("price") or 0)
                if price > 0:
                    bits.append(f"{name} at {sym}{price:g}")
                else:
                    bits.append(name)
            removed_line = ", ".join(bits)
            return (
                f"Removed {removed_line}. Anything else, or say place order when you're ready."
            )
        if order_state.get("items"):
            if channel == "voice":
                if items_added and added_items:
                    bits: List[str] = []
                    for item in added_items[:2]:
                        name = item.get("name", "item")
                        qty = int(item.get("quantity") or 1)
                        price = float(item.get("price") or 0)
                        if qty > 1:
                            bits.append(f"{qty} {name}")
                        elif price > 0:
                            bits.append(f"{name} at {sym}{price:g}")
                        else:
                            bits.append(name)
                    added_line = ", ".join(bits)
                    msg = (
                        f"Added {added_line}. Anything else, or say place order when you're ready."
                    )
                    unmatched = order_state.get("_last_unmatched_phrases") or []
                    if unmatched:
                        labels = ", ".join(unmatched[:2])
                        msg += (
                            f" We don't have {labels} on our menu — "
                            "please choose something from our catalog."
                        )
                    return msg
                if items_added:
                    return "Got it. Anything else, or say place order when you're ready."
                return "What else would you like, or say place order when you're ready?"
            opener = "Got it!" if items_added else "Here's your current order:"
            return (
                f"{opener}\n\n{summary}\n\n"
                "Would you like to add anything else, or shall I go ahead and place the order?"
            )
        if channel == "voice":
            return (
                "Your cart is empty — tell me what you'd like to add, "
                "or ask what's on the menu."
            )
        return (
            "What would you like to order? "
            "Tell me the items you'd like and I'll add them - "
            "or ask 'what's on the menu?' if you'd like me to list our options."
        )

    def _render_order_status_text(
        self,
        event: str,
        order_state: Dict,
        order_id: Optional[str] = None,
        channel: str = "chat",
    ) -> str:
        """Deterministic reply for cancel / submitted / submission_failed."""
        customer = order_state.get("customer", {}) or {}
        name_first = self._first_name(customer.get("name"))

        if event == "cancelled":
            base = "No problem - I've cancelled your order."
            return f"{base} Anything else I can help with?"

        if event == "submitted":
            order_tag = f" (Order #{order_id[-6:].upper()})" if order_id else ""
            opener = f"Your order has been placed successfully{order_tag}, {name_first}!" if name_first else (
                f"Your order has been placed successfully{order_tag}!"
            )
            if channel == "voice":
                brief = self._format_order_summary_voice(order_state, for_review=True)
                return (
                    f"{opener} {brief} "
                    "We'll be in touch shortly. Anything else I can help with?"
                )
            summary = self._format_order_summary(order_state)
            return (
                f"{opener}\n\n{summary}\n\n"
                "We'll be in touch as soon as it's on the way. "
                "Is there anything else I can help with?"
            )

        if event == "submission_failed":
            return (
                "I'm so sorry - something went wrong while placing your order. "
                "Could you try saying **yes** once more? "
                "If it keeps failing, please give us a call and we'll sort it out."
            )

        if event == "cart_summary":
            if not order_state.get("items"):
                if channel == "voice":
                    return (
                        "I don't have any items in your order yet. "
                        "Tell me what you'd like and I'll add it for you."
                    )
                return "Your cart is empty."
            if channel == "voice":
                spoken = self._format_order_summary_voice(order_state, for_review=False)
                return f"Your order so far: {spoken}."
            return self._format_order_summary(order_state)

        return ""

    def _build_detail_prompt(
        self,
        order_state: Dict,
        summary: str,
        invalid_field: Optional[str] = None,
        channel: str = "chat",
    ) -> tuple:
        """
        Decide which detail to ask for next and produce both the LLM-facing
        instruction AND the deterministic customer-facing reply.
        Returns ``(order_context, next_step, canned_response)`` where
        ``next_step`` is one of:
            "name", "phone", "email", "order_type", "address", "review".
        ``canned_response`` is the exact text to send when run() chooses to
        bypass the LLM (which it does for every order-detail turn).

        ``invalid_field`` indicates the customer just submitted something that
        failed validation (currently "phone" or "email") so the prompt can
        tell the agent to apologise and re-ask with the correct format.
        """
        customer = order_state.get("customer", {})
        order_type = (order_state.get("order_type") or "").lower()
        needs_address = order_type == "delivery"

        has_name = bool(customer.get("name"))
        skip_phone = bool(order_state.get("skip_phone_detail"))
        skip_email = bool(order_state.get("skip_email_detail"))
        skip_address = bool(order_state.get("skip_address_detail"))
        has_phone = bool(customer.get("phone")) or skip_phone
        has_email = bool(customer.get("email")) or skip_email
        has_order_type = bool(order_type)
        if needs_address and channel == "voice":
            has_address = bool((customer.get("address") or "").strip())
        else:
            has_address = bool(customer.get("address")) or skip_address
        name_confirmed = bool(order_state.get("name_confirmed"))
        email_confirmed = bool(order_state.get("email_confirmed"))

        phone_hint = self._phone_validation_hint()
        ctx_summary = "(active order — do NOT read cart aloud)" if channel == "voice" else summary

        def _wrap(ctx_text: str, step: str) -> tuple:
            order_state["detail_step"] = step
            canned = self._render_order_details_text(
                order_state=order_state,
                next_step=step,
                summary=summary,
                invalid_field=invalid_field if step in ("phone", "email", "address") else None,
                channel=channel,
            )
            if channel == "voice" and canned:
                canned = self._voice_plain(canned)
            return ctx_text, step, canned

        # Invalid-input re-prompts take priority over the normal step ladder.
        if invalid_field == "phone":
            ctx = (
                f"{ctx_summary}\n\n"
                f"The digits did not validate as ({phone_hint}). "
                "Politely apologise and ask again for their mobile contact number spoken slowly. "
                "Do NOT dictate technical format jargon aloud — no repeating digit patterns, codes, "
                "or lengthy templates. Offer **skip** if they cannot share a number. "
                "Do NOT ask for anything else yet."
            )
            return _wrap(ctx, "phone")
        if invalid_field == "email":
            ctx = (
                f"{ctx_summary}\n\n"
                f"The email the customer provided doesn't look valid. "
                f"Politely apologise and ask again ONLY for a valid email (e.g. name@example.com), "
                f"or they may spell it like 'name at gmail dot com', OR say **skip** to continue without email. "
                f"Do NOT ask for anything else yet."
            )
            return _wrap(ctx, "email")
        if invalid_field == "address":
            ctx = (
                f"{ctx_summary}\n\n"
                "Delivery was selected — a full delivery address is required. "
                "Politely explain we cannot skip the address for delivery orders "
                "and ask again for their complete delivery address."
            )
            return _wrap(ctx, "address")

        if not has_name:
            ctx = (
                f"ORDER ITEMS CONFIRMED!\n{ctx_summary}\n\n"
                f"Before placing the order, ask the customer for their name. "
                f"Ask ONLY for their name, nothing else yet."
            )
            return _wrap(ctx, "name")

        if has_name and not name_confirmed:
            ctx = (
                f"{ctx_summary}\n\n"
                f"The customer's NAME may be mistranscribed from speech/text: '{customer.get('name')}'. "
                "You MUST confirm BEFORE asking for phone. "
                "Ask if that spelling/name is exactly right — they may say **yes** "
                "or give a corrected name. Do NOT ask for phone or email yet."
            )
            return _wrap(ctx, "confirm_name")

        pending_network_line = (
            order_state.get("phone_source") == "caller_id"
            and not order_state.get("caller_phone_confirmed")
            and not skip_phone
            and bool(customer.get("phone"))
        )
        if pending_network_line:
            tail = ", ".join(self._spelled_digit_tail(customer.get("phone")).split())
            ctx = (
                f"{ctx_summary}\n\n"
                "The MOBILE was taken from Twilio Caller ID — it already appears in CUSTOMER.phone. "
                f"Masked tail for prompts: ending {tail or 'digits unknown'}."
                " You MUST verbally confirm BEFORE email: is that THEIR preferred number?"
                " They may affirm, reject and give a different mobile, or say **skip** to drop the number."
            )
            return _wrap(ctx, "confirm_caller_phone")

        if not has_phone:
            ctx = (
                f"{ctx_summary}\n\n"
                f"We have the customer's name: {customer.get('name')}. "
                f"Ask ONLY for a contact phone — one short natural question, then STOP and listen. "
                f"Never explain how to say digits (no 'zero triple three' examples). "
                f"Backend validation hint ({phone_hint}) is internal only. "
                "If they cannot share a number, they may say **skip**."
            )
            return _wrap(ctx, "phone")

        if not has_email:
            ctx = (
                f"{ctx_summary}\n\n"
                f"We have the name and phone. "
                f"Ask ONLY for an email for receipt and updates — they may spell it (e.g. 'name at gmail dot com'). "
                f"If they prefer not to share one, they may say **skip** and you MUST continue without email. "
            )
            return _wrap(ctx, "email")

        if has_email and not email_confirmed and not skip_email:
            ctx = (
                f"{ctx_summary}\n\n"
                f"The customer's EMAIL may be mistranscribed: '{customer.get('email')}'. "
                "You MUST read it back and confirm BEFORE asking order type. "
                "They may say **yes** or give a corrected email. Do NOT ask for anything else yet."
            )
            return _wrap(ctx, "confirm_email")

        if not has_order_type:
            ctx = (
                f"{ctx_summary}\n\n"
                f"We have the customer's contact details. "
                f"Now ask whether they want delivery, takeaway, or dine-in. "
                f"Payment methods come from the knowledge base only — do NOT invent cash-only rules. "
                f"Ask ONLY this - do not ask for anything else yet."
            )
            return _wrap(ctx, "order_type")

        if needs_address and not has_address:
            ctx = (
                f"{ctx_summary}\n\nCustomer chose delivery. "
                f"Ask ONLY for their delivery address — they may say **skip** if they cannot provide one."
            )
            return _wrap(ctx, "address")

        # All required details collected → present full review.
        payment = self.ORDER_TYPE_PAYMENT.get(order_type, "Pay on delivery")
        phone_disp = customer.get("phone") or ("(not provided)" if skip_phone else "")
        email_disp = customer.get("email") or ("(not provided)" if skip_email else "")
        cust_parts = [
            f"Name: {customer.get('name')}",
            f"Phone: {phone_disp}",
            f"Email: {email_disp}",
            f"Order Type: {order_type.title()}",
        ]
        if needs_address:
            cust_parts.append(
                f"Address: {customer.get('address') or ('(not provided)' if skip_address else 'N/A')}"
            )
        cust_parts.append(f"Payment: {payment}")
        ctx = (
            f"ALL DETAILS COLLECTED - PRESENT FULL REVIEW TO CUSTOMER!\n"
            f"{summary}\n\n"
            f"{chr(10).join(cust_parts)}\n\n"
            f"Show this complete summary to the customer and ask them to confirm. "
            f"Say something like: 'Does everything look right? Just say yes and I'll place your order.'"
        )
        return _wrap(ctx, "review")

    CURRENCY_SYMBOLS = {
        "USD": "$", "PKR": "Rs.", "EUR": "€", "GBP": "£", "INR": "₹",
        "AED": "AED ", "SAR": "SAR ", "CAD": "C$", "AUD": "A$",
    }

    def _get_delivery_charge(self, order_state: Dict) -> float:
        """Return delivery charge for the current order (PKR delivery orders only)."""
        if order_state.get("order_type") != "delivery":
            return 0.0
        currency = getattr(self, "_current_currency", "USD")
        if currency == "PKR":
            return float(self._DELIVERY_CHARGE_PKR)
        return 0.0

    def _sync_order_totals(self, order_state: Dict) -> None:
        """Persist subtotal, delivery charge, and total on order_state for UI + voice."""
        items = order_state.get("items") or []
        subtotal = sum(
            float(it.get("price") or 0) * int(it.get("quantity") or 1)
            for it in items
        )
        delivery = self._get_delivery_charge(order_state)
        order_state["subtotal"] = subtotal
        order_state["delivery_charge"] = delivery
        order_state["total"] = subtotal + delivery

    def _format_order_summary(
        self,
        order_state: Dict,
        channel: str = "chat",
        *,
        for_review: bool = False,
    ) -> str:
        """Format the current order — chat uses markdown; voice uses spoken-friendly text."""
        sym = getattr(self, "_currency_symbol", "$")
        items = order_state.get("items", [])
        if not items:
            return "Your order is currently empty."

        if channel == "voice":
            return self._format_order_summary_voice(
                order_state, for_review=for_review,
            )

        lines = ["**Order Summary:**"]
        subtotal = 0.0
        for i, item in enumerate(items, 1):
            qty = item.get("quantity", 1)
            price = item.get("price", 0)
            line_total = qty * price
            subtotal += line_total
            line = f"{i}. {item['name']} x{qty}"
            if price > 0:
                line += f" - {sym}{line_total:.0f}"
            options = item.get("options", [])
            if options:
                opts_str = ", ".join(f"{o.get('name', '')}: {o.get('choice', '')}" for o in options)
                line += f" ({opts_str})"
            if item.get("notes"):
                line += f" [Note: {item['notes']}]"
            lines.append(line)

        lines.append("─" * 30)
        delivery_charge = self._get_delivery_charge(order_state)
        if subtotal > 0:
            lines.append(f"Subtotal: {sym}{subtotal:.0f}")
        if delivery_charge > 0:
            lines.append(f"Delivery Charge: {sym}{delivery_charge:.0f}")
        total = subtotal + delivery_charge
        if total > 0:
            lines.append(f"**Total: {sym}{total:.0f}**")

        order_type = order_state.get("order_type", "")
        if order_type:
            payment = self.ORDER_TYPE_PAYMENT.get(order_type, "Pay on delivery")
            lines.append(f"Order Type: {order_type.title()}")
            lines.append(f"Payment: {payment}")

        return "\n".join(lines)

    def _format_order_summary_voice(
        self,
        order_state: Dict,
        *,
        for_review: bool = False,
    ) -> str:
        """Compact spoken order recap — no markdown, no repeated headers."""
        sym = getattr(self, "_currency_symbol", "$")
        items = order_state.get("items", [])
        if not items:
            return "Your order is empty."

        item_bits: List[str] = []
        subtotal = 0.0
        for item in items:
            qty = int(item.get("quantity") or 1)
            price = float(item.get("price") or 0)
            subtotal += qty * price
            name = item.get("name", "item")
            if for_review and price > 0:
                if qty > 1:
                    item_bits.append(f"{qty} {name} at {sym}{price:g} each")
                else:
                    item_bits.append(f"{name} at {sym}{price:g}")
            elif qty > 1:
                item_bits.append(f"{qty} {name}")
            else:
                item_bits.append(name)

        delivery = self._get_delivery_charge(order_state)
        total = subtotal + delivery

        max_show = 2
        if len(item_bits) > max_show:
            shown = ", ".join(item_bits[:max_show])
            extra = len(item_bits) - max_show
            cart = f"{shown}, and {extra} more"
        else:
            cart = ", ".join(item_bits)

        if not for_review:
            if delivery > 0 and total > 0:
                return f"{cart}, {sym}{total:.0f} total including delivery"
            if total > 0:
                return f"{cart}, {sym}{total:.0f} total"
            return cart

        lines = [f"{cart}."]
        if delivery > 0:
            lines.append(f"Subtotal {sym}{subtotal:.0f}.")
            lines.append(f"Delivery charge {sym}{delivery:.0f}.")
        if total > 0:
            lines.append(f"Total {sym}{total:.0f}.")
        customer = order_state.get("customer", {}) or {}
        order_type = (order_state.get("order_type") or "").lower()
        if customer.get("name"):
            lines.append(f"Name {customer['name']}.")
        if order_type:
            lines.append(f"{order_type.title()}.")
        return " ".join(lines)

    @staticmethod
    def _email_for_voice(email: str) -> str:
        """Speakable email for TTS — plain form reads more naturally than 'dot' spelling."""
        if not email or "@" not in email:
            return email or ""
        return email.replace("@", " at ")

    def _submit_order_to_backend(
        self, agent_id: str, tenant_id: str, session_id: str,
        order_state: Dict, channel: str = "chat"
    ) -> Optional[Dict]:
        """Submit the finalized order to the backend."""
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3000")
        items = order_state.get("items", [])
        if not items:
            print("[ORDER] Submission aborted - no items in order_state")
            return None

        self._enrich_items_prices(
            items,
            "",
            agent_id=agent_id,
            tenant_id=tenant_id,
            order_state=order_state,
        )

        items_ok, items_reason = validate_items_for_submit(items, require_prices=True)
        if not items_ok:
            print(f"[ORDER] Submission aborted — {items_reason}")
            return None

        order_type = order_state.get("order_type", "")
        payment_method = self.ORDER_TYPE_PAYMENT.get(order_type, "Cash on Delivery")

        # Sanitize items: ensure each has name, price (>=0), and quantity (>=1)
        sanitized_items = []
        for it in items:
            if not it.get("name"):
                continue
            sanitized_items.append({
                "name": it["name"],
                "price": float(it.get("price") or 0),
                "quantity": int(it.get("quantity") or 1),
            })
        if not sanitized_items:
            print("[ORDER] Submission aborted - no valid items after sanitization")
            return None

        # Add delivery charge as a line item for PKR delivery orders
        items_to_submit = sanitized_items
        delivery_charge = self._get_delivery_charge(order_state)
        if delivery_charge > 0:
            items_to_submit = sanitized_items + [{
                "name": "Delivery Charge",
                "price": delivery_charge,
                "quantity": 1,
            }]

        customer = order_state.get("customer", {})
        payload = {
            "agentId": agent_id,
            "tenantId": tenant_id,
            "sessionId": session_id,
            "channel": channel,
            "currency": self._current_currency,
            "items": items_to_submit,
            "customerName": customer.get("name"),
            "customerPhone": customer.get("phone"),
            "customerEmail": customer.get("email"),
            "customerAddress": customer.get("address"),
            "notes": order_state.get("notes"),
            "orderType": order_type,
            "paymentMethod": payment_method,
        }

        print(f"[ORDER] Submitting to {backend_url} - agent={agent_id}, tenant={tenant_id}, "
              f"items={len(items_to_submit)}, customer={customer.get('name')}, type={order_type}")

        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{backend_url}/api/internal/orders",
                    json=payload,
                    headers=_internal_api_headers(),
                )
                if resp.status_code == 201:
                    data = resp.json()
                    print(f"[ORDER] Created order {data.get('_id')} - total={data.get('total')}, status={data.get('status')}")
                    return data
                else:
                    snippet = resp.text[:300] if resp.text else "(empty body)"
                    tip = ""
                    if resp.status_code == 401:
                        tip = (
                            " Tip: Backend rejected the caller — ai_service INTERNAL_API_SECRET must match "
                            "backend INTERNAL_API_SECRET (header X-Internal-Secret)."
                        )
                    elif not _internal_api_headers():
                        tip = " Tip: ai_service INTERNAL_API_SECRET is unset; backend may reject in production."
                    print(f"[ORDER] Backend returned {resp.status_code}: {snippet}{tip}")
                    return None
        except Exception as e:
            print(f"[ORDER] Error submitting order: {e}")
            return None

    @staticmethod
    def _user_msg_similarity(a: str, b: str) -> float:
        """Jaccard similarity over content tokens (drops short stop words)."""
        STOP = {
            "the", "a", "an", "and", "or", "but", "is", "are", "was", "were",
            "i", "you", "he", "she", "it", "we", "they", "me", "us", "them",
            "to", "of", "in", "on", "for", "at", "by", "with", "from", "as",
            "do", "does", "did", "have", "has", "had", "be", "been", "being",
            "what", "which", "who", "when", "where", "why", "how",
            "this", "that", "these", "those", "my", "your", "our", "their",
            "can", "could", "would", "should", "may", "might", "will", "shall",
            "tell", "show", "give", "let", "know", "about", "more", "any",
        }
        ta = {t for t in re.findall(r"[a-zA-Z']+", (a or "").lower()) if t not in STOP and len(t) > 2}
        tb = {t for t in re.findall(r"[a-zA-Z']+", (b or "").lower()) if t not in STOP and len(t) > 2}
        if not ta or not tb:
            return 0.0
        inter = len(ta & tb)
        union = len(ta | tb)
        return inter / union if union else 0.0

    def _build_anti_repeat_block(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]],
        max_chars: int = 180,
    ) -> str:
        """
        Build a stronger anti-repetition hint for the LLM:
          - Lists the LAST 2 assistant messages so it knows what was already said.
          - Detects whether the user is re-asking the same broad thing as a recent
            user message; if so, instructs the LLM to ASK which subset they want
            instead of repeating the full content.
        """
        if not history:
            return ""

        # Collect last 2 assistant messages and last 2 user messages (excluding current).
        recent_assistant: List[str] = []
        recent_user: List[str] = []
        for entry in reversed(history):
            role = entry.get("role")
            content = (entry.get("content") or "").strip()
            if not content:
                continue
            if role == "assistant" and len(recent_assistant) < 2:
                recent_assistant.append(content)
            elif role == "user" and len(recent_user) < 2:
                recent_user.append(content)
            if len(recent_assistant) >= 2 and len(recent_user) >= 2:
                break

        if not recent_assistant:
            return ""

        # Check if the user is re-asking something they already asked.
        is_reasking = False
        for prior_user in recent_user:
            sim = self._user_msg_similarity(query, prior_user)
            if sim >= 0.5:
                is_reasking = True
                break

        # Build the "things you've recently said" block.
        previous_lines = []
        for idx, msg in enumerate(recent_assistant, start=1):
            snippet = msg[:max_chars].replace("\n", " ")
            if len(msg) > max_chars:
                snippet += "..."
            previous_lines.append(f"  ({idx}) \"{snippet}\"")
        previous_block = "\n".join(previous_lines)

        if is_reasking:
            instruction = (
                "The customer is re-asking the same broad thing they asked before. "
                "DO NOT repeat the full answer or relist everything. "
                "Instead, briefly acknowledge that you already shared this and ASK which "
                "specific item, category, or detail they want to focus on."
            )
        else:
            instruction = (
                "Do NOT repeat the wording, structure, or content of the messages above. "
                "Give a FRESH response with information NOT yet covered. "
                "If the customer is asking a follow-up, build on what was already said "
                "instead of restating it."
            )

        return (
            f"\n=== YOUR RECENT REPLIES (avoid repeating) ===\n"
            f"{previous_block}\n"
            f"=== END RECENT REPLIES ===\n"
            f"{instruction}"
        )

    def respond(
        self,
        config: AgentConfig,
        query: str,
        history_text: str,
        plan: Dict[str, Any],
        context: str,
        intent: str,
        history: Optional[List[Dict[str, str]]] = None,
        closing_guidance: str = "",
        order_context: str = "",
        channel: str = "chat",
        lead_context: str = "",
        campaign_mode: bool = False,
        on_sentence: Optional[Callable[[str], None]] = None,
    ) -> str:
        """Generate a response grounded strictly in retrieved context."""

        has_context = bool(context and context.strip() and context != "No relevant context found.")
        context_block = context if has_context else "No relevant information was found in the knowledge base."

        # Voice channel: cap KB context aggressively to keep prompt small.
        # 6000 chars is roughly 1500 tokens - enough for a full menu but
        # short enough for sub-second TTFT on a Groq call.
        if channel == "voice" and has_context and len(context_block) > 6000:
            voice_kb_cap = int(os.environ.get("VOICE_CONTEXT_CHAR_CAP", "6000"))
            context_block = context_block[:voice_kb_cap] + "\n\n[…knowledge truncated for voice latency…]"

        persona_name = config.persona.get("name") if config.persona else None
        agent_name = persona_name or config.name or "Assistant"
        business_name = config.business_name or ""
        identity = f"{agent_name} from {business_name}" if business_name else agent_name
        tone = config.tone or "professional"

        is_first_message = len(history or []) == 0

        # Defensive guard: if there's an active order/lead capture context,
        # this can never be the customer's first message - even if `history`
        # was somehow lost (SQLite hiccup, session-id mismatch, etc.). This
        # prevents the model from regressing into "Hello! I'm <name>" mid-flow,
        # which is what a slow Ollama fallback occasionally produced.
        if is_first_message and (order_context.strip() or lead_context.strip()):
            print(
                "[RUNTIME] guard: history empty but order/lead context active "
                "- treating as mid-conversation, not first message."
            )
            is_first_message = False

        # Build anti-repetition hint (looks at last 2 assistant messages + detects re-asking)
        anti_repeat = self._build_anti_repeat_block(query, history, max_chars=200)

        # Intent-aware greeting: if the first message has a clear request, don't just dump a welcome speech
        if channel == "voice":
            # Voice calls already played a greeting via Twilio firstMessage.
            # NEVER re-introduce - just answer the customer's query directly.
            greeting_instruction = (
                f"You are {identity}. The customer has already been greeted on this phone call. "
                f"Do NOT say hello, do NOT introduce yourself, do NOT say 'welcome'. "
                f"Jump straight to answering their question or request."
            )
        elif is_first_message:
            if len(query.split()) > 3:
                greeting_instruction = f"Briefly introduce yourself as {identity} and IMMEDIATELY address the customer's request: '{query}'."
            else:
                greeting_instruction = f"Greet the customer warmly, introduce yourself as {identity}, and ask how you can help."
        else:
            greeting_instruction = "Continue the conversation naturally. Do NOT re-introduce yourself."

        intent_guidance = {
            "navigation": "The customer is asking to continue. Prioritize the next unseen relevant section from retrieved knowledge.",
            "complete_request": "The customer asked for COMPLETE information about a specific category. You MUST LIST ALL items with names and prices from the KNOWLEDGE above. Do NOT say 'we have a variety' - actually NAME each item. If the knowledge contains a list, read it out.",
            "smalltalk": "The customer is doing light conversation. Reply naturally, then gently steer to how you can help with business-related needs.",
            "question": "Answer directly with clear structure and practical detail. If the customer asks about items in a specific category (e.g. pizzas, burgers), NAME each item with its price from KNOWLEDGE. Do NOT say 'we have a variety' - give specific names.",
            "acknowledgement": "The customer gave a short acknowledgement or refusal (like 'ok', 'no', 'sure'). Respect their response. If they declined something, do NOT push it again. Simply ask if there's anything else you can help with in ONE short sentence. Do NOT introduce new topics or volunteer information they didn't ask for.",
            "order_add": "The customer wants to order item(s). Acknowledge the items, confirm what you understood, and ask if they'd like anything else.",
            "order_confirm": "The customer is confirming their order. Summarize the order with items and total. Then collect details one at a time: 1) Full name, 2) Phone (natural conversational ask — never dictate technical numbering templates aloud), 3) Email (or skip), 4) Order type (delivery/takeaway/dine-in), 5) Address (only if delivery). Payment methods are defined in the knowledge base — do not invent restrictions. After all details are collected, show a brief review and ask for yes to confirm.",
            "order_cancel": "The customer wants to cancel their order. Confirm the cancellation and ask if there's anything else you can help with.",
            "order_modify": "The customer wants to modify their order. Acknowledge the change and confirm the updated order.",
            "order_details": "The customer is providing personal details one at a time. Sequence: name → confirm spelling → (if caller ID pre-filled) confirm that phone line → else collect phone → email → order type → address if delivery. Keep phone prompts conversational.",
            "lead_details": "The customer is providing contact details so we can follow up. Follow the LEAD CAPTURE STATE instructions exactly. Acknowledge what they shared and ask ONLY for the next missing field — use natural conversational voice; correctness is validated silently. Never ask more than one thing at a time.",
            "lead_decline": "The customer chose not to share contact info. Accept gracefully in ONE short sentence and continue helping with their original question. Do NOT push or re-ask.",
        }.get(intent, "Answer naturally and helpfully.")

        lead_section = ""
        if lead_context:
            lead_section = f"""
=== LEAD CAPTURE STATE ===
{lead_context}
=== END LEAD CAPTURE STATE ===

LEAD CAPTURE RULES:
- Follow the LEAD CAPTURE STATE instructions exactly.
- Ask for ONE field at a time (name, then phone, then email).
- Phone/email are validated silently; ask in natural conversational voice — NEVER read jargon like eleven-digit numbering aloud.
- If the customer declined to share details, do NOT push again - just continue helping.
- Never invent contact info; only use what the customer provided.
"""

        order_section = ""
        if order_context:
            order_section = f"""
=== CURRENT ORDER STATE ===
{order_context}
=== END ORDER STATE ===

ORDER RULES:
- When the customer orders items, acknowledge each item by name and price from the catalog.
- Keep a running summary of their order.
- When they say they're done ordering or confirm, present the full order summary with itemized prices and total.
- Before finalizing the order, collect details ONE at a time in this sequence: 1) Name, 2) Phone (friendly spoken wording), 3) Email (or skip), 4) Order type (delivery/takeaway/dine-in), 5) Address (only if delivery). Backend validates Pakistani mobiles as 03… — NEVER read those specs aloud. Then review and ask for 'yes'.
- If customer details are ALREADY shown in the order state, do NOT ask for them again.
- Be helpful about menu options and recommendations.
- NEVER invent payment methods, delivery charges, fees, discounts, or processing details not present in the retrieved knowledge.
- Use ONLY the items, prices, and totals from the ORDER STATE above - do NOT add, duplicate, or modify items on your own.
- If the order state says ALREADY SUBMITTED, confirm it is placed and do NOT re-process.
"""

        # --- Build optional agent-config sections ---
        _default_sp = "You are a helpful AI assistant for a business."
        _has_custom_prompt = (
            config.system_prompt
            and config.system_prompt.strip()
            and config.system_prompt.strip() != _default_sp
        )
        # When no custom system prompt, auto-generate from persona + objectives so the agent
        # is always grounded in the configured identity rather than falling back to generic behavior.
        if not _has_custom_prompt and (config.objectives or config.persona):
            _obj_summary = "; ".join(config.objectives[:3]) if config.objectives else ""
            _auto_sp = f"You are {identity}, a dedicated AI assistant"
            if business_name:
                _auto_sp += f" for {business_name}"
            if _obj_summary:
                _auto_sp += f". Your main goals are: {_obj_summary}."
            _auto_sp += " Always stay in character and answer only topics relevant to this business."
            _custom_instructions = f"\n=== AGENT INSTRUCTIONS ===\n{_auto_sp}\n=== END AGENT INSTRUCTIONS ===\n"
        elif _has_custom_prompt:
            _custom_instructions = (
                f"\n=== AGENT INSTRUCTIONS ===\n{config.system_prompt.strip()}\n=== END AGENT INSTRUCTIONS ===\n"
            )
        else:
            _custom_instructions = ""
        # Agent guardrails merged via build_chat_system_safety_and_rules() below.
        # Persona details beyond the name (summary and speaking style)
        _persona_block = ""
        if config.persona:
            p = config.persona
            lines = []
            if p.get("summary"):
                lines.append(f"About you: {p['summary']}")
            if p.get("speakingStyle"):
                lines.append(f"Speaking style: {p['speakingStyle']}")
            if lines:
                _persona_block = "\n".join(lines) + "\n"
        # Objectives and capabilities
        _objectives_block = (
            f"\nYour objectives: {'; '.join(config.objectives)}.\n"
            if config.objectives else ""
        )
        _capabilities_block = (
            f"You can help with: {'; '.join(config.capabilities)}.\n"
            if config.capabilities else ""
        )

        _tone_guideline = TONE_GUIDELINES.get(tone.lower(), "")
        _tone_guidance_block = f"{_tone_guideline}\n" if _tone_guideline else ""

        # ─── System message: everything stable across turns ───────────────
        # Sent as a real `system` role to Groq (better instruction-following);
        # prepended for Ollama. KB / order / history / query stay in the user
        # role since they change every turn.
        system_message = f"""You are {identity}, an AI assistant for {business_name or "a business"}.
Your name is "{agent_name}". If asked who you are, say "{agent_name}". Never claim to be Claude, ChatGPT, or any AI model.
Respond in a {tone} tone - naturally and consistently, without being stiff or mechanical.
{_tone_guidance_block}{_persona_block}{_objectives_block}{_capabilities_block}{_custom_instructions}
{build_chat_system_safety_and_rules(config.guardrails)}

=== ANSWERING GUIDE ===
COMPANY-SPECIFIC FACTS (products, prices, services, policies, staff, hours, locations, contact info, procedures):
  → Answer ONLY from the RETRIEVED KNOWLEDGE BASE in the user message.
  → If the answer is NOT in the retrieved context: respond naturally without ever mentioning "knowledge base", "my knowledge", "my data", or "my information". Say something warm and human like "I'd want to make sure I give you the right details on that - your best bet is to reach out to us directly and someone will sort you out." Vary the phrasing naturally; never repeat the same script twice.
  → NEVER guess, estimate, invent, or draw on general training knowledge for company-specific facts.
  → If context is empty or no relevant info was found, DO NOT fabricate a plausible answer.
GENERIC / CONVERSATIONAL QUESTIONS (greetings, universal concepts, how things work in general):
  → You may use general knowledge ONLY for questions that have universal answers (e.g., "what does FAQ stand for?").
  → NEVER apply general knowledge to assert facts about THIS specific company (its prices, products, staff, hours, policies).
=== END ANSWERING GUIDE ===

=== RESPONSE RULES ===
1. CONTENT SAFETY: If the query touches any off-limits topic, decline politely and redirect - do nothing else.

2. STRICT FAITHFULNESS FOR COMPANY FACTS:
   - Use ONLY facts from the RETRIEVED KNOWLEDGE BASE for anything company-specific.
   - HISTORY EXCEPTION: If an item, price, or fact was stated by YOU (the assistant) in CONVERSATION HISTORY, it was already confirmed from the knowledge base. ALWAYS honor it — never contradict or deny your own previous statements. The user asking a follow-up about something you already mentioned is NOT a reason to say it doesn't exist.
   - If genuinely not found in context AND not in history: respond warmly that you'd want to confirm the right details and suggest contacting the business directly.
   - NEVER say "knowledge base", "my knowledge", "my data", or any AI-sounding phrase to the customer. Sound human.
   - Use EXACT names, prices, values, and terms - do not paraphrase, rename, round, or approximate.
   - When listing items, include ONLY items that appear in the knowledge. Do not add extras.

3. SMART CONVERSATION CONTINUITY:
   a. Note every topic/section already covered in CONVERSATION HISTORY.
   b. Cover ONLY content NOT yet shared - skip what was already discussed.
   c. If customer says "proceed"/"next"/"continue"/"more" → share the NEXT section from knowledge not yet mentioned.
   d. NEVER repeat the same information or phrasing from a previous turn.
   e. NEVER deny or walk back an item/price/fact you stated in a previous turn. If the customer follows up on something you already confirmed, build on it — do not contradict yourself.

4. RESPONSE QUALITY:
   - Natural, warm, and conversational.
   - 2-3 sentences for simple queries, bullet points for lists.
   - At most one follow-up question per response.
   - Do NOT re-ask a follow-up already asked in CONVERSATION HISTORY.
   - If customer says "no" → ACCEPT it. Do not push, re-offer, or suggest alternatives they declined.
   - Do NOT introduce new topics the customer didn't ask about.
   - Do NOT invent offers, promotions, or options not in the knowledge.
   - Do NOT use emojis. Express tone through word choice only - wit for humor, warmth for empathy, clarity for formal.
=== END RESPONSE RULES ==="""

        # ─── User message: turn-specific data + the actual query ──────────
        prompt = f"""=== RETRIEVED KNOWLEDGE BASE ===
{context_block}
=== END RETRIEVED KNOWLEDGE BASE ===
{lead_section}{order_section}
CONVERSATION HISTORY:
{history_text}

CUSTOMER: {query}

INTENT: {intent} - {intent_guidance}
{greeting_instruction}{anti_repeat}{closing_guidance}

RESPONSE:"""

        # ── Voice channel: use a much leaner prompt for low latency ──
        if channel == "voice":
            # Voice: shorter snippets to keep prompt lean, but still last 2 turns + re-ask detection.
            anti_repeat = self._build_anti_repeat_block(query, history, max_chars=140)

            voice_order_section = ""
            if order_context:
                voice_order_section = (
                    f"\nORDER STATE: {order_context}\n"
                    f"Use ONLY items/prices from ORDER STATE above. "
                    f"NEVER invent, add, or guess items or prices not shown in ORDER STATE. "
                    f"If ORDER STATE says ALREADY SUBMITTED, do NOT re-process or add new items."
                )

            voice_lead_section = ""
            if lead_context:
                voice_lead_section = (
                    f"\nLEAD CAPTURE: {lead_context}\n"
                    "Ask for ONE field at a time (name → phone → email). "
                    "Use natural conversational speech — never dictate technical numbering formats aloud. "
                    "Phone/email are validated silently to 11-digit / proper email formats."
                )

            # Voice agent config: full guardrails from agent form (not truncated).
            _voice_safety_block = build_voice_system_safety_and_rules(config.guardrails)
            _voice_persona_note = ""
            if config.persona:
                p = config.persona
                parts = []
                if p.get("summary"):
                    parts.append(p["summary"])
                if p.get("speakingStyle"):
                    parts.append(f"Speak in a {p['speakingStyle']} style.")
                if parts:
                    _voice_persona_note = "\n" + " ".join(parts)
            _voice_objectives_note = (
                f"\nObjectives: {'; '.join(config.objectives[:4])}."
                if config.objectives else ""
            )
            _voice_capabilities_note = (
                f"\nYou can help with: {'; '.join(config.capabilities[:4])}."
                if config.capabilities else ""
            )
            _voice_tone_guideline = TONE_GUIDELINES.get(tone.lower(), "")
            _voice_tone_note = f" {_voice_tone_guideline}" if _voice_tone_guideline else ""

            if campaign_mode:
                # ── Outbound campaign mode ────────────────────────────────────
                # The backend sends a fully-formed campaign playbook as
                # system_prompt (buildOutboundCallPrompt directly — no inbound
                # voice preamble wrapper, which would cause inbound-style behavior).
                # Use it verbatim — no truncation, no standard inbound wrapper.
                # Append two safety rules that the playbook template omits:
                # - BUSINESS FACT RULE: never invent location/hours/prices not in the script or KB
                # - CONVERSATION INTEGRITY: never claim you mentioned something not in history
                system_message = config.system_prompt.strip() + (
                    "\n\nBUSINESS FACT RULE: If the customer asks for specific business facts "
                    "(address, location, opening hours, contact numbers, prices not in this script) "
                    "that are NOT covered in this script or the KNOWLEDGE BASE, do NOT invent an answer. "
                    "Say: \"I'd want to make sure I give you accurate details on that — "
                    "I'll have someone from our team follow up with you.\" Then redirect to the campaign goal."
                    "\nCONVERSATION INTEGRITY: Never claim you mentioned something in a previous turn "
                    "unless that statement appears verbatim in the CONVERSATION HISTORY. "
                    "Do not fabricate past statements."
                )
                if config.guardrails and config.guardrails.strip():
                    system_message += (
                        "\n\nAGENT GUARDRAILS (from business owner — follow strictly):\n"
                        + config.guardrails.strip()
                    )

                # Override intent guidance for campaign mode:
                # - acknowledgement: don't stall with "anything else?" — drive the sale forward
                # - question: answer from KB only, never invent business facts
                if intent == "acknowledgement":
                    intent_guidance = (
                        "The customer gave a short or vague response. Do NOT ask 'Is there anything else I can help with?' "
                        "Continue driving the sales conversation — move to your next qualifying question or "
                        "re-engage with the campaign offer."
                    )
                elif intent == "question":
                    intent_guidance = (
                        "Answer using ONLY facts from the KNOWLEDGE BASE above. "
                        "If the answer is not there, say you will have someone follow up with accurate details, "
                        "then redirect to the campaign goal. NEVER invent locations, hours, prices, or any other facts."
                    )

                # User message: include KB only when the contact asked a
                # business question and KB was actually retrieved; otherwise
                # keep the prompt clean so the LLM follows the campaign script.
                if has_context:
                    prompt = f"""KNOWLEDGE BASE (for business questions only):
{context_block}

CONVERSATION HISTORY:
{history_text}

CUSTOMER: {query}
INTENT: {intent} - {intent_guidance}
{anti_repeat}
{closing_guidance}

RESPONSE:"""
                else:
                    prompt = f"""CONVERSATION HISTORY:
{history_text}

CUSTOMER: {query}
INTENT: {intent} - {intent_guidance}
{anti_repeat}
{closing_guidance}

RESPONSE:"""

            else:
                # ── Standard inbound voice mode ───────────────────────────────
                # Include agent's configured system prompt (capped to keep prompt lean)
                _voice_agent_setup = ""
                if _has_custom_prompt:
                    _voice_agent_setup = f"\nAGENT SETUP:\n{config.system_prompt.strip()[:600]}\n"

                system_message = f"""You are {identity} on a LIVE PHONE CALL. Tone: {tone}.{_voice_tone_note}{_voice_persona_note}{_voice_objectives_note}{_voice_capabilities_note}{_voice_agent_setup}

{_voice_safety_block}

ANSWERING GUIDE:
- Company facts: ONLY from KNOWLEDGE BASE in the user message. If not found, say you don't have that detail and suggest contacting the business. NEVER invent menu items, prices, or product names.
- Generic conversational questions: answer naturally in 1-2 sentences.

VOICE RULES:
- 1-2 sentences MAX for general questions. Exception: listing a specific category — name each item with price from KNOWLEDGE BASE.
- NO markdown, bullets, or emojis — plain spoken sentences only.
- NEVER repeat what's already in HISTORY.
- ORDERING: Follow ORDER STATE exactly. Do NOT re-ask collected details. Never claim order confirmed unless ORDER STATE says submitted.
- CLOSING: Short warm goodbye when customer is done."""

                # ─── Standard voice user message: KB + lead + order + history + query ───
                prompt = f"""KNOWLEDGE BASE:
{context_block}
{voice_lead_section}{voice_order_section}
CONVERSATION HISTORY:
{history_text}

CUSTOMER: {query}
INTENT: {intent} - {intent_guidance}
{anti_repeat}
{greeting_instruction}
{closing_guidance}

RESPONSE:"""

        temperature = float(config.response_config.get("temperature", 0.1))
        if channel == "voice":
            ORDER_INTENTS = ("order_add", "order_confirm", "order_details", "order_modify", "order_cancel")
            if campaign_mode:
                # Outbound campaign turns need room for multi-sentence scripts,
                # qualifying questions, and objection responses.
                max_tokens = 150
            elif intent == "complete_request":
                max_tokens = 180  # listing items needs a bit more room
            elif intent in ORDER_INTENTS:
                max_tokens = 150  # order flow: summaries + instructions
            else:
                max_tokens = 90   # Q&A, smalltalk, acknowledgement: keep it short and fast
        else:
            max_tokens = 400

        if on_sentence and channel == "voice":
            from llm_provider import invoke_llm_stream
            from sentence_utils import SentenceStreamBuffer

            buf = SentenceStreamBuffer(min_chars=12, max_sentences=3)
            full = ""
            for delta in invoke_llm_stream(
                prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                system_message=system_message,
            ):
                full += delta
                for sentence in buf.feed(delta):
                    on_sentence(sentence)
            for sentence in buf.flush():
                on_sentence(sentence)
            return full.strip()

        return self._invoke_with_fallback(
            prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            system_message=system_message,
        )

    def run(
        self,
        config: AgentConfig,
        query: str,
        history: List[Dict[str, str]],
        context_provider: Callable[[str], str],
        session_in_scope: bool = False,
        order_state: Optional[Dict] = None,
        lead_state: Optional[Dict] = None,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        session_id: Optional[str] = None,
        channel: str = "chat",
        caller_phone: Optional[str] = None,
        currency: str = "USD",
        campaign_mode: bool = False,
        on_sentence: Optional[Callable[[str], None]] = None,
    ) -> Dict[str, Any]:
        # Set currency and symbol for this run (used by _format_order_summary)
        self._currency_symbol = self.CURRENCY_SYMBOLS.get(currency, "$")
        self._current_currency = currency
        self._lock_workspace_currency = bool(currency)

        # Cold outreach: never reuse inbound order/lead state on the voice session.
        if campaign_mode:
            order_state = {"items": [], "status": "idle", "customer": {}}
            lead_state = {"captured": False, "data": {}}

        # Per-stage timings (ms) - surfaced to the API caller for accurate
        # latency breakdowns instead of UI-side guesswork.
        import time as _time
        timings: Dict[str, int] = {}
        run_started = _time.time()

        # Honour the agent's configured short-term memory window.
        # memory_window counts TURNS (user+assistant pairs), so messages = window * 2.
        # Hard caps keep token usage bounded: 48 messages (24 turns) for chat,
        # 16 messages (8 turns) for voice - voice still trades context for latency.
        configured_messages = max(2, int(config.memory_window or 12)) * 2
        if channel == "voice":
            messages_limit = min(configured_messages, 16)
        else:
            messages_limit = min(configured_messages, 48)
        effective_history = history[-messages_limit:] if history else []
        history_text = self._history_to_text(effective_history, limit=messages_limit)

        # Step 1: Plan (lightweight - domain check + close detection only)
        _t = _time.time()
        plan = self.plan(config, query, history_text)
        timings["planMs"] = int((_time.time() - _t) * 1000)

        # Step 1.5: Intent classification for retrieval/response shaping
        _t = _time.time()
        intent = self._classify_intent(query, history, order_state)
        timings["intentMs"] = int((_time.time() - _t) * 1000)

        # Voice: remap misclassified cart/ack turns before retrieval/plan guards run.
        if channel == "voice" and not campaign_mode and order_state is not None:
            has_cart = bool(order_state.get("items"))
            order_active = order_state.get("status") in (
                "collecting", "awaiting_details", "reviewing",
            )
            if intent == "acknowledgement" and order_active:
                if self._last_assistant_asked_confirm(history):
                    intent = "order_confirm"
                elif self._last_assistant_asked_yesno(history):
                    if self._last_assistant_discussed_order(history) or has_cart:
                        intent = "order_confirm" if self._last_assistant_asked_confirm(history) else "order_add"
            if intent == "question":
                if has_cart and order_active:
                    if self._looks_like_cart_total_question(query):
                        intent = "order_status"
                    elif self._looks_like_place_order_confirm(query):
                        intent = "order_confirm"
                    elif self._looks_like_order_payment_or_type(query):
                        intent = "order_details"
                    elif self._looks_like_add_to_cart(query) or self._looks_like_add_item_request(query):
                        intent = "order_add"
                elif self._looks_like_add_to_cart(query) and not self._is_info_only_pushback(query):
                    intent = "order_add"
                elif has_cart and self._looks_like_place_order_confirm(query):
                    intent = "order_confirm"

        # Voice info calls: exit empty order / lead ladders when caller pushes back.
        if (
            channel == "voice"
            and not campaign_mode
            and self._is_info_only_pushback(query)
        ):
            if order_state and not order_state.get("items"):
                order_state = {"items": [], "status": "idle", "customer": {}}
            if lead_state and (lead_state.get("data") or {}).get("_capture_step"):
                lead_state = dict(lead_state)
                lead_state.setdefault("data", {})
                lead_state["data"].pop("_capture_step", None)
                lead_state["data"]["_declined"] = True
            if intent.startswith("order_") or intent in ("lead_details", "order_add"):
                intent = "question"

        if campaign_mode and (
            intent.startswith("order_") or intent in ("lead_details", "lead_decline")
        ):
            intent = "question"

        # Step 2: Multi-query retrieval for stronger recall and continuity
        #         Voice channel: single query only for low latency
        #         Skip retrieval entirely for intents that don't need KB lookups
        skip_retrieval_intents = (
            "acknowledgement", "closing",
            "order_add", "order_modify", "order_status",
            "order_confirm", "order_details", "order_cancel",
            "lead_details", "lead_decline",
        )
        # Voice: smalltalk ("hey", "can you hear me?") never needs KB — skipping
        # saves 6-8s on cold Ollama embed + Supabase RPC per turn.
        if channel == "voice" and intent == "smalltalk":
            retrieval_queries = []
        elif intent in skip_retrieval_intents:
            retrieval_queries = []
        elif campaign_mode and intent != "question":
            # Outbound campaign: KB only consulted when the contact explicitly
            # asks a business question — the campaign script is self-contained.
            retrieval_queries = []
        else:
            retrieval_queries = self._build_retrieval_queries(query, history, intent, channel=channel)
            if channel == "voice":
                retrieval_queries = retrieval_queries[:1]  # single query for speed
        contexts: List[str] = []
        _t = _time.time()
        for search_query in retrieval_queries:
            try:
                contexts.append(context_provider(search_query))
            except Exception:
                continue
        timings["retrievalMs"] = int((_time.time() - _t) * 1000)

        # Auto-detect currency from RAG chunks so _retrieve_full_catalog and
        # _format_order_summary use the right symbol even when the agent's DB
        # currency field still says "USD".
        if contexts:
            self._sync_currency_from_context("\n".join(contexts))

        # Full-menu / full-list request: fetch every catalog item directly from backend
        # so the agent can list everything without RAG truncation
        normalized_q_lower = query.lower()
        wants_full_menu = any(kw in normalized_q_lower for kw in self.COMPLETENESS_KEYWORDS)
        if wants_full_menu and agent_id and tenant_id and not campaign_mode:
            catalog_ctx = self._get_cached_catalog(agent_id, tenant_id)
            if catalog_ctx:
                contexts.insert(0, catalog_ctx)

        context = self._merge_contexts(contexts)

        # Drop chunks that have already been substantially shared in recent assistant
        # messages - prevents re-serving the same catalog/menu/policy text turn after turn.
        # Skipped for completeness requests (user EXPLICITLY wants the full list re-shown).
        if intent != "complete_request":
            context = self._dedupe_chunks_against_history(context, history)

        # Voice: truncate context to keep prompt small but allow enough for full menus
        # complete_request / question need more room so the agent doesn't cut off menu items
        if channel == "voice" and context:
            if intent in ("complete_request", "question"):
                voice_ctx_limit = 3500
            else:
                voice_ctx_limit = 2500
            if len(context) > voice_ctx_limit:
                # Truncate at the last sentence boundary within the limit
                truncated = context[:voice_ctx_limit]
                last_period = truncated.rfind(".")
                context = truncated[:last_period + 1] if last_period > voice_ctx_limit // 2 else truncated
        has_context = bool(context and context != "No relevant context found.")
        print(
            f"[RUNTIME] intent={intent}, retrieval_queries={retrieval_queries}, "
            f"has_context={has_context}, context_len={len(context) if context else 0}"
        )

        # Initialized early — Tier-A menu bypass and global-question guard read this
        # before the main order-flow block below.
        canned_response: Optional[str] = None

        # Global/off-menu questions — never invent menu items to answer them.
        if (
            channel == "voice"
            and intent == "question"
            and not campaign_mode
            and self._is_global_general_question(query)
        ):
            canned_response = (
                "I'm not able to answer general rankings like that. "
                "I can help with our menu, placing an order, or anything specific about this restaurant."
            )
            print(f"[RUNTIME] global-question guard — LLM bypassed for: {query!r}")

        # Tier A: deterministic voice menu answer from catalog (no LLM, capped list).
        if (
            channel == "voice"
            and not campaign_mode
            and not canned_response
            and intent in ("question", "complete_request")
            and self._is_menu_info_request(query)
            and agent_id
            and tenant_id
        ):
            menu_idx = self._get_menu_index(agent_id, tenant_id, order_state)
            if menu_idx and menu_idx.items:
                canned_response = self._render_voice_menu_summary(menu_idx)
                if order_state is not None:
                    menu_idx.apply_to_order_state(order_state)
                print(
                    f"[RUNTIME] Tier-A menu bypass — {len(menu_idx.items)} items, "
                    f"spoken cap={self.VOICE_MENU_SPOKEN_MAX}"
                )

        if intent in ("question", "smalltalk", "navigation") and order_state:
            order_state.pop("pending_item_phrase", None)

        # Cache menu text from KB answers so the next order_add can match items without RAG.
        if (
            order_state
            and has_context
            and intent in ("question", "complete_request")
            and self._extract_menu_entries_from_text(context)
            and agent_id
            and tenant_id
        ):
            menu_idx = self._get_menu_index(agent_id, tenant_id, order_state)
            if menu_idx:
                if menu_idx.source == "catalog" and menu_idx.items:
                    menu_idx.apply_to_order_state(order_state)
                    print("[ORDER] Catalog authoritative — skipped KB menu merge for session")
                else:
                    menu_idx.merge_kb_text(context)
                    menu_idx.apply_to_order_state(order_state)
                    print(
                        f"[ORDER] Cached menu entries from KB for session "
                        f"({len(self._extract_menu_entries_from_text(context))} parsed lines)"
                    )
        elif (
            order_state
            and has_context
            and intent in ("question", "complete_request")
            and self._extract_menu_entries_from_text(context)
        ):
            order_state["_session_menu_blob"] = context
            print(f"[ORDER] Cached {len(self._extract_menu_entries_from_text(context))} menu entries from KB for session")

        # Order turns need menu context even when RAG is skipped — catalog may be empty.
        if (
            not campaign_mode
            and intent.startswith("order_")
            and order_state is not None
        ):
            menu_ctx = self._ensure_order_menu_context(
                order_state,
                context,
                agent_id,
                tenant_id,
                context_provider,
            )
            if menu_ctx:
                context = self._merge_contexts([menu_ctx, context]) if context else menu_ctx
                if menu_ctx != (context or ""):
                    self._sync_currency_from_context(menu_ctx)

        # Voice + catalog populated: never let KB invent off-menu items in answers.
        if (
            not campaign_mode
            and channel == "voice"
            and intent in ("question", "complete_request")
            and agent_id
            and tenant_id
        ):
            menu_idx = self._get_menu_index(agent_id, tenant_id, order_state)
            if menu_idx and menu_idx.items and menu_idx.source == "catalog":
                context = (
                    f"{menu_idx.blob}\n\n"
                    "RULE: Only mention menu items listed above with exact names and prices. "
                    "Never mention any dish that is not in that list.\n\n"
                    + (context or "")
                )
                has_context = bool(context and context != "No relevant context found.")

        fallback = (config.response_config or {}).get(
            "fallbackMessage", "I'm only able to help with requests related to this business."
        )

        is_closing = intent == "closing"
        in_domain = plan.get("in_domain", True)
        planner_wants_close = plan.get("should_close", False)

        # SAFETY: If there's an active order, NEVER let closing intent reach
        # the backend - it triggers EXIT_INTENTS → Twilio hangup.
        # Only auto-submit when the user is truly ending the call AND the order
        # passed review guards — never on planner_wants_close alone ("please order").
        has_active_order_items = (
            order_state and order_state.get("items")
            and order_state.get("status") not in ("submitted", "idle", None)
        )
        if (
            not campaign_mode
            and is_closing
            and has_active_order_items
        ):
            submit_ok, _ = can_final_submit(order_state)
            if submit_ok and agent_id and tenant_id:
                submitted = self._submit_order_to_backend(
                    agent_id=agent_id,
                    tenant_id=tenant_id,
                    session_id=session_id or "unknown",
                    order_state=order_state,
                    channel=channel,
                )
                if submitted:
                    print(f"[RUNTIME] Auto-submitted order on closing - {len(order_state.get('items', []))} items")
                    order_state["status"] = "submitted"
                    order_event = "submitted"
                    # Auto-capture lead from customer data on closing auto-submit too
                    _cust = order_state.get("customer", {})
                    if _cust.get("name") or _cust.get("phone"):
                        _ord_items = order_state.get("items", [])
                        _items_desc = ", ".join(
                            f"{it.get('name','?')} x{it.get('quantity',1)}"
                            for it in _ord_items[:4]
                            if it.get("name") and it.get("name") != "Delivery Charge"
                        )
                        _ord_type = order_state.get("order_type", "order")
                        _existing = lead_state.get("data", {}) if lead_state else {}
                        _merged: Dict[str, Any] = dict(_existing)
                        for _k in ("name", "phone", "email"):
                            if _cust.get(_k) and not _merged.get(_k):
                                _merged[_k] = _cust[_k]
                        if not _merged.get("interest"):
                            _merged["interest"] = f"{_ord_type.title()} order: {_items_desc}" if _items_desc else f"Placed {_ord_type} order"
                        _merged["tags"] = list({*_merged.get("tags", []), "order_placed"})
                        _sub = self._submit_lead_to_backend(
                            agent_id=agent_id, tenant_id=tenant_id,
                            session_id=session_id or "unknown",
                            lead_data=_merged, channel=channel,
                        )
                        if _sub:
                            lead_event = "order_captured"
                            lead_state = {"captured": True, "data": _merged, "lead_id": _sub.get("_id")}
                else:
                    print(f"[RUNTIME] Auto-submit on closing FAILED - keeping order active")
                    is_closing = False
            else:
                print("[RUNTIME] Closing with incomplete order — detail ladder required, not auto-submitting")
                is_closing = False
                if intent == "closing":
                    intent = "order_confirm"

        # If we retrieved relevant context, force in_domain=True (evidence beats planner)
        if has_context:
            in_domain = True

        print(f"[RUNTIME] in_domain={in_domain}, is_closing={is_closing}, planner_close={planner_wants_close}")

        # --- Order flow handling ---
        order_context = ""
        order_event = None  # track order lifecycle events for caller
        # Deterministic reply that lets us skip the LLM entirely. Set by
        # detail-collection / lead-capture / order-status branches below.
        # When non-empty, we send this verbatim instead of calling Groq/Ollama,
        # which both eliminates Ollama-fallback latency spikes (30–60s) and
        # guarantees we never hallucinate a fresh greeting mid-order.

        # Voice: KB lookup ran but found nothing — refuse to invent menu/location facts.
        if (
            channel == "voice"
            and not has_context
            and retrieval_queries
            and intent in ("question", "complete_request", "navigation")
            and not campaign_mode
        ):
            business = (config.business_name or "our team").strip()
            canned_response = (
                f"I don't have that detail available right now. "
                f"For the most accurate information, please contact {business} directly."
            )
            print("[RUNTIME] voice KB miss — canned response (no hallucination)")

        if order_state is None:
            order_state = {"items": [], "status": "idle", "customer": {}}

        if not campaign_mode:
            # Pre-seed caller phone when Twilio PSTN exposes a validated mobile.
            # Mark phone_source caller_id → flow asks audible confirmation before email.
            if caller_phone and not order_state.get("customer", {}).get("phone"):
                _ok, _norm_phone, _ = self._validate_phone(caller_phone, currency=currency)
                if _ok:
                    order_state.setdefault("customer", {})["phone"] = _norm_phone
                    order_state["phone_source"] = "caller_id"
                    order_state.pop("caller_phone_confirmed", None)
                    print(f"[ORDER] Pre-seeded caller phone (awaiting verbal confirm): {_norm_phone} (channel={channel})")

        if not campaign_mode and intent.startswith("order_"):
            print(f"[ORDER] Intent: {intent}, current order status: {order_state.get('status')}")

            if intent == "order_cancel":
                order_event = "cancelled"
                cancelled_state = order_state
                order_state = {"items": [], "status": "idle", "customer": {}}
                order_context = "The customer's order has been CANCELLED. Confirm cancellation."
                canned_response = self._render_order_status_text(
                    event="cancelled", order_state=cancelled_state, channel=channel,
                )

            elif intent == "order_status":
                self._sync_order_totals(order_state)
                summary = self._format_order_summary(order_state)
                order_context = summary
                canned_response = self._render_order_status_text(
                    event="cart_summary",
                    order_state=order_state,
                    channel=channel,
                )

            elif intent == "order_confirm":
                if order_state.get("status") == "submitted":
                    canned_response = self._render_order_status_text(
                        event="submitted",
                        order_state=order_state,
                        order_id=order_state.get("_last_order_id"),
                        channel=channel,
                    )
                elif order_state.get("status") == "reviewing":
                    # ── Final explicit confirmation after review summary - submit now ──
                    submit_ok, submit_reason = can_final_submit(order_state)
                    items_ok, items_reason = validate_items_for_submit(
                        order_state.get("items", []),
                    )
                    submitted = None
                    tried_backend = False
                    if not submit_ok:
                        print(f"[ORDER] Submit blocked: {submit_reason}")
                        order_context = (
                            "Customer tried to confirm but order is not ready to submit. "
                            "Continue collecting missing details."
                        )
                        order_event = "awaiting_details"
                    elif not items_ok:
                        print(f"[ORDER] Submit blocked: invalid items — {items_reason}")
                        order_context = (
                            "ORDER SUBMISSION BLOCKED — one or more items have no price. "
                            "Apologise and ask the customer to name the item again from the menu."
                        )
                        order_event = "submission_failed"
                        canned_response = (
                            "I'm sorry — I couldn't verify the price for one of your items. "
                            "Could you tell me the item name again from our menu?"
                        )
                    elif not mark_submit_attempt(order_state, session_id or "unknown"):
                        canned_response = self._render_order_status_text(
                            event="submitted",
                            order_state=order_state,
                            order_id=order_state.get("_last_order_id"),
                            channel=channel,
                        )
                    elif agent_id and tenant_id:
                        tried_backend = True
                        submitted = self._submit_order_to_backend(
                            agent_id=agent_id,
                            tenant_id=tenant_id,
                            session_id=session_id or "unknown",
                            order_state=order_state,
                            channel=channel,
                        )
                    summary = self._format_order_summary(order_state)
                    if submitted:
                        order_id = submitted.get("_id", "")
                        order_context = (
                            f"ORDER PLACED SUCCESSFULLY (Order #{order_id[-6:] if order_id else 'N/A'})!\n"
                            f"{summary}\nThank the customer warmly and confirm the order is being processed."
                        )
                        order_event = "submitted"
                        order_state["status"] = "submitted"
                        order_state["_last_order_id"] = order_id
                        order_state.pop("detail_step", None)
                        order_state.pop("_review_confirm_line", None)
                        order_state.pop("_review_summary_line", None)
                        subtotal = sum(
                            float(it.get("price") or 0) * int(it.get("quantity") or 1)
                            for it in order_state.get("items", [])
                        )
                        delivery = self._get_delivery_charge(order_state)
                        order_state["subtotal"] = subtotal
                        order_state["total"] = subtotal + delivery
                        canned_response = self._render_order_status_text(
                            event="submitted",
                            order_state=order_state,
                            order_id=order_id,
                            channel=channel,
                        )

                        # Auto-capture/update lead from order customer data.
                        # _detect_lead_signals() can't extract bare name answers ("Muhammad"),
                        # so we pull directly from the collected order_state["customer"].
                        customer = order_state.get("customer", {})
                        if agent_id and tenant_id and (customer.get("name") or customer.get("phone")):
                            order_items = order_state.get("items", [])
                            items_desc = ", ".join(
                                f"{it.get('name','?')} x{it.get('quantity', 1)}"
                                for it in order_items[:4]
                                if it.get("name") and it.get("name") != "Delivery Charge"
                            )
                            ord_type = order_state.get("order_type", "order")
                            order_interest = f"{ord_type.title()} order: {items_desc}" if items_desc else f"Placed {ord_type} order"

                            existing_data = lead_state.get("data", {}) if lead_state else {}
                            merged_lead_data: Dict[str, Any] = dict(existing_data)
                            for k in ("name", "phone", "email"):
                                val = customer.get(k)
                                if val and not merged_lead_data.get(k):
                                    merged_lead_data[k] = val
                            if not merged_lead_data.get("interest"):
                                merged_lead_data["interest"] = order_interest
                            merged_lead_data["tags"] = list(
                                {*merged_lead_data.get("tags", []), "order_placed"}
                            )

                            sub_lead = self._submit_lead_to_backend(
                                agent_id=agent_id,
                                tenant_id=tenant_id,
                                session_id=session_id or "unknown",
                                lead_data=merged_lead_data,
                                channel=channel,
                            )
                            if sub_lead:
                                lead_event = "order_captured"
                                lead_state = {
                                    "captured": True,
                                    "data": merged_lead_data,
                                    "lead_id": sub_lead.get("_id"),
                                }
                                print(f"[LEAD] Auto-captured from order - name={merged_lead_data.get('name')}, phone={merged_lead_data.get('phone')}")
                    elif tried_backend:
                        # Backend call failed - do NOT confirm the order to the customer
                        order_context = (
                            "ORDER SUBMISSION FAILED due to a system error. "
                            "Apologise sincerely to the customer and ask them to try again or contact the business directly. "
                            "Do NOT say the order was placed, confirmed, or is being processed."
                        )
                        order_event = "submission_failed"
                        canned_response = self._render_order_status_text(
                            event="submission_failed",
                            order_state=order_state,
                            channel=channel,
                        )
                        # Keep status as reviewing so the customer can retry

                elif order_state.get("items"):
                    # ── Start collecting customer details ──
                    self._sync_order_totals(order_state)
                    order_state["status"] = "awaiting_details"
                    summary = self._format_order_summary(order_state)
                    order_context, next_step, canned_text = self._build_detail_prompt(
                        order_state=order_state,
                        summary=summary,
                        invalid_field=None,
                        channel=channel,
                    )
                    canned_response = canned_text or canned_response
                    if next_step == "review":
                        order_event = "reviewing"
                        order_state["status"] = "reviewing"
                    else:
                        order_event = "awaiting_details"

                else:
                    # Empty cart — recover item names from confirm utterances when possible.
                    combined_query = self._build_combined_order_query(
                        query, order_state, history,
                    )
                    recovered = self._try_catalog_match_items(
                        combined_query,
                        context or "",
                        agent_id=agent_id,
                        tenant_id=tenant_id,
                        order_state=order_state,
                    )
                    if not recovered and self._utterance_names_order_item(combined_query):
                        recovered = self._extract_order_items(
                            combined_query,
                            history,
                            context,
                            agent_id=agent_id,
                            tenant_id=tenant_id,
                        )
                    if recovered and self._apply_items_to_order_state(
                        order_state,
                        recovered,
                        combined_query,
                        "order_add",
                        context or "",
                        agent_id=agent_id,
                        tenant_id=tenant_id,
                    ):
                        order_event = "items_updated"
                        summary = self._format_order_summary(order_state)
                        order_context = (
                            f"{summary}\n\nRecovered items from the customer's request. "
                            "Ask if they want anything else or to place the order."
                        )
                        canned_response = self._render_order_add_text(
                            order_state=order_state,
                            summary=summary,
                            items_added=True,
                            channel=channel,
                            added_items=recovered,
                        )
                    else:
                        order_context = (
                            "The customer tried to confirm but has no items in their order."
                        )
                        summary = self._format_order_summary(order_state)
                        canned_response = self._render_order_add_text(
                            order_state=order_state,
                            summary=summary,
                            items_added=False,
                            channel=channel,
                        )

            elif intent in ("order_add", "order_modify"):
                # If starting a new order after previous was submitted, reset state
                if order_state.get("status") == "submitted":
                    order_state = {"items": [], "status": "collecting", "customer": {}}
                # If modifying from awaiting_details or reviewing, go back to collecting
                if order_state.get("status") in ("awaiting_details", "reviewing"):
                    order_state["status"] = "collecting"

                pending_at = order_state.get("pending_item_phrase_at", 0)
                if pending_at and (_time.time() - pending_at) > 15:
                    order_state.pop("pending_item_phrase", None)
                    order_state.pop("pending_item_phrase_at", None)

                combined_query = self._build_combined_order_query(query, order_state, history)
                items_were_added = False
                items_were_removed = False
                added_batch: List[Dict[str, Any]] = []
                removed_batch: List[Dict[str, Any]] = []
                is_remove = (
                    intent == "order_modify"
                    and any(
                        w in combined_query.lower()
                        for w in ["remove", "take off", "no more", "without"]
                    )
                )

                fuzzy_hit = self._try_catalog_match_items(
                    combined_query,
                    context or "",
                    agent_id=agent_id,
                    tenant_id=tenant_id,
                    order_state=order_state,
                )
                item_residue = self._strip_order_item_residue(combined_query)
                has_item_residue = bool(self._substantive_item_tokens(item_residue))
                still_fragment = (
                    self._looks_like_item_fragment(combined_query)
                    and not fuzzy_hit
                    and not has_item_residue
                )

                if fuzzy_hit:
                    new_items = fuzzy_hit
                elif still_fragment:
                    order_state["pending_item_phrase"] = combined_query
                    order_state["pending_item_phrase_at"] = _time.time()
                    print(f"[ORDER] pending_item_phrase -> '{combined_query}'")
                    new_items = []
                else:
                    new_items = self._extract_order_items(
                        combined_query,
                        history,
                        context,
                        agent_id=agent_id,
                        tenant_id=tenant_id,
                    )

                if new_items and self._apply_items_to_order_state(
                    order_state,
                    new_items,
                    combined_query,
                    intent,
                    context or "",
                    agent_id=agent_id,
                    tenant_id=tenant_id,
                ):
                    order_event = "items_updated"
                    if is_remove:
                        items_were_removed = True
                        removed_batch = new_items
                    else:
                        items_were_added = True
                        added_batch = new_items
                    self._sync_order_totals(order_state)

                summary = self._format_order_summary(order_state)
                off_menu_reset = False
                if order_state.get("items"):
                    order_context = (
                        f"{summary}\n\nAsk if the customer would like to add anything else, "
                        "or if they'd like to confirm and place the order."
                    )
                elif still_fragment or order_state.get("pending_item_phrase"):
                    order_state["status"] = "collecting"
                    order_context = (
                        "The customer wants to place an order but has NOT named any specific items yet. "
                        "Do NOT assume or invent any items. Ask them what they would like to order."
                    )
                elif items_were_added or fuzzy_hit:
                    order_state["status"] = "collecting"
                    order_context = (
                        "The customer wants to place an order but has NOT named any specific items yet. "
                        "Do NOT assume or invent any items. Ask them what they would like to order."
                    )
                else:
                    # Off-menu / unrecognized item — do not lock the session in order mode.
                    order_state["status"] = "idle"
                    order_context = ""
                    order_event = None
                    canned_response = None
                    intent = "question"
                    in_domain = True
                    is_closing = False
                    planner_wants_close = False
                    off_menu_reset = True

                if not off_menu_reset:
                    if still_fragment and not order_state.get("items"):
                        canned_response = self._render_order_fragment_prompt(
                            combined_query,
                            context or "",
                            agent_id=agent_id,
                            tenant_id=tenant_id,
                        )
                    else:
                        canned_response = self._render_order_add_text(
                            order_state=order_state,
                            summary=summary,
                            items_added=items_were_added,
                            channel=channel,
                            added_items=added_batch if items_were_added else None,
                            removed_items=removed_batch if items_were_removed else None,
                        ) or canned_response

            elif intent == "order_details":
                if order_state.get("status") == "collecting" and order_state.get("items"):
                    self._sync_order_totals(order_state)
                    order_state["status"] = "awaiting_details"
                # Customer is providing details step-by-step:
                #   name → confirm_name → [confirm_caller_phone if CLI] → phone → email → confirm_email → order_type → address → review
                customer = order_state.get("customer", {})
                detail_step_before = order_state.get("detail_step")
                step_now = detail_step_before or "name"
                invalid_field: Optional[str] = None

                applied_skip = False
                if step_now == "email" and self._wants_skip_contact_detail(query, "email", channel):
                    order_state["skip_email_detail"] = True
                    customer.pop("email", None)
                    order_state["customer"] = customer
                    applied_skip = True
                elif step_now == "phone" and self._wants_skip_contact_detail(query, "phone", channel):
                    invalid_field = "phone"
                    extracted = {}
                elif step_now == "confirm_caller_phone" and self._wants_skip_contact_detail(query, "phone", channel):
                    order_state.pop("caller_phone_confirmed", None)
                    customer.pop("phone", None)
                    order_state["customer"] = customer
                    invalid_field = "phone"
                    extracted = {}
                elif step_now == "address" and self._wants_skip_contact_detail(
                    query, "address", channel, order_state,
                ):
                    order_state["skip_address_detail"] = True
                    customer.pop("address", None)
                    order_state["customer"] = customer
                    applied_skip = True

                if applied_skip:
                    extracted = {}
                elif step_now == "confirm_name":
                    extracted = {}
                    if self._is_simple_affirmation(query):
                        order_state["name_confirmed"] = True
                    else:
                        tokens = query.strip().split()
                        if (
                            1 <= len(tokens) <= 8
                            and not any(c.isdigit() for c in query)
                            and self._is_plausible_customer_name(query)
                        ):
                            customer["name"] = query.strip()
                            order_state["customer"] = customer
                            order_state.pop("name_confirmed", None)
                elif step_now == "confirm_email":
                    extracted = {}
                    if self._wants_skip_contact_detail(query, "email", channel):
                        order_state["skip_email_detail"] = True
                        customer.pop("email", None)
                        order_state["customer"] = customer
                        order_state.pop("email_confirmed", None)
                    elif self._is_simple_affirmation(query):
                        order_state["email_confirmed"] = True
                    else:
                        spoken = self._parse_spoken_email(query)
                        candidate = spoken or query.strip()
                        ok_em, val_em, _ = self._validate_email(candidate)
                        if ok_em:
                            customer["email"] = val_em
                            order_state["customer"] = customer
                            order_state.pop("email_confirmed", None)
                        elif "@" in candidate or " at " in query.lower():
                            invalid_field = "email"
                elif step_now == "confirm_caller_phone":
                    extracted = {}
                    currency_cn = getattr(self, "_current_currency", "USD")
                    if self._is_simple_affirmation(query):
                        order_state["caller_phone_confirmed"] = True
                    elif self._implies_other_number_than_network_line(query):
                        customer.pop("phone", None)
                        order_state["customer"] = customer
                        order_state["phone_source"] = "manual"
                        order_state.pop("caller_phone_confirmed", None)
                    else:
                        ok_alt, alt_phone, _ = self._validate_phone(query.strip(), currency=currency_cn)
                        if ok_alt:
                            customer["phone"] = alt_phone
                            order_state["customer"] = customer
                            order_state["phone_source"] = "manual"
                            order_state["caller_phone_confirmed"] = True
                else:
                    # Fast heuristic extraction first, fall back to LLM
                    extracted = self._extract_customer_details_fast(query, order_state)
                    if extracted is None:
                        extracted = self._extract_customer_details(query, history)

                phone_fragment_hold = bool(
                    extracted and extracted.get("phone_fragment_pending"),
                )
                if phone_fragment_hold:
                    extracted = {}

                had_phone_in_extraction = bool(
                    extracted and ("phone" in extracted or extracted.get("phone_invalid")),
                )
                had_email_in_extraction = bool(
                    extracted and ("email" in extracted or extracted.get("email_invalid")),
                )

                # Track whether the user just submitted something that failed validation.
                if extracted:
                    # order_type lives at root level, not inside customer
                    order_type_raw = extracted.pop("order_type", None)
                    if order_type_raw:
                        order_state["order_type"] = order_type_raw.lower().strip()
                        self._sync_order_totals(order_state)
                    bad_phone = extracted.pop("phone_invalid", None)
                    if bad_phone is not None:
                        invalid_field = "phone"
                        bad_digits = re.sub(r"\D", "", str(bad_phone))
                        if not bad_digits and query:
                            bad_digits = re.sub(r"\D", "", query)
                        order_state["last_phone_digit_count"] = len(bad_digits) if bad_digits else 0
                    if extracted.pop("email_invalid", None) is not None:
                        invalid_field = "email"
                    for key, val in extracted.items():
                        if val:
                            if key == "name":
                                prev_n = (customer.get("name") or "").strip()
                                new_n = str(val).strip()
                                if new_n and not self._is_plausible_customer_name(new_n):
                                    continue
                                if new_n and new_n != prev_n:
                                    order_state.pop("name_confirmed", None)
                            if key == "phone":
                                order_state["phone_source"] = "manual"
                                order_state["caller_phone_confirmed"] = True
                            if key == "email":
                                prev_e = (customer.get("email") or "").strip().lower()
                                new_e = str(val).strip().lower()
                                if new_e and new_e != prev_e:
                                    order_state.pop("email_confirmed", None)
                            customer[key] = val
                    order_state["customer"] = customer

                # Defence-in-depth: re-validate persisted phone/email so a stale
                # bad value never leaks into the order or lead.
                currency = getattr(self, "_current_currency", "USD")
                if customer.get("phone"):
                    ok, value, _ = self._validate_phone(customer["phone"], currency=currency)
                    if not ok:
                        customer.pop("phone", None)
                        order_state["customer"] = customer
                        if had_phone_in_extraction or detail_step_before == "phone":
                            invalid_field = invalid_field or "phone"
                    else:
                        customer["phone"] = value
                        order_state.pop("skip_phone_detail", None)
                if customer.get("email"):
                    ok, value, _ = self._validate_email(customer["email"])
                    if not ok:
                        customer.pop("email", None)
                        order_state["customer"] = customer
                        if had_email_in_extraction or detail_step_before == "email":
                            invalid_field = invalid_field or "email"
                    else:
                        customer["email"] = value
                        order_state.pop("skip_email_detail", None)

                if customer.get("address"):
                    if self._looks_like_skip_address_placeholder(customer["address"]):
                        customer.pop("address", None)
                        if address_skip_allowed(order_state, channel):
                            order_state["skip_address_detail"] = True
                        else:
                            order_state.pop("skip_address_detail", None)
                            invalid_field = invalid_field or "address"
                        order_state["customer"] = customer
                    else:
                        order_state.pop("skip_address_detail", None)

                summary = self._format_order_summary(order_state)
                order_context, next_step, canned_text = self._build_detail_prompt(
                    order_state=order_state,
                    summary=summary,
                    invalid_field=invalid_field,
                    channel=channel,
                )
                if phone_fragment_hold:
                    canned_response = "Got it — keep going with the rest of the number."
                else:
                    canned_response = canned_text or canned_response
                if next_step == "review":
                    order_state["status"] = "reviewing"
                    order_event = "reviewing"
                else:
                    order_event = "awaiting_details"

        elif not campaign_mode and order_state.get("status") == "collecting" and order_state.get("items"):
            # Passive: show order context even for non-order intents while ordering
            summary = self._format_order_summary(order_state)
            order_context = f"(Active order in progress)\n{summary}"

        elif not campaign_mode and order_state.get("status") == "awaiting_details" and order_state.get("items"):
            # Passive: user asked a question during detail collection
            summary = self._format_order_summary(order_state)
            customer = order_state.get("customer", {})
            cust_parts = []
            if customer.get("name"): cust_parts.append(f"Name: {customer['name']}")
            if customer.get("phone"): cust_parts.append(f"Phone: {customer['phone']}")
            elif order_state.get("skip_phone_detail"): cust_parts.append("Phone: skipped")
            if customer.get("email"): cust_parts.append(f"Email: {customer['email']}")
            elif order_state.get("skip_email_detail"): cust_parts.append("Email: skipped")
            if order_state.get("order_type"): cust_parts.append(f"Order Type: {order_state['order_type'].title()}")
            if customer.get("address"): cust_parts.append(f"Address: {customer['address']}")
            elif order_state.get("skip_address_detail"): cust_parts.append("Address: skipped")
            cust_str = ", ".join(cust_parts) if cust_parts else "none yet"
            order_context = (
                f"(Order pending - awaiting customer details)\n{summary}\n"
                f"Details collected so far: {cust_str}\n"
                f"Answer the customer's question, then remind them to provide their remaining details to complete the order."
            )

        elif not campaign_mode and order_state.get("status") == "reviewing" and order_state.get("items"):
            # Passive: user asked something during the review/confirmation step
            summary = self._format_order_summary(order_state)
            customer = order_state.get("customer", {})
            order_type = order_state.get("order_type", "")
            payment = self.ORDER_TYPE_PAYMENT.get(order_type, "Pay on delivery")
            cust_parts = []
            if customer.get("name"): cust_parts.append(f"Name: {customer['name']}")
            if customer.get("phone"): cust_parts.append(f"Phone: {customer['phone']}")
            elif order_state.get("skip_phone_detail"): cust_parts.append("Phone: skipped")
            if customer.get("email"): cust_parts.append(f"Email: {customer['email']}")
            elif order_state.get("skip_email_detail"): cust_parts.append("Email: skipped")
            if order_type: cust_parts.append(f"Order Type: {order_type.title()}")
            if customer.get("address"): cust_parts.append(f"Address: {customer['address']}")
            elif order_state.get("skip_address_detail"): cust_parts.append("Address: skipped")
            cust_parts.append(f"Payment: {payment}")
            cust_str = ", ".join(cust_parts)
            order_context = (
                f"(ORDER AWAITING FINAL CONFIRMATION)\n{summary}\n"
                f"{cust_str}\n"
                f"Answer the customer's question, then remind them to say 'yes' to confirm and place the order."
            )

        elif not campaign_mode and order_state.get("status") == "submitted" and order_state.get("items"):
            # Order was already submitted - provide context to prevent LLM hallucination
            summary = self._format_order_summary(order_state)
            customer = order_state.get("customer", {})
            cust_parts = []
            if customer.get("name"): cust_parts.append(f"Name: {customer['name']}")
            if customer.get("phone"): cust_parts.append(f"Phone: {customer['phone']}")
            if customer.get("email"): cust_parts.append(f"Email: {customer['email']}")
            if order_state.get("order_type"): cust_parts.append(f"Order Type: {order_state['order_type'].title()}")
            if customer.get("address"): cust_parts.append(f"Address: {customer['address']}")
            elif order_state.get("skip_address_detail"): cust_parts.append("Address: skipped")
            cust_str = ", ".join(cust_parts) if cust_parts else ""
            order_context = (
                f"ORDER ALREADY PLACED AND SUBMITTED.\n{summary}\n"
                f"{f'Customer: {cust_str}' if cust_str else ''}\n"
                f"The order is being processed. Do NOT re-create, duplicate, or modify this order. "
                f"Do NOT ask for customer details that were already provided above. "
                f"ONLY reference items and prices shown in the order summary. "
                f"If the customer wants to place a NEW order, help them start fresh."
            )

        # --- Lead detection (runs alongside every message; skipped on outbound campaigns) ---
        lead_event = None
        if lead_state is None:
            lead_state = {"captured": False, "data": {}}

        lead_context = ""
        proactive_event = None
        force_intent: Optional[str] = None
        lead_canned: Optional[str] = None

        if not campaign_mode:
            # Proactive multi-step capture (name → phone → email) takes priority
            # over the unsolicited detector below. When the capture flow handles
            # the turn, it returns a lead_context for the LLM and may force the
            # intent so RAG/order logic doesn't run.
            (
                lead_context,
                lead_state,
                proactive_event,
                force_intent,
                lead_canned,
            ) = self._build_lead_capture_prompt(
                query=query,
                lead_state=lead_state,
                order_state=order_state,
                history=history or [],
                agent_id=agent_id,
                tenant_id=tenant_id,
                session_id=session_id,
                channel=channel,
            )
            if proactive_event:
                lead_event = proactive_event
            if force_intent:
                # Block normal RAG/closing/order paths for this turn.
                intent = force_intent
                in_domain = True
                has_context = False
                context = ""
                order_context = ""
                # "no thanks" mid-capture should NOT trigger session close.
                is_closing = False
                planner_wants_close = False
                # Lead-capture responses are fully deterministic; override anything
                # the order branch might have set above.
                if lead_canned:
                    canned_response = lead_canned

            lead_signals = {}
            capture_step = ((lead_state or {}).get("data") or {}).get("_capture_step")
            order_active = (
                order_state
                and order_state.get("status") in ("collecting", "awaiting_details", "reviewing")
            )
            order_detail_active = bool(
                order_state
                and order_state.get("status") == "awaiting_details"
                and order_state.get("detail_step") in ("name", "phone", "email", "address", "confirm_caller_phone")
            )
            if capture_step in ("name", "phone", "email") and not order_active and not order_detail_active:
                lead_signals = self._detect_lead_signals(query, history)
            elif capture_step in ("name", "phone", "email"):
                lead_signals = {}
            else:
                lead_signals = {}
            if order_active or order_detail_active:
                lead_signals = {}
            # Skip the unsolicited detector when the proactive flow already handled
            # this turn - otherwise we'd re-submit the same lead.
            if proactive_event:
                lead_signals = {}
            if lead_signals and self._should_capture_lead(lead_signals, lead_state):
                # Merge new signals with existing lead data
                merged_data = {**lead_state.get("data", {})}
                for key in ("name", "email", "phone", "company"):
                    if lead_signals.get(key):
                        merged_data[key] = lead_signals[key]
                # Accumulate interest
                if lead_signals.get("interest"):
                    prev_interest = merged_data.get("interest", "")
                    new_interest = lead_signals["interest"]
                    if prev_interest and new_interest not in prev_interest:
                        merged_data["interest"] = f"{prev_interest}; {new_interest}"
                    else:
                        merged_data["interest"] = new_interest

                # Submit to backend
                if agent_id and tenant_id:
                    submitted = self._submit_lead_to_backend(
                        agent_id=agent_id,
                        tenant_id=tenant_id,
                        session_id=session_id or "unknown",
                        lead_data=merged_data,
                        channel=channel,
                    )
                    if submitted:
                        lead_event = "captured" if not lead_state.get("captured") else "updated"
                        lead_state = {"captured": True, "data": merged_data, "lead_id": submitted.get("_id")}
                        print(f"[LEAD] event={lead_event}, data_keys={list(merged_data.keys())}")
                else:
                    # No backend IDs, just track locally
                    lead_state = {"captured": True, "data": merged_data}
                    lead_event = "captured_local"

        # ── Bypass the LLM for fully deterministic flows ──
        # order_details / order_cancel / order_submitted / lead_details /
        # lead_decline all have exactly-one-correct phrasing computed from
        # state. Calling the LLM here is pure risk: Groq hiccup → Ollama
        # fallback → 30–60s wait + a hallucinated greeting that ignores the
        # current order state (the exact failure shown in the user report).
        # CRITICAL: this MUST run before the closing/OOD guards below - a
        # bare phone number like "03333333333" can fool the planner into
        # OOD-classifying the turn, which would otherwise return the
        # fallback message instead of our deterministic next-step prompt.
        # Voice order-flow lock: acknowledgements / stray intents must not free-LLM
        # during an active cart or detail ladder (prevents "order confirmed" hallucinations).
        if (
            not canned_response
            and channel == "voice"
            and not campaign_mode
            and order_state.get("status") in ("collecting", "awaiting_details", "reviewing")
        ):
            status = order_state.get("status")
            has_items = bool(order_state.get("items"))
            if intent == "order_status" or (
                intent == "question"
                and has_items
                and self._looks_like_cart_total_question(query)
            ):
                self._sync_order_totals(order_state)
                canned_response = self._render_order_status_text(
                    event="cart_summary",
                    order_state=order_state,
                    channel=channel,
                )
                if canned_response:
                    print(
                        f"[RUNTIME] order cart summary (intent={intent}, status={status}) — LLM bypassed"
                    )
            elif intent not in ("question", "complete_request", "navigation", "closing"):
                summary = self._format_order_summary(order_state)
                if status == "collecting":
                    if order_state.get("items"):
                        canned_response = (
                            "Got it. Anything else, or say place order when you're ready."
                        )
                    else:
                        canned_response = self._render_order_add_text(
                            order_state=order_state,
                            summary=summary,
                            items_added=bool(order_state.get("items")),
                            channel=channel,
                        )
                else:
                    _, _, canned_response = self._build_detail_prompt(
                        order_state=order_state,
                        summary=summary,
                        invalid_field=None,
                        channel=channel,
                    )
                if canned_response:
                    print(
                        f"[RUNTIME] order-flow lock (intent={intent}, status={status}) — LLM bypassed"
                    )

        # Deterministic replies bypass the LLM entirely.
        if canned_response:
            if channel == "voice":
                canned_response = self._voice_plain(canned_response)
            timings["llmMs"] = 0
            timings["totalMs"] = int((_time.time() - run_started) * 1000)
            print(
                f"[RUNTIME] canned response (intent={intent}) - "
                f"LLM bypassed, total={timings['totalMs']}ms"
            )
            text = canned_response.strip()
            if on_sentence:
                if (
                    channel == "voice"
                    and order_state.get("detail_step") == "review"
                    and order_state.get("_review_confirm_line")
                    and order_state.get("status") != "submitted"
                    and order_event != "submitted"
                ):
                    summary_line = order_state.get("_review_summary_line") or text
                    confirm_line = order_state.get("_review_confirm_line") or (
                        "Say yes to place your order."
                    )
                    on_sentence(summary_line)
                    on_sentence(confirm_line)
                    text = f"{summary_line} {confirm_line}"
                else:
                    on_sentence(text)
            new_scope = in_domain or has_context or session_in_scope
            return {
                "response": text,
                "plan": plan,
                "context": context,
                "reasoning": plan.get("domain_reason"),
                "intent": intent,
                "in_scope": new_scope,
                "order_event": order_event,
                "order_state": order_state,
                "lead_event": lead_event,
                "lead_state": lead_state,
                "timings": timings,
            }

        # Close conversation if user signals done
        # BUT never close when there's an active order with items
        has_active_order_items = (
            order_state and order_state.get("items")
            and order_state.get("status") not in ("submitted", "idle", None)
        )
        if (is_closing or planner_wants_close) and not has_active_order_items:
            # Return closing intent so backend can hang up the voice call
            closing_text = self._closing_message(config)
            if self._is_explicit_end_call_request(query):
                closing_text = "Thank you for calling. Goodbye!"
            if on_sentence:
                on_sentence(closing_text)
            timings["totalMs"] = int((_time.time() - run_started) * 1000)
            return {
                "response": closing_text,
                "plan": plan,
                "context": "Session closed",
                "reasoning": "User signaled they are done.",
                "intent": "closing",
                "in_scope": False,
                "order_event": order_event,
                "order_state": order_state,
                "lead_event": lead_event,
                "lead_state": lead_state,
                "timings": timings,
            }

        # Block only genuinely out-of-domain requests (no context + planner says false)
        # Order/lead intents are inherently in-domain (we already have the
        # state machine - the planner just doesn't know that), so we never
        # fall through to the fallback here when one of them is active.
        domain_safe_intents = (
            "order_add", "order_confirm", "order_cancel", "order_modify",
            "order_details", "order_status", "lead_details", "lead_decline",
        )
        if not in_domain and not has_context and intent not in domain_safe_intents:
            timings["totalMs"] = int((_time.time() - run_started) * 1000)
            if on_sentence:
                on_sentence(fallback)
            return {
                "response": fallback,
                "plan": plan,
                "context": "Guardrail: out-of-domain",
                "reasoning": plan.get("domain_reason", "Out of domain"),
                "in_scope": False,
                "order_event": order_event,
                "order_state": order_state,
                "lead_event": lead_event,
                "lead_state": lead_state,
                "timings": timings,
            }

        closing_guidance = ""
        if plan.get("should_close"):
            closing_guidance = "The user has indicated they are done. Provide a warm, brief closing."

        _t = _time.time()
        response = self.respond(
            config=config,
            query=query,
            history_text=history_text,
            plan=plan,
            context=context,
            intent=intent,
            history=history,
            closing_guidance=closing_guidance,
            order_context=order_context,
            channel=channel,
            lead_context=lead_context,
            campaign_mode=campaign_mode,
            on_sentence=on_sentence,
        )
        timings["llmMs"] = int((_time.time() - _t) * 1000)
        timings["totalMs"] = int((_time.time() - run_started) * 1000)
        print(f"[RUNTIME] timings (ms): {timings}")

        if channel == "voice":
            response = sanitize_voice_llm_response(
                response,
                order_state=order_state,
                intent=intent,
                has_kb_context=has_context,
                currency=getattr(self, "_current_currency", "USD"),
            )

        new_scope = in_domain or has_context or session_in_scope
        return {
            "response": response.strip(),
            "plan": plan,
            "context": context,
            "reasoning": plan.get("domain_reason"),
            "intent": intent,
            "in_scope": new_scope,
            "order_event": order_event,
            "order_state": order_state,
            "lead_event": lead_event,
            "lead_state": lead_state,
            "timings": timings,
        }

    @staticmethod
    def _match_price_from_context(item_name: str, context: str) -> float:
        """Try to find the price of an item from the RAG context text."""
        if not item_name or not context:
            return 0.0
        name_lower = item_name.lower()
        for line in context.split("\n"):
            if name_lower in line.lower():
                # Look for price patterns with any currency symbol
                # $, €, £, ₹, Rs., C$, A$, AED, SAR
                price_match = re.search(
                    r'(?:\$|€|£|₹|Rs\.?\s*|AED\s*|SAR\s*|C\$|A\$)(\d+(?:[.,]\d{1,2})?)',
                    line
                )
                if price_match:
                    return float(price_match.group(1).replace(',', '.'))
                # Generic number after dash: "Item - 15.99"
                price_match = re.search(r'[-–-]\s*(\d+(?:\.\d{1,2})?)', line)
                if price_match:
                    return float(price_match.group(1))
        return 0.0

    def _get_cached_catalog(self, agent_id: str, tenant_id: str) -> str:
        """Return full menu text, cached per agent for CATALOG_CACHE_TTL seconds."""
        import time as _time
        key = f"{tenant_id}:{agent_id}"
        now = _time.time()
        with AgentRuntime._catalog_cache_lock:
            entry = AgentRuntime._catalog_cache.get(key)
            if entry and now - entry[0] < AgentRuntime._CATALOG_CACHE_TTL_SEC:
                return entry[1]
        catalog = self._retrieve_full_catalog(agent_id, tenant_id)
        if catalog:
            with AgentRuntime._catalog_cache_lock:
                AgentRuntime._catalog_cache[key] = (now, catalog)
        return catalog

    def _get_cached_catalog_items(
        self, agent_id: str, tenant_id: str,
    ) -> List[Dict[str, Any]]:
        """Structured catalog rows from backend — used for authoritative pricing."""
        import time as _time
        key = f"{tenant_id}:{agent_id}"
        now = _time.time()
        with AgentRuntime._catalog_cache_lock:
            entry = AgentRuntime._catalog_items_cache.get(key)
            if entry and now - entry[0] < AgentRuntime._CATALOG_CACHE_TTL_SEC:
                return entry[1]
        items = self._fetch_catalog_items_struct(agent_id, tenant_id)
        with AgentRuntime._catalog_cache_lock:
            AgentRuntime._catalog_items_cache[key] = (now, items)
        return items

    def _fetch_catalog_items_struct(
        self, agent_id: str, tenant_id: str,
    ) -> List[Dict[str, Any]]:
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3000")
        try:
            with httpx.Client(timeout=8) as client:
                resp = client.get(
                    f"{backend_url}/api/internal/catalog",
                    params={"agentId": agent_id, "tenantId": tenant_id},
                    headers=_internal_api_headers(),
                )
                if resp.status_code != 200:
                    return []
                payload = resp.json()
                if isinstance(payload, dict):
                    return payload.get("items", []) or []
                return payload if isinstance(payload, list) else []
        except Exception as e:
            print(f"[CATALOG] Structured fetch failed: {e}")
            return []

    def _price_for_catalog_item(
        self,
        item_name: str,
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> float:
        norm = self._normalize_menu_text(item_name)
        if agent_id and tenant_id:
            for row in self._get_cached_catalog_items(agent_id, tenant_id):
                row_name = self._normalize_menu_text(row.get("name", ""))
                if row_name == norm or norm in row_name or row_name in norm:
                    price = float(row.get("price") or 0)
                    if price > 0:
                        return price
        catalog_blob = context or ""
        if agent_id and tenant_id and not catalog_blob:
            catalog_blob = self._get_cached_catalog(agent_id, tenant_id)
        return self._match_price_from_context(item_name, catalog_blob)

    def _enrich_items_prices(
        self,
        items: List[Dict[str, Any]],
        context: str,
        agent_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        order_state: Optional[Dict] = None,
    ) -> None:
        idx = self._get_menu_index(agent_id, tenant_id, order_state)
        if idx:
            idx.enrich_item_prices(items)
            if all(float(it.get("price") or 0) > 0 for it in items):
                return

        catalog_blob = self._resolve_order_catalog_context(
            context, agent_id, tenant_id,
        )
        for item in items:
            if float(item.get("price") or 0) > 0:
                continue
            name = item.get("name", "")
            item["price"] = self._price_for_catalog_item(
                name, catalog_blob, agent_id=agent_id, tenant_id=tenant_id,
            )
            if float(item.get("price") or 0) <= 0 and name:
                print(f"[ORDER] Warning: no catalog price for '{name}'")

    def _retrieve_full_catalog(self, agent_id: str, tenant_id: str) -> str:
        """Fetch ALL available catalog items from the backend for full-menu queries."""
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3000")
        try:
            with httpx.Client(timeout=8) as client:
                resp = client.get(
                    f"{backend_url}/api/internal/catalog",
                    params={"agentId": agent_id, "tenantId": tenant_id},
                    headers=_internal_api_headers(),
                )
                if resp.status_code != 200:
                    return ""
                payload = resp.json()
                # Support both old (plain list) and new (dict with items + currency) format
                if isinstance(payload, dict):
                    items = payload.get("items", [])
                    catalog_currency = payload.get("currency", "USD")
                else:
                    items = payload
                    catalog_currency = "USD"
                if not items:
                    return ""
                # Use the authoritative currency from the backend; update thread-local
                # so _format_order_summary uses the right symbol for this request.
                sym = self.CURRENCY_SYMBOLS.get(catalog_currency, "$")
                if not getattr(self, "_lock_workspace_currency", False) and catalog_currency != self._current_currency:
                    print(f"[CATALOG] Currency override: {self._current_currency} → {catalog_currency}")
                    self._current_currency = catalog_currency
                    self._currency_symbol = sym
                # Group by category
                by_cat: Dict[str, list] = {}
                for item in items:
                    cat = item.get("category") or "Other"
                    by_cat.setdefault(cat, []).append(item)
                lines = ["=== COMPLETE MENU ==="]
                for cat, cat_items in sorted(by_cat.items()):
                    lines.append(f"\n{cat}:")
                    for it in cat_items:
                        price = it.get("price", 0)
                        name = it.get("name", "")
                        desc = (it.get("description") or "").strip()
                        entry = f"  • {name}: {sym}{price:.0f}"
                        if desc:
                            entry += f" - {desc[:80]}"
                        lines.append(entry)
                return "\n".join(lines)
        except Exception as e:
            print(f"[CATALOG] Full-menu retrieval failed: {e}")
            return ""

    # --- Lead Detection & Extraction ---

    def _detect_lead_signals(self, query: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Detect contact information and interest signals in the conversation.
        Returns extracted lead data (name, email, phone, interest signals).
        """
        normalized = query.lower().strip()
        lead_data: Dict[str, Any] = {}

        # Extract email
        email_match = self.EMAIL_PATTERN.search(query)
        if email_match:
            lead_data["email"] = email_match.group(0)

        # Extract phone number
        phone_match = self.PHONE_PATTERN.search(query)
        if phone_match:
            phone_str = phone_match.group(0).strip()
            # Only count as phone if it has enough digits
            digits = re.sub(r'\D', '', phone_str)
            if len(digits) >= 7:
                lead_data["phone"] = phone_str

        # Extract name from "my name is X" patterns
        for phrase in self.LEAD_NAME_PHRASES:
            if phrase in normalized:
                after = query[normalized.index(phrase) + len(phrase):].strip()
                # Take the next 1-4 words as name
                name_words = after.split()[:4]
                name = " ".join(name_words).strip(".,!?")
                if name and len(name) > 1:
                    lead_data["name"] = name.title()
                break

        # Detect contact intent
        has_contact_intent = any(p in normalized for p in self.LEAD_CONTACT_PHRASES)
        if has_contact_intent:
            lead_data["contact_intent"] = True

        # Detect interest signals
        interest_phrases_found = [p for p in self.LEAD_INTEREST_PHRASES if p in normalized]
        if interest_phrases_found:
            lead_data["interest"] = query  # Store the full query as interest context

        # Also scan recent history for earlier mentions
        if history:
            for entry in history[-6:]:
                if entry.get("role") != "user":
                    continue
                old_content = entry.get("content", "")
                if not lead_data.get("email"):
                    em = self.EMAIL_PATTERN.search(old_content)
                    if em:
                        lead_data["email"] = em.group(0)
                if not lead_data.get("phone"):
                    pm = self.PHONE_PATTERN.search(old_content)
                    if pm:
                        digits = re.sub(r'\D', '', pm.group(0))
                        if len(digits) >= 7:
                            lead_data["phone"] = pm.group(0).strip()
                if not lead_data.get("name"):
                    old_lower = old_content.lower()
                    for phrase in self.LEAD_NAME_PHRASES:
                        if phrase in old_lower:
                            after = old_content[old_lower.index(phrase) + len(phrase):].strip()
                            name_words = after.split()[:4]
                            name = " ".join(name_words).strip(".,!?")
                            if name and len(name) > 1:
                                lead_data["name"] = name.title()
                            break

        return lead_data

    def _should_capture_lead(self, lead_signals: Dict[str, Any], lead_state: Optional[Dict] = None) -> bool:
        """
        Determine if we have enough info to capture/update a lead.
        Only runs during the explicit proactive ladder (name → phone → email).
        """
        capture_step = ((lead_state or {}).get("data") or {}).get("_capture_step")
        if capture_step not in ("name", "phone", "email"):
            return False

        has_email = bool(lead_signals.get("email"))
        has_phone = bool(lead_signals.get("phone"))
        has_name = bool(lead_signals.get("name"))
        has_interest = bool(lead_signals.get("interest"))

        # Already captured in this session? Only update if we have new contact info
        if lead_state and lead_state.get("captured"):
            prev = lead_state.get("data", {})
            new_email = has_email and lead_signals.get("email") != prev.get("email")
            new_phone = has_phone and lead_signals.get("phone") != prev.get("phone")
            new_name = has_name and not prev.get("name")
            return new_email or new_phone or new_name

        # First capture: need at least one contact channel
        if has_email or has_phone:
            return True
        # Name + interest is also valuable enough
        if has_name and has_interest:
            return True
        return False

    LEAD_DECLINE_PHRASES = [
        "no thanks", "no thank you", "not interested", "not now",
        "skip that", "skip it", "maybe later", "another time",
        "don't need", "dont need", "not required",
        "not here to give", "don't want to give", "dont want to give",
        "don't wanna give", "dont wanna give", "don't wanna", "dont wanna",
        "won't give", "wont give", "without giving", "not giving my phone",
        "give you my phone", "my phone number", "no phone number", "just asking", "only asking", "about menu",
        "talk about menu", "menu and other", "for what order", "not ordering",
        "not here to order", "what order", "just information", "just info",
    ]

    # Phrases specific to the email step that mean "skip email, proceed without it"
    # rather than declining the entire lead capture.
    EMAIL_SKIP_PHRASES = [
        "skip", "no email", "skip email", "skip the email", "leave the email",
        "without email", "forget the email", "no email address", "don't have email",
        "dont have email", "don't have an email", "dont have an email",
        "keep the email", "get the email", "just proceed", "move on",
        "that's fine", "thats fine", "it's fine", "its fine",
    ]

    def _build_lead_capture_prompt(
        self,
        query: str,
        lead_state: Dict,
        order_state: Dict,
        history: List[Dict[str, str]],
        agent_id: Optional[str],
        tenant_id: Optional[str],
        session_id: Optional[str],
        channel: str,
    ) -> tuple:
        """
        Drive a proactive lead-capture flow: name → phone → email → captured.

        Returns ``(lead_context, lead_state, lead_event, force_intent, canned_response)``.
        ``force_intent`` is a string (e.g. "lead_details") when this turn
        should bypass normal RAG/intent handling, otherwise None.
        ``canned_response`` is the deterministic customer-facing reply when
        run() should skip the LLM (always set when this flow is active).
        """
        # Order flow always wins - never compete for the same fields.
        # Status alone is sufficient: "collecting" is set even before any item
        # is added (e.g. "I want to place an order"), so checking items would
        # incorrectly allow lead capture to fire on the very next turn.
        has_active_order_items = (
            order_state and order_state.get("status") in ("collecting", "awaiting_details", "reviewing")
        )
        if has_active_order_items:
            return "", lead_state, None, None, None

        data: Dict[str, Any] = dict(lead_state.get("data", {})) if lead_state else {}
        step = data.get("_capture_step")

        # Voice: name/phone/email are collected only during order checkout (order_state
        # detail ladder). Never run proactive lead capture on a voice call.
        if channel == "voice":
            if step in ("name", "phone", "email"):
                data.pop("_capture_step", None)
                data["_declined"] = True
            cleared = dict(lead_state) if lead_state else {"captured": False, "data": {}}
            cleared["data"] = data
            return "", cleared, None, None, None

        has_name = bool(data.get("name"))
        has_phone = bool(data.get("phone"))
        has_email = bool(data.get("email"))

        # Already fully captured - let the unsolicited detector handle updates.
        if has_name and has_phone and has_email:
            return "", lead_state, None, None, None

        normalized = query.lower().strip()

        # Email step: user wants to skip email — submit with name+phone, don't kill the whole capture.
        if step == "email" and (
            any(p in normalized for p in self.EMAIL_SKIP_PHRASES)
            or any(p in normalized for p in self.LEAD_DECLINE_PHRASES)
        ):
            data["_capture_step"] = "captured"
            data.pop("_declined", None)
            submit_data = {k: v for k, v in data.items() if not str(k).startswith("_")}
            if not submit_data.get("interest"):
                submit_data["interest"] = "Customer requested follow-up"
            submit_data["tags"] = list({*submit_data.get("tags", []), "proactive_capture", "no_email"})
            submitted = None
            if agent_id and tenant_id:
                submitted = self._submit_lead_to_backend(
                    agent_id=agent_id,
                    tenant_id=tenant_id,
                    session_id=session_id or "unknown",
                    lead_data=submit_data,
                    channel=channel,
                )
            new_state: Dict[str, Any] = {"captured": bool(submitted), "data": data}
            if submitted and submitted.get("_id"):
                new_state["lead_id"] = submitted["_id"]
            ctx = (
                f"The customer skipped their email. Lead saved with name ({data.get('name')}) "
                f"and phone ({data.get('phone')}). "
                "Thank them briefly and ask if there's anything else you can help with."
            )
            canned = self._render_lead_capture_text(data=data, next_step="captured", channel=channel)
            return ctx, new_state, ("captured" if submitted else "captured_local"), "lead_details", canned

        # Explicit decline while we're mid-capture
        if step in ("name", "phone", "email") and any(p in normalized for p in self.LEAD_DECLINE_PHRASES):
            data.pop("_capture_step", None)
            data["_declined"] = True
            new_state = dict(lead_state) if lead_state else {}
            new_state["data"] = data
            ctx = (
                "The customer chose not to share contact details right now. "
                "Acknowledge politely in ONE short sentence and continue helping with their original question."
            )
            canned = self._render_lead_capture_text(data=data, next_step="decline", channel=channel)
            return ctx, new_state, None, "lead_decline", canned

        # Customer declined earlier in this session - don't re-ask.
        if data.get("_declined") and not step:
            return "", lead_state, None, None, None

        # ── Active capture step: treat the user message as the answer ──
        if step in ("name", "phone", "email"):
            currency = getattr(self, "_current_currency", "USD")
            invalid: Optional[str] = None

            if step == "name":
                extracted_name = None
                lower = normalized
                # Try LEAD_NAME_PHRASES first ("my name is …")
                for phrase in self.LEAD_NAME_PHRASES:
                    if phrase in lower:
                        after = query[lower.index(phrase) + len(phrase):].strip()
                        words = after.split()[:4]
                        candidate = " ".join(words).strip(".,!?\"'")
                        if candidate and len(candidate) > 1:
                            extracted_name = candidate.title()
                            break
                # Bare-name reply: short, no digits, no email, no obvious URL
                if not extracted_name:
                    cleaned = query.strip().strip(".,!?\"'")
                    if (
                        2 <= len(cleaned) <= 60
                        and len(cleaned.split()) <= 5
                        and not any(c.isdigit() for c in cleaned)
                        and "@" not in cleaned
                        and "http" not in cleaned.lower()
                        and self._is_plausible_customer_name(cleaned)
                        and not self._is_question(query)
                    ):
                        extracted_name = cleaned.title()
                if extracted_name and self._is_plausible_customer_name(extracted_name):
                    data["name"] = extracted_name
                    data["_capture_step"] = "phone"

            elif step == "phone":
                ok, value, _ = self._validate_phone(query, currency=currency)
                if ok:
                    data["phone"] = value
                    data["_capture_step"] = "email"
                else:
                    invalid = "phone"

            elif step == "email":
                em = self._EMAIL_STRICT.search(query.strip())
                if em:
                    ok, value, _ = self._validate_email(em.group(0))
                    if ok:
                        data["email"] = value
                        data["_capture_step"] = "captured"
                    else:
                        invalid = "email"
                else:
                    # Fallback to looser pattern
                    em2 = self.EMAIL_PATTERN.search(query.strip())
                    if em2:
                        ok2, value2, _ = self._validate_email(em2.group(0))
                        if ok2:
                            data["email"] = value2
                            data["_capture_step"] = "captured"
                        else:
                            invalid = "email"
                    else:
                        invalid = "email"

            has_name = bool(data.get("name"))
            has_phone = bool(data.get("phone"))
            has_email = bool(data.get("email"))

            # All three captured - submit immediately.
            if has_name and has_phone and has_email:
                data["_capture_step"] = "captured"
                data.pop("_declined", None)
                submit_data = {k: v for k, v in data.items() if not str(k).startswith("_")}
                if not submit_data.get("interest"):
                    submit_data["interest"] = "Customer requested follow-up"
                submit_data["tags"] = list({*submit_data.get("tags", []), "proactive_capture"})

                submitted = None
                if agent_id and tenant_id:
                    submitted = self._submit_lead_to_backend(
                        agent_id=agent_id,
                        tenant_id=tenant_id,
                        session_id=session_id or "unknown",
                        lead_data=submit_data,
                        channel=channel,
                    )

                lead_id = submitted.get("_id") if submitted else None
                new_state: Dict[str, Any] = {
                    "captured": bool(submitted),
                    "data": data,
                }
                if lead_id:
                    new_state["lead_id"] = lead_id
                ctx = (
                    "ALL CONTACT DETAILS COLLECTED.\n"
                    f"Name: {data.get('name')}, Phone: {data.get('phone')}, Email: {data.get('email')}\n"
                    "Thank the customer warmly by name and confirm we'll follow up soon. "
                    "Then ask if there's anything else they'd like help with. Keep it to ONE short sentence."
                )
                canned = self._render_lead_capture_text(data=data, next_step="captured", channel=channel)
                return ctx, new_state, ("captured" if submitted else "captured_local"), "lead_details", canned

            # Build the next-prompt context.
            phone_hint = self._phone_validation_hint()
            if invalid == "phone":
                ctx = (
                    f"The phone number wasn't valid internally ({phone_hint}). "
                    "Apologise briefly and invite them to repeat slowly in plain words."
                    " Do NOT dictate technical numbering templates aloud."
                )
            elif invalid == "email":
                ctx = (
                    "The customer's email isn't valid. "
                    "Apologise briefly and ask again ONLY for a valid email address (e.g. name@example.com). "
                    "Do NOT ask for anything else."
                )
            elif data.get("_capture_step") == "phone":
                ctx = (
                    f"Thank the customer by name ({data.get('name')}). "
                    f"Now ask ONLY for a phone number ({phone_hint} for validation reference only "
                    "- do NOT verbalise jargon). Speak conversationally."
                )
            elif data.get("_capture_step") == "email":
                ctx = (
                    "Acknowledge the phone number briefly. "
                    "Now ask ONLY for their email address so we can send a confirmation."
                )
            else:
                # Still on name step - likely couldn't extract a name
                ctx = (
                    "We didn't catch the customer's name. "
                    "Politely ask again ONLY for their full name. Do NOT ask for anything else."
                )

            new_state = dict(lead_state) if lead_state else {}
            new_state["data"] = data
            # Re-prompts mid-step also use a deterministic reply (e.g. invalid
            # phone/email re-ask, or moving from name→phone→email).
            current_step = data.get("_capture_step")
            canned_step = current_step if current_step in ("name", "phone", "email") else None
            canned = self._render_lead_capture_text(
                data=data,
                next_step=canned_step or "name",
                invalid_field=invalid,
                channel=channel,
            )
            return ctx, new_state, None, "lead_details", canned

        # ── No active step: should we trigger? ──
        # Conservative trigger: explicit interest phrase + no contact info yet
        # + not declined + not a closing/greeting message.
        if data.get("_declined"):
            return "", lead_state, None, None, None

        has_interest = any(p in normalized for p in self.LEAD_INTEREST_PHRASES)
        if not has_interest:
            return "", lead_state, None, None, None

        # Menu availability questions ("do you have sweets?") are Q&A, not lead capture.
        if self._is_menu_availability_question(query):
            return "", lead_state, None, None, None

        # Don't trigger on the very first message (let the agent greet/answer first
        # without diving into a contact form).
        is_first_user_msg = sum(1 for h in (history or []) if h.get("role") == "user") <= 0
        if is_first_user_msg:
            return "", lead_state, None, None, None

        # Already have at least one contact field → let the existing detector
        # opportunistically fill in missing ones. We only trigger the structured
        # flow when we have NOTHING.
        if has_name or has_phone or has_email:
            return "", lead_state, None, None, None

        # Proactive capture only on explicit signup intent — not menu/Q&A interest phrases.
        explicit_signup = (
            "sign me up", "sign up", "get started", "book an appointment",
            "schedule an appointment", "schedule a consultation", "request a demo",
            "get a quote", "call me back", "follow up with me", "contact me about",
        )
        if not any(p in normalized for p in explicit_signup):
            return "", lead_state, None, None, None

        # Kick off proactive capture, name first. We append the prompt to the
        # LLM-generated answer (we still want the agent to answer the actual
        # question), so canned_response stays None here.
        data["_capture_step"] = "name"
        new_state = dict(lead_state) if lead_state else {}
        new_state["data"] = data
        new_state.setdefault("captured", False)
        ctx = (
            "After answering the customer's question, add ONE short follow-up sentence "
            "asking for their name so we can keep them posted. "
            "Example: 'By the way, may I have your name so we can follow up?' "
            "Do NOT ask for phone or email yet - only the name."
        )
        return ctx, new_state, None, None, None

    def _submit_lead_to_backend(
        self, agent_id: str, tenant_id: str, session_id: str,
        lead_data: Dict[str, Any], channel: str = "chat"
    ) -> Optional[Dict]:
        """Submit captured lead to the backend."""
        backend_url = os.environ.get("BACKEND_URL", "http://localhost:3000")

        payload = {
            "agentId": agent_id,
            "tenantId": tenant_id,
            "sessionId": session_id,
            "channel": channel,
            "name": lead_data.get("name"),
            "email": lead_data.get("email"),
            "phone": lead_data.get("phone"),
            "company": lead_data.get("company"),
            "interest": lead_data.get("interest", ""),
            "notes": lead_data.get("notes"),
            "tags": lead_data.get("tags", []),
        }

        try:
            with httpx.Client(timeout=10) as client:
                resp = client.post(
                    f"{backend_url}/api/internal/leads",
                    json=payload,
                    headers=_internal_api_headers(),
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    print(f"[LEAD] Captured lead {data.get('_id')} - name={lead_data.get('name')}, email={lead_data.get('email')}")
                    return data
                else:
                    snippet = (resp.text or "")[:300] or "(empty body)"
                    tip = ""
                    if resp.status_code == 401:
                        tip = (
                            " Tip: Set INTERNAL_API_SECRET in ai_service to match backend INTERNAL_API_SECRET."
                        )
                    elif not _internal_api_headers():
                        tip = " Tip: INTERNAL_API_SECRET is unset in ai_service."
                    print(f"[LEAD] Backend returned {resp.status_code}: {snippet}{tip}")
                    return None
        except Exception as e:
            print(f"[LEAD] Error submitting lead: {e}")
            return None