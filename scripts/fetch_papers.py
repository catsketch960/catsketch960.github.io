#!/usr/bin/env python3
"""
Fetch generative recommendation papers from arXiv and save as JSON.
Runs daily via GitHub Actions.
"""

import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

ARXIV_API = "https://export.arxiv.org/api/query"

SEARCH_TERMS = [
    "generative recommendation",
    "generative recommender",
    "LLM recommendation",
    "large language model recommendation",
    "diffusion recommendation",
    "generative retrieval recommendation",
]

ATOM_NS = "http://www.w3.org/2005/Atom"
OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/"
MAX_RESULTS = 50


def build_query():
    parts = []
    for term in SEARCH_TERMS:
        phrase = term.replace(" ", "+")
        parts.append(f'ti:"{phrase}"')
        parts.append(f'abs:"{phrase}"')
    query = "+OR+".join(parts)
    return (
        f"{ARXIV_API}?search_query={query}"
        f"&sortBy=submittedDate&sortOrder=descending"
        f"&start=0&max_results={MAX_RESULTS}"
    )


PROXY_URL = "https://api.allorigins.win/raw?url="


def fetch_xml(url, retries=2):
    targets = [url, PROXY_URL + urllib.parse.quote(url, safe="")]
    for target in targets:
        for attempt in range(retries):
            try:
                is_proxy = target.startswith(PROXY_URL)
                label = "proxy" if is_proxy else "direct"
                print(f"  Trying {label} (attempt {attempt + 1})...")
                req = urllib.request.Request(
                    target, headers={"User-Agent": "RecPaperHub/1.0"}
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return resp.read().decode("utf-8")
            except Exception as e:
                print(f"  {label} attempt {attempt + 1} failed: {e}")
    raise RuntimeError("All fetch attempts failed")


def parse_entry(entry):
    def text(tag):
        el = entry.find(f"{{{ATOM_NS}}}{tag}")
        return el.text.strip() if el is not None and el.text else ""

    def all_text(path):
        return [el.text.strip() for el in entry.findall(path) if el.text]

    links = entry.findall(f"{{{ATOM_NS}}}link")
    pdf_url = ""
    abs_url = ""
    for link in links:
        if link.get("title") == "pdf":
            pdf_url = link.get("href", "")
        if link.get("type") == "text/html":
            abs_url = link.get("href", "")
    if not abs_url:
        abs_url = links[0].get("href", "") if links else ""

    categories = [
        c.get("term")
        for c in entry.findall(f"{{{ATOM_NS}}}category")
        if c.get("term")
    ]

    title = " ".join(text("title").split())
    abstract = " ".join(text("summary").split())

    return {
        "id": text("id"),
        "title": title,
        "authors": all_text(f"{{{ATOM_NS}}}author/{{{ATOM_NS}}}name"),
        "abstract": abstract,
        "published": text("published"),
        "updated": text("updated"),
        "categories": categories,
        "pdfUrl": pdf_url,
        "absUrl": abs_url,
    }


def main():
    print("Fetching papers from arXiv...")
    url = build_query()
    print(f"  Query URL: {url[:120]}...")

    xml_text = fetch_xml(url)
    root = ET.fromstring(xml_text)

    total_el = root.find(f"{{{OPENSEARCH_NS}}}totalResults")
    total = int(total_el.text) if total_el is not None else 0
    print(f"  Total results: {total}")

    entries = root.findall(f"{{{ATOM_NS}}}entry")
    papers = [parse_entry(e) for e in entries]
    print(f"  Parsed {len(papers)} papers")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    output = {
        "lastUpdated": now,
        "totalResults": total,
        "papers": papers,
    }

    with open("data/papers.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  Saved to data/papers.json ({len(papers)} papers, updated {now})")


if __name__ == "__main__":
    main()
