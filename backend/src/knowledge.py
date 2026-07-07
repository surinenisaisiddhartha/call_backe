"""
Knowledge Base System - Website scraper, chunking, and search for TSRA information.
"""

import httpx
from bs4 import BeautifulSoup
import hashlib
from datetime import datetime
from typing import List, Optional
from src.db import SessionLocal, KnowledgeChunk

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
        response = httpx.get(url, headers=headers, timeout=30.0)
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


def refresh_knowledge_base():
    """
    Scrape all TSRA URLs and update knowledge chunks in database.
    """
    db = SessionLocal()
    try:
        total_chunks = 0
        for url in TSRA_URLS:
            print(f"[SCRAPER] Processing {url}")
            result = scrape_url(url)
            if not result:
                continue
            
            title, content = result
            chunks = chunk_text(content, chunk_size=500)
            
            # Delete existing chunks for this URL
            db.query(KnowledgeChunk).filter(KnowledgeChunk.source_url == url).delete()
            
            # Insert new chunks
            for chunk in chunks:
                content_hash = hashlib.sha256(chunk.encode()).hexdigest()
                knowledge_chunk = KnowledgeChunk(
                    source_url=url,
                    page_title=title,
                    content=chunk,
                    content_hash=content_hash,
                    scraped_at=datetime.utcnow()
                )
                db.add(knowledge_chunk)
                total_chunks += 1
        
        db.commit()
        print(f"[SCRAPER] Knowledge base refreshed: {total_chunks} chunks")
        return total_chunks
        
    except Exception as e:
        print(f"[SCRAPER] Error refreshing knowledge base: {e}")
        db.rollback()
        return 0
    finally:
        db.close()


def search_knowledge(query: str, limit: int = 3) -> List[dict]:
    """
    Search knowledge base for relevant chunks.
    Simple robust keyword-based search.
    
    Args:
        query: Search query
        limit: Maximum number of results to return
    
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
            
        results = []
        
        if not query_words:
            return []
            
        chunks = db.query(KnowledgeChunk).all()
        for chunk in chunks:
            clean_content = re.sub(r'[^\w\s]', ' ', chunk.content.lower())
            content_words = set(clean_content.split())
            
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
                    "source_url": chunk.source_url,
                    "page_title": chunk.page_title,
                    "content": chunk.content,
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


def get_knowledge_status() -> dict:
    """
    Get status of knowledge base.
    """
    db = SessionLocal()
    try:
        total_chunks = db.query(KnowledgeChunk).count()
        last_scraped = db.query(KnowledgeChunk).order_by(
            KnowledgeChunk.scraped_at.desc()
        ).first()
        
        return {
            "total_chunks": total_chunks,
            "last_scraped": last_scraped.scraped_at.isoformat() if last_scraped else None,
            "urls_monitored": len(TSRA_URLS)
        }
    finally:
        db.close()
