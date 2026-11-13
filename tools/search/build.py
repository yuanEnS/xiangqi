#!/usr/bin/env python3
"""全站搜索的数据：把网站上阅读园、研究园的内容整理成 SQL，导入 D1 的 search_docs 表。

    python3 tools/search/build.py [网站仓库路径]

默认网站仓库在 ../yuanEnS.github.io。生成的 SQL 写到系统临时目录（二十多 MB，不进仓库），
最后会打印导入命令。网站内容更新（加了书、更新了期刊文章）以后重新跑一遍、重新导入就行，
每次导入会先清空旧数据。

收录：
  阅读园：每本书的简介，和每一章的正文（中文书用简体版）
  研究园：经典书籍的简介和在线阅读的每一章，期刊文章的标题、作者、摘要
长的章节切成几段存（D1 一条 SQL 语句不能超过 100 KB），搜索时按章合并。
"""
import html
import json
import os
import re
import sys
import tempfile

from bs4 import BeautifulSoup

PART_CHARS = 6000
STATEMENT_BYTES = 90000


def text_of(path):
    """章节页的正文和标题：去掉导航、来源说明、注释列表，图片公式不要。"""
    soup = BeautifulSoup(open(path, encoding='utf-8').read(), 'html.parser')
    title = soup.title.get_text().split(' · ')[0].strip() if soup.title else ''
    for node in soup.select('.nav, .credit, ol.references, .footnotes, style, script, img, .toc'):
        node.decompose()
    text = re.sub(r'\s+', ' ', soup.body.get_text(' ') if soup.body else '').strip()
    return title, text


def parts(text):
    for i in range(0, len(text), PART_CHARS):
        yield i // PART_CHARS, text[i:i + PART_CHARS]


def reading_docs(site):
    books = json.load(open(os.path.join(site, 'reading', 'books.json'), encoding='utf-8'))['books']
    for book in books:
        folder = os.path.join(site, 'reading', 'books', book['id'])
        if not os.path.isdir(folder):
            continue
        zh = book.get('lang') == 'zh'
        name = book['title'] if zh else f'{book["title"]}（{book["zh"]}）'
        by = f'{book["author"]} · {book.get("era") or book.get("year")}'
        url = f'/reading/books/{book["id"]}/'
        yield {'site': 'reading', 'kind': 'book', 'title': name, 'sub': by, 'url': url,
               'body': f'{name} {book["author"]} {" ".join(book["genres"])} {book["intro"]}'}
        for file in sorted(f for f in os.listdir(folder) if re.fullmatch(r'\d+\.html', f)):
            title, text = text_of(os.path.join(folder, file))
            for n, chunk in parts(text):
                yield {'site': 'reading', 'kind': 'chapter', 'title': title, 'sub': name, 'url': url + file,
                       'body': chunk, 'part': n}


def research_docs(site):
    base = os.path.join(site, 'research')
    books = json.load(open(os.path.join(base, 'books.json'), encoding='utf-8'))['books']
    for book in books:
        first = (book.get('links') or [{}])[0].get('url', '/research/?view=books')
        yield {'site': 'research', 'kind': 'book', 'title': book['title'], 'sub': f'{", ".join(book["authors"])} · {book.get("year", "")}',
               'url': first, 'body': f'{book["title"]} {" ".join(book["authors"])} {" ".join(book["topics"])} {book.get("intro", "")}'}
        reader = book.get('reader')
        if reader:
            folder = os.path.join(site, reader.strip('/'))
            for file in sorted(f for f in os.listdir(folder) if re.fullmatch(r'\d+\.html', f)):
                title, text = text_of(os.path.join(folder, file))
                for n, chunk in parts(text):
                    yield {'site': 'research', 'kind': 'chapter', 'title': title, 'sub': book['title'],
                           'url': reader + file, 'body': chunk, 'part': n}
    papers = json.load(open(os.path.join(base, 'papers.json'), encoding='utf-8'))['papers']
    for paper in papers:
        yield {'site': 'research', 'kind': 'paper', 'title': paper['title'],
               'sub': f'{paper["journal"]} · {", ".join(paper["topics"])} · {paper["week"] or ""}',
               'url': paper['link'], 'body': f'{paper["title"]} {paper["authors"]} {paper["abstract"]}'}


def sql_text(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    site = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', '..', '..', 'yuanEnS.github.io')
    docs = list(reading_docs(site)) + list(research_docs(site))
    out = os.path.join(tempfile.gettempdir(), 'gamesyuan-search.sql')
    columns = '(site, kind, title, sub, url, body, part)'
    statements, rows, size = ['DELETE FROM search_docs;'], [], 0
    for doc in docs:
        row = '(' + ', '.join(sql_text(doc.get(k, 0 if k == 'part' else '')) for k in ('site', 'kind', 'title', 'sub', 'url', 'body', 'part')) + ')'
        length = len(row.encode('utf-8'))
        if rows and size + length > STATEMENT_BYTES:
            statements.append(f'INSERT INTO search_docs {columns} VALUES\n' + ',\n'.join(rows) + ';')
            rows, size = [], 0
        rows.append(row)
        size += length
    if rows:
        statements.append(f'INSERT INTO search_docs {columns} VALUES\n' + ',\n'.join(rows) + ';')
    with open(out, 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(statements) + '\n')
    count = {}
    for doc in docs:
        count[(doc['site'], doc['kind'])] = count.get((doc['site'], doc['kind']), 0) + 1
    print(f'{len(docs)} 条，{os.path.getsize(out) // 1024} KB → {out}')
    print('  ' + '，'.join(f'{s}/{k} {n}' for (s, k), n in sorted(count.items())))
    worker = os.path.normpath(os.path.join(here, '..', '..', 'worker'))
    print('导入本地：  cd ' + worker + ' && npx wrangler d1 execute gamesyuan --local --file ' + out)
    print('导入线上：  cd ' + worker + ' && npx wrangler d1 execute gamesyuan --remote --file ' + out)


if __name__ == '__main__':
    main()
