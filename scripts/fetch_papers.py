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
ARXIV_NS = "http://arxiv.org/schemas/atom"
OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/"
MAX_RESULTS = 50

INDUSTRY_KEYWORDS = [
    # 中国互联网
    "alibaba", "taobao", "alimama", "ant group", "damo academy",
    "tencent", "wechat", "weixin",
    "bytedance", "tiktok", "douyin",
    "baidu",
    "jd.com", "jingdong", "京东",
    "meituan", "美团",
    "kuaishou", "快手",
    "huawei", "noah's ark",
    "xiaomi",
    "shopee", "sea group", "garena",
    "pinduoduo", "拼多多",
    "netease", "网易",
    "didi", "滴滴",
    "bilibili",
    # 美国互联网
    "google", "deepmind", "youtube", "alphabet",
    "meta", "facebook", "instagram",
    "amazon", "aws",
    "microsoft", "bing", "linkedin",
    "apple",
    "netflix",
    "spotify",
    "twitter", " x.com",
    "pinterest",
    "uber",
    "airbnb",
    "ebay",
    "snap", "snapchat",
    "nvidia",
    "openai",
    "salesforce",
    # 其他
    "samsung",
    "naver",
    "kakao",
    "rakuten",
    "yahoo",
]


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

    authors = []
    affiliations = []
    for author_el in entry.findall(f"{{{ATOM_NS}}}author"):
        name_el = author_el.find(f"{{{ATOM_NS}}}name")
        if name_el is not None and name_el.text:
            authors.append(name_el.text.strip())
        for aff_el in author_el.findall(f"{{{ARXIV_NS}}}affiliation"):
            if aff_el.text:
                affiliations.append(aff_el.text.strip())

    title = " ".join(text("title").split())
    abstract = " ".join(text("summary").split())
    comment_el = entry.find(f"{{{ARXIV_NS}}}comment")
    comment = comment_el.text.strip() if comment_el is not None and comment_el.text else ""

    industry_source = detect_industry(affiliations, abstract, comment)

    paper = {
        "id": text("id"),
        "title": title,
        "authors": authors,
        "affiliations": affiliations,
        "abstract": abstract,
        "published": text("published"),
        "updated": text("updated"),
        "categories": categories,
        "pdfUrl": pdf_url,
        "absUrl": abs_url,
        "industrySource": industry_source,
    }
    return paper


INDUSTRY_DISPLAY = {
    "alibaba": "Alibaba", "taobao": "Alibaba", "alimama": "Alibaba",
    "ant group": "Alibaba", "damo academy": "Alibaba",
    "tencent": "Tencent", "wechat": "Tencent", "weixin": "Tencent",
    "bytedance": "ByteDance", "tiktok": "ByteDance", "douyin": "ByteDance",
    "baidu": "Baidu",
    "jd.com": "JD.com", "jingdong": "JD.com", "京东": "JD.com",
    "meituan": "Meituan", "美团": "Meituan",
    "kuaishou": "Kuaishou", "快手": "Kuaishou",
    "huawei": "Huawei", "noah's ark": "Huawei",
    "xiaomi": "Xiaomi",
    "shopee": "Shopee", "sea group": "Shopee", "garena": "Shopee",
    "pinduoduo": "Pinduoduo", "拼多多": "Pinduoduo",
    "netease": "NetEase", "网易": "NetEase",
    "didi": "DiDi", "滴滴": "DiDi",
    "bilibili": "Bilibili",
    "google": "Google", "deepmind": "Google", "youtube": "Google",
    "alphabet": "Google",
    "meta": "Meta", "facebook": "Meta", "instagram": "Meta",
    "amazon": "Amazon", "aws": "Amazon",
    "microsoft": "Microsoft", "bing": "Microsoft", "linkedin": "Microsoft",
    "apple": "Apple",
    "netflix": "Netflix",
    "spotify": "Spotify",
    "twitter": "Twitter/X",
    "pinterest": "Pinterest",
    "uber": "Uber",
    "airbnb": "Airbnb",
    "ebay": "eBay",
    "snap": "Snap", "snapchat": "Snap",
    "nvidia": "NVIDIA",
    "openai": "OpenAI",
    "salesforce": "Salesforce",
    "samsung": "Samsung",
    "naver": "Naver",
    "kakao": "Kakao",
    "rakuten": "Rakuten",
    "yahoo": "Yahoo",
}


def detect_industry(affiliations, abstract, comment):
    """检测论文是否来自互联网公司，返回公司名或空字符串。"""
    search_text = (
        " ".join(affiliations).lower()
        + " " + comment.lower()
        + " " + abstract.lower()
    )

    for keyword in INDUSTRY_KEYWORDS:
        kw = keyword.lower().strip()
        if kw in search_text:
            return INDUSTRY_DISPLAY.get(kw, kw.title())
    return ""


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

    industry_papers = [p for p in papers if p["industrySource"]]
    academic_papers = [p for p in papers if not p["industrySource"]]
    papers = industry_papers + academic_papers

    print(f"  Parsed {len(papers)} papers ({len(industry_papers)} industry, {len(academic_papers)} academic)")

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
