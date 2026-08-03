"""
Knowledge Base System — website scraper, chunking, and search.

Per-school: every tenant's knowledge base is built from ITS OWN website
(schools.website) and stored against its school_id, and the agent's
lookup_school_info tool only ever searches the calling school's chunks. The
original single-tenant school ('shri-ram-academy') keeps its hand-curated URL
list and static fact chunks below; every other school gets its pages
discovered by crawling its own site.
"""

import httpx
from bs4 import BeautifulSoup
import hashlib
from datetime import datetime
from typing import List, Optional
from src.db import SessionLocal, KnowledgeChunk, School

# The original single-tenant school — the only one with a hand-maintained URL
# list and curated static chunks, both of which are specific to its site.
DEFAULT_SCHOOL_SLUG = "shri-ram-academy"

# TSRA website URLs to scrape
TSRA_URLS = [
    "https://tsrahyderabad.com/",
    "https://tsrahyderabad.com/about-us/",
    "https://tsrahyderabad.com/admission-process/",
    "https://tsrahyderabad.com/ib-programmes/",
    "https://tsrahyderabad.com/shri-differentiators-signature-programmes/",
    "https://tsrahyderabad.com/shri-differentiators-signature-spaces/",
    "https://tsrahyderabad.com/sports-facilities/",
    "https://tsrahyderabad.com/contact-us/",
    "https://tsrahyderabad.com/our-team-tsra/",
    "https://tsrahyderabad.com/events/",
    # Dynamic admissions landing page containing the grade-wise open/closed status, Merak program, and FAQs
    "https://tsrahyderabad.com/ib-admissions-hyderabad/",
]

# Static knowledge chunks injected directly — used for critical info that must be
# 100% deterministic (e.g. admission open/closed status, Merak program details).
# Source: TSRA Admissions landing page shared by admin.
STATIC_KNOWLEDGE_CHUNKS = [
    {
        "source_url": "https://tsrahyderabad.com/admission-process/",
        "page_title": "TSRA Admissions 2026-27 — Grade-wise Status",
        "content": (
            "TSRA Admissions 2026-27 status by grade: "
            "EYP 1 (Nursery) — Admissions OPEN. "
            "EYP 2 (LKG) — Admissions OPEN. "
            "EYP 3 (UKG) — Admissions CLOSED. "
            "PYP 1 (Grade 1) — Admissions CLOSED. "
            "PYP 2 (Grade 2) — Admissions CLOSED. "
            "PYP 3 (Grade 3) — Admissions CLOSED. "
            "PYP 4 (Grade 4) — Admissions CLOSED. "
            "PYP 5 (Grade 5) — Admissions OPEN. "
            "MYP 1 (Grade 6) — Admissions OPEN. "
            "MYP 2 (Grade 7) — Admissions CLOSED. "
            "MYP 3 (Grade 8) — Admissions CLOSED. "
            "MYP 4 (Grade 9) — Admissions CLOSED. "
            "MYP 5 (Grade 10) — Admissions CLOSED. "
            "Curriculum offered: International Baccalaureate (IB) only. "
            "For enquiries call: 091542 65287. "
            "School location: Gachibowli, Hyderabad."
        ),
    },
    {
        "source_url": "https://tsrahyderabad.com/",
        "page_title": "TSRA — Merak Programme Overview",
        "content": (
            "The Merak Programme is a signature initiative of The Shri Ram Academy (TSRA). "
            "It is designed to cultivate curiosity, creativity, and a love of learning beyond the standard IB curriculum. "
            "Merak focuses on experiential learning, project-based challenges, and student-driven inquiry. "
            "It is one of the key differentiators that sets TSRA apart from other IB schools in Hyderabad."
        ),
    },
    {
        "source_url": "https://tsrahyderabad.com/",
        "page_title": "TSRA — School Overview & Key Facts",
        "content": (
            "The Shri Ram Academy (TSRA) is an IB day-boarding school located in Gachibowli, Hyderabad, India. "
            "It offers the International Baccalaureate (IB) curriculum from Nursery (EYP 1) through Grade 10 (MYP 5). "
            "TSRA is an IB World School. It is affiliated with The Shri Ram Schools group. "
            "Key programmes: EYP (Early Years Programme, ages 3-5), PYP (Primary Years Programme, Grades 1-5), "
            "MYP (Middle Years Programme, Grades 6-10). "
            "Core values: Integrity, Courage, Care, and Wisdom. "
            "Contact: +91 75698 91111 | +91 91542 65287. "
            "Address: Gachibowli, Hyderabad. "
            "Admissions enquiry: visit tsrahyderabad.com or call the admissions office."
        ),
    },
]


def scrape_url(url: str) -> Optional[tuple]:
    """
    Scrape a single URL and extract main content.
    
    Returns:
        Tuple of (title, content) or None if failed
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        response = httpx.get(url, headers=headers, timeout=30.0, follow_redirects=True)
        if response.status_code != 200:
            print(f"[SCRAPER] Failed to fetch {url}: {response.status_code}")
            return None
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract title
        title = soup.find('title')
        title_text = title.get_text().strip() if title else url
        
        # Remove script, style, nav, footer elements
        for element in soup(['script', 'style', 'nav', 'footer', 'header']):
            element.decompose()
        
        # Extract main content
        content = soup.get_text(separator=' ', strip=True)
        
        # Clean up whitespace
        content = ' '.join(content.split())
        
        if len(content) < 100:
            print(f"[SCRAPER] Too little content from {url}")
            return None
        
        return (title_text, content)
        
    except Exception as e:
        print(f"[SCRAPER] Error scraping {url}: {e}")
        return None


def chunk_text(text: str, chunk_size: int = 500) -> List[str]:
    """
    Split text into chunks of approximately chunk_size tokens.
    Simple word-based chunking for MVP.
    """
    words = text.split()
    chunks = []
    current_chunk = []
    current_size = 0
    
    for word in words:
        current_chunk.append(word)
        current_size += 1
        
        if current_size >= chunk_size:
            chunks.append(' '.join(current_chunk))
            current_chunk = []
            current_size = 0
    
    if current_chunk:
        chunks.append(' '.join(current_chunk))
    
    return chunks


# Page paths worth crawling on an unknown school site, most useful first. A
# generic school website has no predictable sitemap, so we rank discovered
# same-domain links by whether they look like the pages a parent would ask
# about on an admissions call.
_INTERESTING_LINK_KEYWORDS = [
    "admission", "admissions", "apply", "enrol", "enroll", "fee", "fees",
    "about", "curriculum", "academic", "programme", "program", "contact",
    "facilit", "campus", "faculty", "team", "school", "overview", "why",
    "infrastructure", "sport", "transport", "event",
]


def discover_school_urls(website: str, max_pages: int = 12) -> List[str]:
    """
    Build a crawl list for a school we know nothing about beyond its homepage:
    fetch the homepage, keep the same-domain links, and rank the ones whose
    path looks like an admissions-relevant page ahead of the rest. Returns the
    homepage plus up to max_pages-1 discovered pages.
    """
    from urllib.parse import urljoin, urlparse

    website = (website or "").strip()
    if not website:
        return []
    if not website.startswith(("http://", "https://")):
        website = f"https://{website}"

    urls = [website]
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        response = httpx.get(website, headers=headers, timeout=30.0, follow_redirects=True)
        if response.status_code != 200:
            print(f"[SCRAPER] Could not fetch homepage {website}: {response.status_code}")
            return urls

        home_host = urlparse(str(response.url)).netloc.lower()
        soup = BeautifulSoup(response.text, "html.parser")

        ranked, others = [], []
        seen = {website.rstrip("/")}
        for a in soup.find_all("a", href=True):
            href = a["href"].split("#")[0].strip()
            if not href or href.startswith(("mailto:", "tel:", "javascript:")):
                continue
            absolute = urljoin(str(response.url), href)
            parsed = urlparse(absolute)
            if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != home_host:
                continue
            # Skip asset/media links — they carry no answerable prose.
            if parsed.path.lower().endswith((".pdf", ".jpg", ".jpeg", ".png", ".gif",
                                             ".svg", ".zip", ".mp4", ".webp", ".ico")):
                continue
            normalized = absolute.rstrip("/")
            if normalized in seen:
                continue
            seen.add(normalized)
            path = parsed.path.lower()
            (ranked if any(k in path for k in _INTERESTING_LINK_KEYWORDS) else others).append(absolute)

        urls.extend((ranked + others)[: max_pages - 1])
        print(f"[SCRAPER] Discovered {len(urls)} page(s) to scrape for {website}")
    except Exception as e:
        print(f"[SCRAPER] URL discovery failed for {website}: {e}")

    return urls


def _resolve_school(db, school_id: Optional[str]) -> Optional[School]:
    """The school to build a knowledge base for. school_id=None means the
    original single-tenant school, preserving pre-multitenancy call sites."""
    if school_id:
        return db.query(School).filter(School.id == school_id).first()
    return db.query(School).filter(School.slug == DEFAULT_SCHOOL_SLUG).first()


def get_urls_for_school(school: Optional[School]) -> List[str]:
    """
    The pages to scrape for a school. The original school keeps its curated,
    hand-verified URL list; any other school's pages are discovered from its
    own configured website.
    """
    if school is None or school.slug == DEFAULT_SCHOOL_SLUG:
        return list(TSRA_URLS)
    return discover_school_urls(school.website)


def refresh_knowledge_base(school_id: str = None):
    """
    Rebuild one school's knowledge base from its own website.

    school_id=None targets the original single-tenant school so existing
    callers (startup seed, the legacy nightly job) behave exactly as before.
    Returns the number of chunks written.
    """
    db = SessionLocal()
    try:
        school = _resolve_school(db, school_id)
        resolved_school_id = school.id if school else None
        is_default_school = school is None or school.slug == DEFAULT_SCHOOL_SLUG
        label = school.name if school else "default school"

        urls = get_urls_for_school(school)
        if not urls:
            print(f"[SCRAPER] '{label}' has no website configured — nothing to scrape. "
                  "Set the school's website on the Schools page, then refresh again.")
            return 0

        total_chunks = 0
        for url in urls:
            print(f"[SCRAPER] Processing {url}")
            result = scrape_url(url)
            if not result:
                continue

            title, content = result
            chunks = chunk_text(content, chunk_size=500)

            # Delete this school's existing chunks for this URL. Scoped by
            # school_id as well as URL so two schools that happen to share a
            # source page (or a NULL-school legacy row) can't wipe each other.
            db.query(KnowledgeChunk).filter(
                KnowledgeChunk.source_url == url,
                KnowledgeChunk.school_id == resolved_school_id,
            ).delete()

            # Insert new chunks
            for chunk in chunks:
                content_hash = hashlib.sha256(chunk.encode()).hexdigest()
                knowledge_chunk = KnowledgeChunk(
                    school_id=resolved_school_id,
                    source_url=url,
                    page_title=title,
                    content=chunk,
                    content_hash=content_hash,
                    scraped_at=datetime.utcnow()
                )
                db.add(knowledge_chunk)
                total_chunks += 1

        # Inject static curated chunks (admission status, Merak, school
        # overview). These are hand-written facts about the ORIGINAL school
        # only — asserting them about a different school would be fabrication.
        if is_default_school:
            print(f"[SCRAPER] Injecting {len(STATIC_KNOWLEDGE_CHUNKS)} static knowledge chunks...")
            for sc in STATIC_KNOWLEDGE_CHUNKS:
                content_hash = hashlib.sha256(sc["content"].encode()).hexdigest()
                # Only insert if not already present (idempotent by content hash)
                existing = db.query(KnowledgeChunk).filter(
                    KnowledgeChunk.content_hash == content_hash,
                    KnowledgeChunk.school_id == resolved_school_id,
                ).first()
                if not existing:
                    db.add(KnowledgeChunk(
                        school_id=resolved_school_id,
                        source_url=sc["source_url"],
                        page_title=sc["page_title"],
                        content=sc["content"],
                        content_hash=content_hash,
                        scraped_at=datetime.utcnow()
                    ))
                    total_chunks += 1

        db.commit()

        # The cached copy now describes the old content — drop it so the very
        # next caller question is answered from the freshly scraped pages.
        # Both keys: the school's own, and the unscoped one a single-tenant
        # deployment uses.
        from src.cache import knowledge_cache
        knowledge_cache.invalidate(resolved_school_id)
        knowledge_cache.invalidate("__all__")

        print(f"[SCRAPER] Knowledge base refreshed for '{label}': {total_chunks} chunks")
        return total_chunks

    except Exception as e:
        print(f"[SCRAPER] Error refreshing knowledge base: {e}")
        db.rollback()
        return 0
    finally:
        db.close()


def refresh_all_school_knowledge_bases() -> dict:
    """
    Refresh every active school's knowledge base — used by the nightly job so
    a newly onboarded school's content stays current without anyone clicking
    'Refresh Now'. Returns {school_name: chunk_count}.
    """
    db = SessionLocal()
    try:
        schools = db.query(School).filter(School.status == "active").all()
        targets = [(s.id, s.name, s.slug, s.website) for s in schools]
    finally:
        db.close()

    results = {}
    if not targets:
        # No schools row yet (fresh single-tenant deployment) — refresh the
        # original school's list exactly as the old job did.
        results["default school"] = refresh_knowledge_base()
        return results

    for school_id, name, slug, website in targets:
        if slug != DEFAULT_SCHOOL_SLUG and not (website or "").strip():
            print(f"[SCRAPER] Skipping '{name}' — no website configured")
            continue
        results[name] = refresh_knowledge_base(school_id)
    return results


def search_knowledge(query: str, limit: int = 3, school_id: str = None) -> List[dict]:
    """
    Search a knowledge base for relevant chunks.
    Simple robust keyword-based search.

    Args:
        query: Search query
        limit: Max chunks to return
        school_id: Restrict to this school's chunks. Passing it is what keeps
            one school's agent from answering with another school's facts —
            callers that know the tenant (the lookup_school_info tool, the
            dashboard test-search) must always pass it. None searches every
            chunk, which is only correct for a single-tenant deployment.

    Returns:
        List of dicts with source_url, page_title, content
    """
    db = SessionLocal()
    try:
        import re
        # Clean punctuation and split query
        clean_query = re.sub(r'[^\w\s]', ' ', query.lower())
        query_words = [w for w in clean_query.split() if len(w) > 2]
        if not query_words:
            query_words = [w for w in clean_query.split() if w]

        # Strip common filler/stop words BEFORE scoring. Real callers ask in full
        # sentences ("what are the fees", "does the school have transport") —
        # words like "what"/"are"/"the" appear in nearly every chunk by pure
        # coincidence, so they accumulate spurious partial/substring matches
        # across many chunks. Without this filter, a chunk that's actually
        # unrelated to the real topic word (e.g. "fees") can still "win" on
        # filler-word noise alone, causing the agent to confidently state
        # unrelated content instead of admitting it doesn't have that info.
        STOP_WORDS = {
            "what", "are", "the", "is", "does", "can", "you", "your", "for",
            "and", "with", "have", "has", "this", "that", "will", "would",
            "could", "should", "please", "tell", "know", "there", "their",
            "here", "how", "when", "where", "who", "which", "any", "some",
            "much", "many", "was", "were", "been", "being", "our", "out",
            "not", "yes", "just", "like", "want", "need", "kindly",
        }
        filtered = [w for w in query_words if w not in STOP_WORDS]
        if filtered:
            query_words = filtered

        # STT Typo & Homophone Tolerations:
        # 1. 'economy' is a common transcription error for 'academy'
        if "economy" in query_words:
            query_words.append("academy")
            query_words.append("school")
        # 2. Phonetic spellings of 'Shri Ram'
        for ph in ["seeram", "siaram", "सीराम", "shriram"]:
            if any(ph in w for w in query_words) or ph in clean_query:
                query_words.extend(["shri", "ram", "academy"])
        # 3. If query contains 'about' or 'brief' or 'overview', add school overview keywords
        if any(w in query_words for w in ["about", "brief", "overview", "info", "information"]):
            query_words.extend(["academy", "school", "overview"])

        results = []
        
        if not query_words:
            return []
            
        # This runs while a caller waits on the phone, and it scans every chunk
        # in Python — so the whole set was being pulled from a remote database
        # on each lookup. Cache the pre-processed form: the lowercased,
        # punctuation-stripped text and word set that scoring needs, computed
        # once per refresh instead of once per question.
        # Invalidated whenever the knowledge base is rebuilt, so a "Refresh Now"
        # is reflected immediately rather than after the TTL.
        from src.cache import knowledge_cache

        def _load_chunks():
            q = db.query(KnowledgeChunk)
            if school_id:
                q = q.filter(KnowledgeChunk.school_id == school_id)
            prepared = []
            for ch in q.all():
                clean = re.sub(r'[^\w\s]', ' ', (ch.content or "").lower())
                prepared.append({
                    "source_url": ch.source_url,
                    "page_title": ch.page_title,
                    "content": ch.content,
                    "clean_content": clean,
                    "content_words": set(clean.split()),
                })
            return prepared

        chunks = knowledge_cache.get_or_load(school_id or "__all__", _load_chunks)

        for chunk in chunks:
            clean_content = chunk["clean_content"]
            content_words = chunk["content_words"]

            score = 0
            for qw in query_words:
                if qw in content_words:
                    score += 5  # exact word match
                elif any(qw in cw for cw in content_words):
                    score += 2  # partial match (e.g. query "fee" matches "fees")
                elif qw in clean_content:
                    score += 1  # general substring match

            if score > 0:
                results.append({
                    "source_url": chunk["source_url"],
                    "page_title": chunk["page_title"],
                    "content": chunk["content"],
                    "score": score
                })
        
        # Sort by score and return top results
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]
        
    finally:
        db.close()


def smart_truncate(text: str, limit: int) -> str:
    """
    Truncate text to roughly `limit` characters without cutting mid-word or
    mid-sentence, so answers read out on a live phone call don't trail off
    awkwardly. Prefers the last sentence boundary (. ! ?) before the limit;
    falls back to the last word boundary; falls back to a hard cut only if
    neither is found within a reasonable window.
    """
    if not text or len(text) <= limit:
        return text

    window = text[:limit]

    # Prefer ending on a sentence boundary within the last 40% of the window.
    sentence_end = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
    if sentence_end > limit * 0.6:
        return window[:sentence_end + 1].strip()

    # Otherwise end on a word boundary so we don't cut a word in half.
    space_idx = window.rfind(" ")
    if space_idx > limit * 0.5:
        return window[:space_idx].strip() + "..."

    return window.strip() + "..."


def get_knowledge_status(school_id: str = None) -> dict:
    """
    Get status of a school's knowledge base. school_id=None reports across
    every school (the platform-admin view).
    """
    db = SessionLocal()
    try:
        chunk_query = db.query(KnowledgeChunk)
        if school_id:
            chunk_query = chunk_query.filter(KnowledgeChunk.school_id == school_id)

        from sqlalchemy import func

        total_chunks = chunk_query.count()
        last_scraped = chunk_query.order_by(KnowledgeChunk.scraped_at.desc()).first()

        # How many distinct pages this knowledge base was actually built from,
        # rather than the length of the original school's hardcoded URL list —
        # that number was meaningless for any other school.
        # Counted in SQL: the previous version loaded every chunk's full text
        # into memory just to count distinct URLs, which grows with the size of
        # the knowledge base for a number the database can compute directly.
        url_count_q = db.query(func.count(func.distinct(KnowledgeChunk.source_url)))
        if school_id:
            url_count_q = url_count_q.filter(KnowledgeChunk.school_id == school_id)
        urls_monitored = url_count_q.scalar() or 0

        return {
            "total_chunks": total_chunks,
            "last_scraped": last_scraped.scraped_at.isoformat() if last_scraped else None,
            "urls_monitored": urls_monitored,
            "school_id": school_id,
        }
    finally:
        db.close()
