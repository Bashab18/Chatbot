#!/usr/bin/env python3
"""Generate CIRA Chatbot Conference Presentation – 70 slides – PPTX."""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from lxml import etree
import os, copy

# ── Palette ──────────────────────────────────────────────────────
BG      = RGBColor(0x0a, 0x0e, 0x1a)
BG2     = RGBColor(0x0d, 0x14, 0x26)
CARD    = RGBColor(0x1a, 0x24, 0x36)
CARD2   = RGBColor(0x12, 0x1c, 0x2e)
BLUE    = RGBColor(0x4f, 0x9c, 0xf9)
PURPLE  = RGBColor(0xa8, 0x55, 0xf7)
CYAN    = RGBColor(0x22, 0xd3, 0xee)
GREEN   = RGBColor(0x34, 0xd3, 0x99)
YELLOW  = RGBColor(0xfb, 0xbf, 0x24)
RED     = RGBColor(0xf8, 0x71, 0x71)
WHITE   = RGBColor(0xff, 0xff, 0xff)
MUTED   = RGBColor(0x94, 0xa3, 0xb8)
LIGHT   = RGBColor(0xe2, 0xe8, 0xf0)
DIM     = RGBColor(0x33, 0x44, 0x58)

ACCENT = {'blue':BLUE,'purple':PURPLE,'cyan':CYAN,'green':GREEN,'yellow':YELLOW,'red':RED}

def _dim(c, factor=6):
    return RGBColor(min(255,c[0]//factor+12), min(255,c[1]//factor+12), min(255,c[2]//factor+12))

# ── Core helpers ─────────────────────────────────────────────────

def new_slide(prs, bg=BG):
    sl = prs.slides.add_slide(prs.slide_layouts[6])
    fill = sl.background.fill; fill.solid(); fill.fore_color.rgb = bg
    return sl

def T(sl, text, l, t, w, h, size=14, bold=False, color=LIGHT,
      align=PP_ALIGN.LEFT, italic=False):
    bx = sl.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    bx.word_wrap = True
    tf = bx.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color; r.font.name = 'Calibri'
    return bx

def Tmulti(sl, lines, l, t, w, h):
    """lines = list of dicts: text,size,bold,color,align,space_before"""
    bx = sl.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    bx.word_wrap = True; tf = bx.text_frame; tf.word_wrap = True
    first = True
    for ln in lines:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.alignment = ln.get('align', PP_ALIGN.LEFT)
        if ln.get('space_before'): p.space_before = Pt(ln['space_before'])
        txt = ln.get('text','')
        if not txt: continue
        r = p.add_run(); r.text = txt
        r.font.size = Pt(ln.get('size', 13))
        r.font.bold = ln.get('bold', False)
        r.font.color.rgb = ln.get('color', LIGHT)
        r.font.name = 'Calibri'
    return bx

def R(sl, l, t, w, h, fill=CARD, line=None, lw=0.75, radius=False):
    shape_id = 5 if radius else 1
    sh = sl.shapes.add_shape(shape_id, Inches(l), Inches(t), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line: sh.line.color.rgb = line; sh.line.width = Pt(lw)
    else: sh.line.fill.background()
    return sh

def badge(sl, text, l, t, accent=BLUE):
    w = max(1.3, len(text)*0.115+0.5)
    sh = sl.shapes.add_shape(5, Inches(l), Inches(t), Inches(w), Inches(0.27))
    sh.fill.solid(); sh.fill.fore_color.rgb = _dim(accent, 5)
    sh.line.color.rgb = accent; sh.line.width = Pt(0.75)
    tf = sh.text_frame; p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = text.upper()
    r.font.size = Pt(7.5); r.font.bold = True; r.font.color.rgb = accent
    r.font.name = 'Calibri'

def hline(sl, l, t, w, color=DIM):
    sh = sl.shapes.add_shape(1, Inches(l), Inches(t), Inches(w), Inches(0.015))
    sh.fill.solid(); sh.fill.fore_color.rgb = color; sh.line.fill.background()

def snum(sl, n, total=70):
    T(sl, f'{n:02d}  /  {total}', 12.0, 7.18, 1.2, 0.25, size=8, color=DIM, align=PP_ALIGN.RIGHT)

def slide_header(sl, badge_txt, title, accent=BLUE):
    badge(sl, badge_txt, 0.45, 0.32, accent)
    T(sl, title, 0.45, 0.65, 12.4, 0.62, size=26, bold=True, color=WHITE)
    hline(sl, 0.45, 1.33, 12.4)

def card(sl, l, t, w, h, icon, title, desc, accent=BLUE):
    R(sl, l, t, w, h, fill=_dim(accent,7), line=accent, lw=0.75, radius=True)
    T(sl, icon, l+0.12, t+0.08, 0.5, 0.45, size=18)
    T(sl, title, l+0.12, t+0.52, w-0.22, 0.3, size=11, bold=True, color=WHITE)
    T(sl, desc,  l+0.12, t+0.82, w-0.22, h-0.9, size=9.5, color=MUTED)

def arch_box(sl, l, t, w, icon, title, desc, accent=BLUE):
    R(sl, l, t, w, 0.8, fill=RGBColor(0x0e,0x16,0x26), line=DIM)
    R(sl, l, t, 0.055, 0.8, fill=accent)  # accent bar
    T(sl, f'{icon}  {title}', l+0.15, t+0.06, w-0.22, 0.28, size=11.5, bold=True, color=WHITE)
    T(sl, desc, l+0.15, t+0.36, w-0.22, 0.42, size=9.5, color=MUTED)

def stat_box(sl, l, t, w, h, num, label, color=BLUE):
    R(sl, l, t, w, h, fill=_dim(color,7), line=_dim(color,2), radius=True)
    T(sl, num,   l, t+0.08, w, 0.52, size=28, bold=True, color=color, align=PP_ALIGN.CENTER)
    T(sl, label, l, t+0.6,  w, 0.45, size=9,  color=MUTED, align=PP_ALIGN.CENTER)

def flow_node(sl, text, l, t, w=1.8, h=0.38, accent=BLUE, icon=''):
    full = (f'{icon} {text}' if icon else text).strip()
    R(sl, l, t, w, h, fill=_dim(accent,7), line=accent, radius=True)
    T(sl, full, l+0.05, t+0.04, w-0.1, h-0.08, size=9.5, color=WHITE, align=PP_ALIGN.CENTER)

def flow_arrow_h(sl, l, t):
    T(sl, '→', l, t, 0.3, 0.38, size=13, color=MUTED, align=PP_ALIGN.CENTER)

def flow_arrow_v(sl, l, t):
    T(sl, '↓', l, t, 0.38, 0.32, size=13, color=MUTED, align=PP_ALIGN.CENTER)

def code_box(sl, lines, l, t, w, h):
    R(sl, l, t, w, h, fill=RGBColor(0x0d,0x11,0x17), line=RGBColor(0x1e,0x2a,0x3a))
    T(sl, '\n'.join(lines), l+0.14, t+0.1, w-0.26, h-0.2,
      size=8.5, color=RGBColor(0xa5,0xd6,0xff))

def bullets(sl, items, l, t, w, h, accent=BLUE, size=12):
    bx = sl.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    bx.word_wrap = True; tf = bx.text_frame; tf.word_wrap = True
    first = True
    for item in items:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False; p.space_before = Pt(3)
        if isinstance(item, tuple):
            title, desc = item
            r = p.add_run(); r.text = '▶  '; r.font.size=Pt(size-1); r.font.color.rgb=accent; r.font.name='Calibri'
            r2 = p.add_run(); r2.text = title; r2.font.size=Pt(size); r2.font.bold=True; r2.font.color.rgb=WHITE; r2.font.name='Calibri'
            if desc:
                p2 = tf.add_paragraph(); p2.space_before = Pt(1)
                r3 = p2.add_run(); r3.text = '     ' + desc; r3.font.size=Pt(size-1); r3.font.color.rgb=MUTED; r3.font.name='Calibri'
        else:
            r = p.add_run(); r.text = '▶  ' + item; r.font.size=Pt(size); r.font.color.rgb=MUTED; r.font.name='Calibri'

def table(sl, headers, rows, l, t, w, h, accent=BLUE):
    ncols = len(headers); nrows = len(rows)+1
    tbl = sl.shapes.add_table(nrows, ncols, Inches(l), Inches(t), Inches(w), Inches(h)).table
    cw = w/ncols
    for i in range(ncols): tbl.columns[i].width = Inches(cw)
    for ci, ht in enumerate(headers):
        cell = tbl.cell(0,ci); cell.fill.solid(); cell.fill.fore_color.rgb = _dim(accent,3)
        p = cell.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
        r = p.add_run(); r.text = ht.upper(); r.font.size=Pt(9); r.font.bold=True; r.font.color.rgb=accent; r.font.name='Calibri'
    for ri, row in enumerate(rows):
        bg = RGBColor(0x0f,0x17,0x25) if ri%2==0 else RGBColor(0x0b,0x11,0x1d)
        for ci, ct in enumerate(row):
            cell = tbl.cell(ri+1,ci); cell.fill.solid(); cell.fill.fore_color.rgb = bg
            p = cell.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.LEFT
            r = p.add_run(); r.text = str(ct); r.font.size=Pt(10)
            r.font.bold = (ci==0); r.font.color.rgb = WHITE if ci==0 else MUTED; r.font.name='Calibri'

def section_slide(prs, n, title, subtitle, accent=PURPLE, sn=1):
    sl = new_slide(prs, RGBColor(0x07,0x0b,0x14))
    # Giant watermark number
    T(sl, str(n), 4.0, 0.5, 5.3, 6.5, size=180, bold=True, color=RGBColor(0x10,0x1c,0x2c), align=PP_ALIGN.CENTER)
    badge(sl, f'Section  {n}', 5.3, 1.55, accent)
    T(sl, title, 0.8, 2.6, 11.7, 1.9, size=52, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    T(sl, subtitle, 0.8, 4.65, 11.7, 1.1, size=15, color=MUTED, align=PP_ALIGN.CENTER)
    snum(sl, sn)
    return sl

def info_box(sl, l, t, w, h, title, body, accent=BLUE):
    R(sl, l, t, w, h, fill=_dim(accent,8), line=_dim(accent,2), radius=True)
    T(sl, title, l+0.15, t+0.1, w-0.28, 0.3, size=11.5, bold=True, color=accent)
    T(sl, body,  l+0.15, t+0.42, w-0.28, h-0.52, size=10, color=MUTED)

# ── Build Presentation ───────────────────────────────────────────
prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)

# ════════════════════════════════════════════════════════════════
# SLIDE 01 — TITLE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
# Accent overlay blocks
R(sl, 0,0,5,7.5, fill=RGBColor(0x07,0x0f,0x2a)); R(sl,5,0,8.3,7.5,fill=RGBColor(0x09,0x05,0x1e))
badge(sl,'Conference Presentation  2026',0.55,0.55,BLUE)
T(sl,'CIRA',0.55,1.0,9,1.55,size=90,bold=True,color=WHITE)
T(sl,'Intelligent Conversational AI',0.55,2.55,10,0.85,size=36,bold=True,color=BLUE)
T(sl,'A production-ready, personalized chatbot platform powered by Google Gemini,\nRAG knowledge retrieval, and deep user profiling — built for scale and real-world use.',
  0.55,3.5,8.5,1.0,size=14,color=MUTED)
tags=[('Google Gemini API',BLUE),('RAG / BM25',PURPLE),('React 18',CYAN),
      ('Node.js + Express',GREEN),('ElevenLabs TTS',YELLOW),('Google Fit',RED)]
x=0.55
for tag,col in tags:
    badge(sl,tag,x,5.1,col); x+=len(tag)*0.115+0.75
snum(sl,1)

# ════════════════════════════════════════════════════════════════
# SLIDE 02 — AGENDA
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Agenda','What We Will Cover Today',PURPLE)
items=[
    ('1','Introduction to CIRA','Overview, mission, tech stack, use cases',BLUE),
    ('2','Core Features','Chat, RAG, TTS, Admin, Multi-instance',PURPLE),
    ('3','Personalization Engine','Profiles, AI Memory, Google Fit',CYAN),
    ('4','Flow Charts','Auth, Chat, RAG, Memory, OAuth flows',GREEN),
    ('5','System Design','DB schema, APIs, JWT, WAL, deployment',YELLOW),
    ('6','Architecture & Advantages','Design patterns, trade-offs, roadmap',RED),
]
col=0
for i,item in enumerate(items):
    c=i%2; rr=i//2
    l=0.55+c*6.45; t=1.48+rr*1.6
    n,title,sub,accent=item
    R(sl,l,t,6.1,1.42,fill=_dim(accent,8),line=accent,radius=True)
    R(sl,l,t,0.52,1.42,fill=_dim(accent,4),radius=True)
    T(sl,n,l,t,0.52,1.42,size=22,bold=True,color=accent,align=PP_ALIGN.CENTER)
    T(sl,title,l+0.62,t+0.14,5.3,0.38,size=13,bold=True,color=WHITE)
    T(sl,sub,  l+0.62,t+0.54,5.3,0.65,size=10.5,color=MUTED)
T(sl,'70 slides  ·  6 sections  ·  Full Q&A at the end',0.55,6.9,12.3,0.4,size=10,color=DIM,align=PP_ALIGN.CENTER)
snum(sl,2)

# ════════════════════════════════════════════════════════════════
# SLIDE 03 — PROBLEM STATEMENT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x12,0x06,0x0a))
slide_header(sl,'Problem Statement','The Gap in AI Chatbot Solutions',RED)
cards=[
    ('🌐','Generic Responses','Most chatbots give one-size-fits-all answers with no knowledge of who the user is or their personal context.'),
    ('🧱','Siloed Knowledge','AI models cannot access private organizational documents without fine-tuning, which is costly and slow to deploy.'),
    ('🔒','Data Hallucination','Large language models frequently generate plausible-sounding but incorrect facts when operating outside their training data.'),
    ('💸','High Infrastructure Cost','Vector databases, embedding APIs, and managed AI services drive up operational costs for small teams.'),
]
for i,(icon,title,desc) in enumerate(cards):
    c=i%2; rr=i//2
    card(sl,0.55+c*6.45,1.5+rr*2.6,6.1,2.45,icon,title,desc,RED)
R(sl,0.55,6.55,12.3,0.62,fill=RGBColor(0x0f,0x17,0x28),line=BLUE,radius=True)
T(sl,'CIRA solves all four with a single, integrated, open-source architecture.',
  0.55,6.6,12.3,0.55,size=12,color=LIGHT,align=PP_ALIGN.CENTER)
snum(sl,3)

# ════════════════════════════════════════════════════════════════
# SLIDE 04 — WHAT IS CIRA?
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Introduction','What is CIRA?',BLUE)
T(sl,'Conversational Intelligent Responsive Assistant — a full-stack AI chatbot for personalized, knowledge-grounded conversations.',
  0.55,1.42,12.3,0.42,size=12.5,color=MUTED)
layers=[
    ('🤖','AI Core',     'Google Gemini (multi-version) with configurable temperature, system prompts, and web search. Model switching without code changes.',BLUE),
    ('📚','Knowledge',   'BM25 Retrieval-Augmented Generation on private documents (PDF, TXT, Markdown). Answers stay accurate and verifiable.',PURPLE),
    ('👤','Personalization','User profiles, auto-learned AI memories, and Google Fit fitness data injected into every conversation context.',GREEN),
    ('🛠','Admin Control','Real-time bot configuration, user management, KB uploads, conversation audit — no code redeploy needed.',YELLOW),
    ('🔊','Rich UX',     'ElevenLabs TTS, speech-to-text, Markdown rendering, dark/light themes, fully responsive mobile-first design.',CYAN),
    ('🏗','Multi-Instance','Run multiple isolated chatbot instances from one codebase — separate databases, ports, and configs per instance.',RED),
]
for i,(icon,title,desc,acc) in enumerate(layers):
    c=i%2; rr=i//2
    arch_box(sl, 0.55+c*6.45, 1.95+rr*1.7, 6.1, icon, title, desc, acc)
snum(sl,4)

# ════════════════════════════════════════════════════════════════
# SLIDE 05 — MISSION & VISION
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'Mission & Vision','Our Mission and Vision',CYAN)
R(sl,0.55,1.55,12.3,2.28,fill=_dim(CYAN,7),line=_dim(CYAN,3),radius=True)
T(sl,'🎯  Mission',0.55,1.65,12.3,0.4,size=16,bold=True,color=CYAN,align=PP_ALIGN.CENTER)
T(sl,'To make intelligent, personalized AI assistants accessible to any organization — without requiring vector infrastructure, GPU clusters, or ML expertise.',
  1.0,2.1,11.3,1.0,size=14,color=LIGHT,align=PP_ALIGN.CENTER)
R(sl,0.55,4.0,12.3,2.28,fill=_dim(PURPLE,7),line=_dim(PURPLE,3),radius=True)
T(sl,'🔭  Vision',0.55,4.1,12.3,0.4,size=16,bold=True,color=PURPLE,align=PP_ALIGN.CENTER)
T(sl,'A world where every business can deploy a context-aware AI assistant that truly knows its users, grounded in domain knowledge, deployable in minutes on a $7/month server.',
  1.0,4.55,11.3,1.0,size=14,color=LIGHT,align=PP_ALIGN.CENTER)
snum(sl,5)

# ════════════════════════════════════════════════════════════════
# SLIDE 06 — KEY STATS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Key Highlights','CIRA by the Numbers',BLUE)
stats=[
    ('25+','REST API Endpoints',BLUE),('6','Gemini Model Options',PURPLE),('11','ElevenLabs Voice Choices',CYAN),
    ('0','Vector DBs Required',GREEN),('7-day','JWT Token Lifetime',YELLOW),('12','Auto-Extracted Memories',RED),
    ('400w','RAG Chunk Size',BLUE),('20 MB','Max Doc Upload',PURPLE),('∞','Multi-Instance Support',CYAN),
]
for i,(num,lbl,col) in enumerate(stats):
    c=i%3; rr=i//3
    stat_box(sl,0.55+c*4.27,1.48+rr*2.1,4.0,1.88,num,lbl,col)
snum(sl,6)

# ════════════════════════════════════════════════════════════════
# SLIDE 07 — TECH STACK
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'Technology Stack','Full Technology Stack',CYAN)
# Backend table
T(sl,'BACKEND',0.55,1.48,5.8,0.3,size=9.5,bold=True,color=BLUE)
table(sl,['Component','Technology'],
    [['Runtime','Node.js 20.x'],['Framework','Express.js 4.19'],['AI Model','Google Gemini (multi-version)'],
     ['Database','SQLite 3 + better-sqlite3'],['Auth','JWT + bcryptjs'],['TTS','ElevenLabs API'],
     ['Fitness','Google Fit API (OAuth2)']],
    0.55,1.78,5.8,3.1,BLUE)
# Frontend table
T(sl,'FRONTEND',7.0,1.48,5.8,0.3,size=9.5,bold=True,color=PURPLE)
table(sl,['Component','Technology'],
    [['Framework','React 18.3.1'],['Routing','React Router v7'],['Styling','CSS Custom Properties'],
     ['Markdown','react-markdown 9.0.1'],['State','Context API'],['Build','Create React App 5.0.1'],
     ['Deploy','Render.com / Netlify']],
    7.0,1.78,5.8,3.1,PURPLE)
snum(sl,7)

# ════════════════════════════════════════════════════════════════
# SLIDE 08 — USE CASES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Use Cases','Who Uses CIRA?',PURPLE)
cases=[
    ('🏥','Healthcare Assistants','Personalized wellness guidance using user medical history, medications, allergies, and live Google Fit fitness data.'),
    ('🏢','Enterprise Support Bots','Ground AI responses in company documents (PDFs, policies) uploaded to the knowledge base — accurate, no hallucinations.'),
    ('🎓','Education Tutors','Upload course materials; the chatbot answers questions grounded in those specific documents for accurate tutoring.'),
    ('🏋️','Fitness Coaches','Combine user profile (goals, weight, age) with real-time step and heart rate data for truly personalized coaching.'),
    ('🏦','Financial Advisors','RAG on financial documents + user profile data for compliant, personalized financial Q&A.'),
    ('⚙️','Internal Knowledge Bases','Replace generic chatbots with a bot that knows your internal docs and processes with exact source references.'),
]
for i,(icon,title,desc) in enumerate(cases):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,1.48+rr*2.6,4.0,2.45,icon,title,desc,PURPLE)
snum(sl,8)

# ════════════════════════════════════════════════════════════════
# SLIDE 09 — DEPLOYMENT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Deployment','Deployment Architecture',BLUE)
arch_box(sl,0.55,1.48,5.9,'☁️','Render.com (Primary)','Node.js runtime · 1 GB persistent disk · Auto-deploy from GitHub · Health check endpoint · Environment variable management',BLUE)
arch_box(sl,0.55,2.38,5.9,'🌐','Netlify (Frontend Mirror)','Static React build · Global CDN · Instant cache invalidation · netlify.toml SPA redirect rules',PURPLE)
arch_box(sl,0.55,3.28,5.9,'💻','Local / Self-Hosted','`node start-instances.js` launches all instances simultaneously · Isolated data directories per instance',GREEN)
code_box(sl,['# Required Environment Variables','GEMINI_API_KEY=sk-...',
    'ELEVENLABS_API_KEY=sk_...','JWT_SECRET=long-random-32-char-string',
    'PORT=5000','NODE_ENV=production','INSTANCE_NAME="CIRA"',
    'GOOGLE_CLIENT_ID=...','GOOGLE_CLIENT_SECRET=...','GOOGLE_REDIRECT_URI=https://...'],
    6.7,1.48,6.1,3.45)
snum(sl,9)

# ════════════════════════════════════════════════════════════════
# SLIDE 10 — SECTION 2 DIVIDER
# ════════════════════════════════════════════════════════════════
section_slide(prs,2,'Core Features',
    'Multi-conversation chat  ·  RAG knowledge base  ·  Speech I/O  ·  Admin dashboard  ·  Multi-instance support',
    PURPLE,10)

# ════════════════════════════════════════════════════════════════
# SLIDE 11 — FEATURES OVERVIEW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Features Overview','Six Pillars of CIRA Functionality',PURPLE)
feats=[
    ('💬','Conversation Engine','Multi-session, auto-titling, persistent history, 10-message rolling context window.'),
    ('📖','RAG Knowledge Base','BM25-powered keyword retrieval from uploaded PDF, TXT, Markdown. Zero embedding API calls.'),
    ('🔊','Speech I/O','Browser-native speech-to-text input + ElevenLabs high-fidelity TTS with 11 voice choices.'),
    ('🛡️','Admin Dashboard','Real-time bot settings, user management, KB uploads, conversation audit — full control.'),
    ('👤','Personalization','User profiles + AI memory extraction + Google Fit for truly contextual responses.'),
    ('🏗️','Multi-Instance','Multiple isolated chatbot instances from one codebase with separate configs and data.'),
]
for i,(icon,title,desc) in enumerate(feats):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,1.48+rr*2.6,4.0,2.45,icon,title,desc,PURPLE)
snum(sl,11)

# ════════════════════════════════════════════════════════════════
# SLIDE 12 — CONVERSATION MANAGEMENT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'Feature','Multi-Conversation Management',CYAN)
bullets(sl,[
    ('Unlimited independent threads','Users can create and switch between as many conversations as needed.'),
    ('Auto-generated titles','First message triggers a 4–6 word Gemini-generated title for each conversation.'),
    ('Persistent storage','All messages stored in SQLite with timestamps — survives server restarts.'),
    ('Sidebar navigation','Collapsible conversation list for quick switching on desktop and mobile.'),
    ('10-message context window','Last 10 messages passed to Gemini for multi-turn coherence.'),
    ('Full admin audit','Admin can view any user\'s complete conversation history.'),
    ('Rename / delete support','Users can rename or delete any conversation at any time.'),
],0.55,1.48,6.1,5.5,CYAN)
code_box(sl,['CREATE TABLE conversations (',
    '  id         TEXT PRIMARY KEY,',
    '  user_id    TEXT NOT NULL',
    '             REFERENCES users(id)',
    '             ON DELETE CASCADE,',
    '  title      TEXT DEFAULT "New Chat",',
    '  created_at INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL',
    ');','',
    'CREATE TABLE messages (',
    '  id              TEXT PRIMARY KEY,',
    '  conversation_id TEXT NOT NULL,',
    '  role    TEXT,   -- user | assistant',
    '  text    TEXT NOT NULL,',
    '  timestamp INTEGER NOT NULL,',
    '  refs    TEXT   -- JSON KB references',
    ');'],6.85,1.48,6.0,5.5)
snum(sl,12)

# ════════════════════════════════════════════════════════════════
# SLIDE 13 — AI RESPONSE ENGINE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'AI Engine','AI Response Engine',BLUE)
arch_box(sl,0.55,1.48,5.9,'🤖','Gemini Model Flexibility','Supports gemini-3-flash-preview, Gemini 3.1 Pro/Flash Lite, 2.5 Pro/Flash, 2.0 Flash, Gemma 4. Admin switches model without redeploy.',BLUE)
arch_box(sl,0.55,2.38,5.9,'🌡️','Temperature Control','Three presets: Precise (0.2), Balanced (0.7), Creative (1.2). Controls creativity vs factual consistency of responses.',PURPLE)
arch_box(sl,0.55,3.28,5.9,'📝','System Prompt Injection','Custom behavior instructions + user profile + KB results + memory facts assembled into one dynamic systemInstruction per request.',CYAN)
arch_box(sl,0.55,4.18,5.9,'🌐','Web Search Tool','Gemini\'s built-in Google Search tool provides live web results. Configurable weight 0–100%. Disabled automatically for Gemma models.',GREEN)
T(sl,'Knowledge Source Weights  (Admin Configurable)',6.85,1.48,6.0,0.35,size=11.5,bold=True,color=BLUE)
rows_data=[('KB Documents (RAG)','80%','Strict domain knowledge'),
           ('Model\'s Own Knowledge','70%','General questions'),
           ('Live Web Search','40%','Current events, news')]
table(sl,['Source','Example Weight','Use Case'],rows_data,6.85,1.88,6.0,1.6,BLUE)
info_box(sl,6.85,3.6,6.0,0.72,'⚠  Web Search Note',
    'Web search disabled for Gemma models. JSON-mode fallback to Gemini 1.5 Flash on parse failures.',YELLOW)
info_box(sl,6.85,4.42,6.0,0.72,'✅  Key Benefit',
    'Admin changes model, temperature, and weights via UI — takes effect on the very next chat request.',GREEN)
snum(sl,13)

# ════════════════════════════════════════════════════════════════
# SLIDE 14 — RAG KNOWLEDGE BASE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'RAG System','Knowledge Base & RAG Pipeline',GREEN)
bullets(sl,[
    ('Supported formats','PDF (text extraction via pdf-parse), TXT, and Markdown files'),
    ('20 MB max per upload','Admin drag-and-drop interface on KnowledgePage'),
    ('Smart chunking','400-word segments with 60-word overlap for context continuity'),
    ('BM25 tokenization','Stored as JSON arrays — zero embedding API calls required'),
    ('Top-K retrieval','Default K=5 highest-scoring chunks per query'),
    ('Source citations','Document names shown alongside AI responses for traceability'),
    ('Text snippets','Also accepts plain-text snippets added directly via admin UI'),
    ('Configurable weight','KB influence 0–100% set in admin settings panel'),
],0.55,1.48,5.9,5.5,GREEN)
T(sl,'RAG Pipeline',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=GREEN)
for i,(txt,acc) in enumerate([
    ('Upload Document (PDF/TXT/MD)',GREEN),('Extract Text Content',CYAN),
    ('Chunk: 400 words, 60-word overlap',BLUE),('BM25 Tokenize → Store JSON tokens',PURPLE),
    ('Query → BM25 Score → Top-K chunks',YELLOW),('Inject chunks into Gemini prompt',GREEN)]):
    flow_node(sl,txt,6.85,1.88+i*0.82,6.0,0.52,acc)
    if i<5: flow_arrow_v(sl,9.55,2.4+i*0.82)
snum(sl,14)

# ════════════════════════════════════════════════════════════════
# SLIDE 15 — BM25 ALGORITHM
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'BM25 Algorithm','BM25 — Why No Vector Embeddings?',BLUE)
R(sl,0.55,1.48,5.9,1.2,fill=_dim(BLUE,8),line=_dim(BLUE,3),radius=True)
T(sl,'BM25 Score Formula',0.7,1.55,5.7,0.3,size=11,bold=True,color=BLUE)
T(sl,'score(D,Q) = Σ IDF(qi) × [ tf(qi,D) × (k1+1) ] / [ tf(qi,D) + k1 × (1-b+b×|D|/avgdl) ]',
  0.7,1.9,5.7,0.7,size=10,color=LIGHT)
T(sl,'Parameters: K1=1.5, B=0.75  ·  Stopwords: 47 common English words filtered  ·  Top-K: 5 chunks',
  0.7,2.52,5.7,0.38,size=9.5,color=MUTED)
table(sl,['Aspect','BM25 (CIRA)','Vector Embeddings'],
    [['API calls','None','Per chunk'],['Storage','~12 MB SQLite','GBs (FAISS/Pinecone)'],
     ['Latency','< 5 ms','50–200 ms'],['Monthly cost','$0','$70–250'],
     ['Explainability','High (keywords)','Low (opaque)'],['Semantic search','Keyword','Semantic']],
    0.55,3.0,5.9,3.05,BLUE)
code_box(sl,['// embed.js — BM25 constants',
    'const K1 = 1.5;',
    'const B  = 0.75;',
    '',
    'const STOPWORDS = new Set([',
    "  'the','is','at','which','on',",
    "  'a','an','and','or','but',",
    '  // ... 37 more',
    ']);',
    '',
    '// Tokenize → lowercase → filter stops',
    '// → store as JSON array in kb_chunks'],
    6.85,1.48,6.0,4.55)
info_box(sl,6.85,6.1,6.0,0.62,'✅ Practical Result',
    'For domain-specific documents, BM25 matches semantic search accuracy at zero embedding cost.',GREEN)
snum(sl,15)

# ════════════════════════════════════════════════════════════════
# SLIDE 16 — SPEECH FEATURES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Speech I/O','Speech-to-Text & Text-to-Speech',PURPLE)
T(sl,'🎤  Speech-to-Text (STT)',0.55,1.48,5.9,0.35,size=13,bold=True,color=BLUE)
bullets(sl,[
    'Uses browser-native Web Speech API — zero backend cost',
    'Continuous recognition with live interim results displayed',
    'Graceful fallback when browser does not support it',
    'Works on Chrome, Edge, Safari (WebKit)',
],0.55,1.88,5.9,1.8,BLUE)
T(sl,'🔊  Text-to-Speech (TTS) — ElevenLabs',0.55,3.75,5.9,0.35,size=13,bold=True,color=PURPLE)
bullets(sl,[
    ('11+ voice personalities','Rachel, Adam, and more studio-quality options'),
    ('4 model tiers','Turbo v2.5 (default), Turbo v2, Multilingual v2, Monolingual v1'),
    ('Stability & similarity boost','Fine-tune voice characteristics per deployment'),
    ('Markdown stripped','Clean audio — no asterisks or code fences read aloud'),
    ('MP3 output','44.1 kHz, 128 kbps audio returned by /api/tts endpoint'),
],0.55,4.15,5.9,2.7,PURPLE)
code_box(sl,['// POST /api/tts — server.js',
    "app.post('/api/tts', requireAuth, async (req,res) => {",
    '  const { text, voiceId, modelId,',
    '          stability, similarityBoost } = req.body;',
    '',
    '  // Strip markdown for clean audio',
    '  const clean = stripMarkdown(text);',
    '',
    '  const audio = await fetchElevenLabs({',
    '    text: clean, voice_id: voiceId,',
    '    model_id: modelId,',
    '    voice_settings: { stability,',
    '      similarity_boost: similarityBoost }',
    '  });',
    "  res.set('Content-Type','audio/mpeg');",
    '  res.send(audio);',
    '});'],6.85,1.48,6.0,5.5)
snum(sl,16)

# ════════════════════════════════════════════════════════════════
# SLIDE 17 — ADMIN DASHBOARD
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Admin','Admin Dashboard & Control Panel',YELLOW)
panels=[
    ('📊','Dashboard Analytics','Total users · KB documents · Avg login count · Most recent activity · Active session tracking',YELLOW),
    ('👥','User Management','View all users · Add admin notes · See login history · Grant/revoke admin role',BLUE),
    ('🗂️','Chat History Audit','Full conversation visibility for any user · Compliance and moderation support',PURPLE),
    ('⚙️','Bot Settings','Real-time model selection · System prompt · Temperature · RAG weights · TTS defaults',CYAN),
    ('📚','Knowledge Base','Drag-and-drop upload · Text snippets · View all docs · Delete documents',GREEN),
    ('🔒','Access Control','All admin routes protected with requireAdmin middleware. JWT role claim verified on every request.',RED),
]
for i,(icon,title,desc,acc) in enumerate(panels):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,1.48+rr*2.6,4.0,2.45,icon,title,desc,acc)
snum(sl,17)

# ════════════════════════════════════════════════════════════════
# SLIDE 18 — MULTI-INSTANCE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Multi-Instance','Multi-Instance Architecture',CYAN)
T(sl,'A single CIRA codebase powers multiple independent chatbot instances simultaneously, each with its own isolated environment:',
  0.55,1.48,5.9,0.65,size=12,color=MUTED)
bullets(sl,[
    ('Isolated SQLite database','Each instance has its own users, conversations, and KB'),
    ('Unique TCP port','5000, 5001, 5002 … configurable in instances.json'),
    ('Separate data directory','Independent persistent disk location per instance'),
    ('Independent bot name','Different INSTANCE_NAME and configuration per instance'),
    ('Single launcher','node start-instances.js spawns all processes at once'),
],0.55,2.28,5.9,3.8,CYAN)
info_box(sl,0.55,6.15,5.9,0.6,'Use Case','CIRA A for public users, CIRA B for internal staff — same code, different configs.',CYAN)
code_box(sl,['// instances.json','[',
    '  {',
    '    "name":    "CIRA A",',
    '    "port":    5000,',
    '    "dataDir": "data/chatbot-a"',
    '  },',
    '  {',
    '    "name":    "CIRA B",',
    '    "port":    5001,',
    '    "dataDir": "data/chatbot-b"',
    '  }',
    ']',
    '',
    '// start-instances.js',
    'for (const inst of instances) {',
    '  spawn("node", ["server.js"], {',
    '    env: { ...process.env,',
    '      PORT: inst.port,',
    '      INSTANCE_NAME: inst.name,',
    '      DATA_DIR: inst.dataDir }',
    '  });',
    '}'],6.85,1.48,6.0,5.5)
snum(sl,18)

# ════════════════════════════════════════════════════════════════
# SLIDE 19 — UI FEATURES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'UI Features','Rich UI & Experience Features',GREEN)
feats2=[
    ('📝','Markdown Rendering','Full GitHub-Flavored Markdown via react-markdown. Code blocks with syntax highlighting, tables, lists — all rendered safely without XSS risk.'),
    ('🌗','Dark / Light Themes','CSS custom properties (design tokens) enable instant theme switching. Dark mode default. Admin sets the default theme for all users.'),
    ('📱','Fully Responsive','Mobile-first CSS Grid/Flexbox. Sidebar collapses on small screens. Touch-friendly controls. Works on phones, tablets, and desktops.'),
    ('📎','Source Citations','KB document names appear as clickable references alongside AI responses for full traceability and auditability.'),
]
for i,(icon,title,desc) in enumerate(feats2):
    c=i%2; rr=i//2
    card(sl,0.55+c*6.45,1.48+rr*2.7,6.1,2.55,icon,title,desc,GREEN)
snum(sl,19)

# ════════════════════════════════════════════════════════════════
# SLIDE 20 — SECTION 3 DIVIDER
# ════════════════════════════════════════════════════════════════
section_slide(prs,3,'The Personalization Engine',
    'User profiles  ·  AI memory extraction  ·  Google Fit integration  ·  Dynamic context assembly',
    GREEN,20)

# ════════════════════════════════════════════════════════════════
# SLIDE 21 — PERSONALIZATION PHILOSOPHY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'Philosophy','Why Personalization Matters',GREEN)
pillars=[
    ('🧠','Context-Aware','The AI knows who you are — age, health conditions, goals, and history — before you type a word.',GREEN),
    ('💾','Memory Persistence','Facts learned in one conversation persist across all future sessions — the bot gets smarter over time automatically.',CYAN),
    ('📡','Live Data','Real-time fitness data from Google Fit — steps, heart rate, weight — refreshed on demand for truly current advice.',BLUE),
]
for i,(icon,title,desc,acc) in enumerate(pillars):
    card(sl,0.55+i*4.27,1.55,4.0,3.5,icon,title,desc,acc)
R(sl,0.55,5.2,12.3,0.92,fill=_dim(GREEN,8),line=_dim(GREEN,3),radius=True)
T(sl,'All personalization data is assembled into a single dynamic systemInstruction sent with every Gemini API call — seamlessly and automatically.',
  0.8,5.35,11.8,0.65,size=13,color=LIGHT,align=PP_ALIGN.CENTER)
snum(sl,21)

# ════════════════════════════════════════════════════════════════
# SLIDE 22 — USER PROFILE SYSTEM
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'User Profile','User Profile System',GREEN)
table(sl,['Field','Data Type','Example Value'],
    [['Age','Number','32'],['Gender','String','"Female"'],['Height','Number (cm)','168'],
     ['Weight','Number (kg)','65.0'],['Medical Conditions','Free text','"Type 2 diabetes"'],
     ['Medications','Free text','"Metformin 500 mg"'],['Allergies','Free text','"Peanuts, sulfa drugs"'],
     ['Health Goals','Free text','"Lose 5 kg by June"'],['Custom Notes','Free text','"Prefers metric units"']],
    0.55,1.48,6.3,4.9,GREEN)
T(sl,'Profile Impact on Responses',7.0,1.48,6.3,0.35,size=11.5,bold=True,color=BLUE)
code_box(sl,['// Profile injected into systemInstruction',
    'function buildSystemPrompt(settings, user) {',
    '  let prompt = settings.systemPrompt;',
    '',
    '  if (user.profile?.age) {',
    '    prompt += `\\nUser Profile:',
    '  Age:        ${user.profile.age}',
    '  Gender:     ${user.profile.gender}',
    '  Conditions: ${user.profile.conditions}',
    '  Medications:${user.profile.medications}',
    '  Allergies:  ${user.profile.allergies}',
    '  Goals:      ${user.profile.goals}`;',
    '  }',
    '  return prompt;',
    '}'],7.0,1.88,6.3,4.5)
snum(sl,22)

# ════════════════════════════════════════════════════════════════
# SLIDE 23 — AI MEMORY SYSTEM
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'AI Memory','AI Memory Extraction System',PURPLE)
T(sl,'CIRA automatically learns facts about users by analyzing recent conversation history using Gemini:',
  0.55,1.48,5.9,0.55,size=12,color=MUTED)
steps=[
    ('1','Trigger Analysis','User triggers extraction. System fetches last 150 messages across all conversations.'),
    ('2','Gemini Analysis','Gemini analyzes messages with a structured JSON prompt: extract exactly 12 new facts not already stored.'),
    ('3','Deduplication','40-character prefix matching filters out already-known facts. Markdown JSON blocks stripped for robust parsing.'),
    ('4','Storage & Injection','New facts saved to users.memories JSON column. Appended to systemInstruction on next chat request.'),
]
for i,(n,title,desc) in enumerate(steps):
    R(sl,0.55,2.12+i*1.28,0.55,0.55,fill=_dim(PURPLE,4),line=PURPLE,radius=True)
    T(sl,n,0.55,2.12+i*1.28,0.55,0.55,size=14,bold=True,color=PURPLE,align=PP_ALIGN.CENTER)
    T(sl,title,1.2,2.14+i*1.28,4.95,0.3,size=11.5,bold=True,color=WHITE)
    T(sl,desc, 1.2,2.46+i*1.28,4.95,0.8,size=10,color=MUTED)
code_box(sl,['// Extracted memory structure','{',
    '  "id":        "mem_abc123",',
    '  "text":      "User prefers morning workouts",',
    '  "source":    "auto",',
    '  "createdAt": 1716890400000',
    '}',
    '',
    '// Injected in system prompt',
    '"What I know about you:',
    ' - User prefers morning workouts',
    ' - Has lactose intolerance',
    ' - Training for a 5K run in July',
    ' - Takes vitamin D supplements',
    ' - Lives in a cold climate"'],6.85,1.48,6.0,4.55)
info_box(sl,6.85,6.1,6.0,0.65,'Memory Management',
    'View · manually delete · or add custom memories via Profile Page. Re-run extraction at any time.',PURPLE)
snum(sl,23)

# ════════════════════════════════════════════════════════════════
# SLIDE 24 — GOOGLE FIT INTEGRATION
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'Google Fit','Google Fit Integration',GREEN)
items_fit=[
    ('🔐','OAuth2 Authorization','User clicks "Connect Google Fit" → Google consent screen → tokens stored securely server-side per user.',GREEN),
    ('📊','Data Retrieved (7 Days)','Daily step counts · Average heart rate (BPM) · Weight measurements — all aggregated over a rolling 7-day window.',CYAN),
    ('🧠','Context Injection','Fitness snapshot appended to Gemini systemInstruction: "7,432 steps/day, 72 BPM avg heart rate, 68.5 kg".',BLUE),
    ('🔄','Refresh on Demand','User manually refreshes fitness data at any time. Cached in user profile with last-updated timestamp.',YELLOW),
]
for i,(icon,title,desc,acc) in enumerate(items_fit):
    arch_box(sl,0.55,1.48+i*1.32,5.9,icon,title,desc,acc)
code_box(sl,['// Read-only OAuth2 scopes',
    'const SCOPES = [',
    "  'https://www.googleapis.com/auth/",
    "    fitness.activity.read',",
    "  'https://www.googleapis.com/auth/",
    "    fitness.body.read',",
    "  'https://www.googleapis.com/auth/",
    "    fitness.heart_rate.read'",
    '];',
    '',
    '// Fitness context in system prompt',
    '"Recent Fitness Data (last 7 days):',
    ' • Avg daily steps: 7,432',
    ' • Avg heart rate:  72 BPM',
    ' • Latest weight:   68.5 kg',
    'Use this to give relevant advice."'],6.85,1.48,6.0,5.5)
snum(sl,24)

# ════════════════════════════════════════════════════════════════
# SLIDE 25 — DYNAMIC SYSTEM PROMPT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Context Assembly','Dynamic System Prompt Construction',PURPLE)
T(sl,'Every Gemini API call assembles a rich systemInstruction from 6 data sources in real-time (< 20 ms total):',
  0.55,1.48,12.3,0.45,size=12,color=MUTED)
sources=[
    ('⚙️','1. Admin System Prompt','The base behavior instructions: bot persona, tone, topic scope.',BLUE),
    ('👤','2. User Profile','Age, gender, health conditions, medications, allergies, goals.',PURPLE),
    ('💾','3. AI Memories','Previously extracted facts about the user as bullet points.',GREEN),
    ('🏃','4. Fitness Snapshot','7-day Google Fit data: steps, heart rate, weight (if connected).',YELLOW),
    ('📚','5. KB Chunks (RAG)','Top-K BM25-retrieved document chunks grounding factual responses.',CYAN),
    ('🕐','6. Chat History','Last 10 messages as conversation turns for multi-turn coherence.',RED),
]
for i,(icon,num,desc,acc) in enumerate(sources):
    c=i%3; rr=i//3
    R(sl,0.55+c*4.27,2.02+rr*2.35,4.0,2.2,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,icon+' '+num,0.7+c*4.27,2.12+rr*2.35,3.7,0.32,size=11.5,bold=True,color=acc)
    T(sl,desc,0.7+c*4.27,2.48+rr*2.35,3.7,1.55,size=10,color=MUTED)
snum(sl,25)

# ════════════════════════════════════════════════════════════════
# SLIDE 26 — PERSONALIZATION IMPACT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Impact','Personalization in Action — Before vs. After',GREEN)
R(sl,0.55,1.5,5.9,4.6,fill=_dim(RED,9),line=RED,radius=True)
T(sl,'❌  Generic Chatbot Response',0.7,1.6,5.7,0.35,size=11.5,bold=True,color=RED)
T(sl,'Q: What should I eat before a workout?',0.7,2.0,5.7,0.32,size=11,bold=True,color=LIGHT)
T(sl,'"Before a workout, it is generally recommended to eat a balanced meal containing carbohydrates, protein, and healthy fats 2–3 hours before exercising. Examples include oatmeal with fruit, a chicken sandwich, or a banana with peanut butter."',
  0.7,2.38,5.7,2.5,size=10.5,color=MUTED)
R(sl,6.85,1.5,6.0,4.6,fill=_dim(GREEN,9),line=GREEN,radius=True)
T(sl,'✅  CIRA Personalized Response',7.0,1.6,5.7,0.35,size=11.5,bold=True,color=GREEN)
T(sl,'Q: What should I eat before a workout?',7.0,2.0,5.7,0.32,size=11,bold=True,color=LIGHT)
T(sl,'"Given your Type 2 diabetes and Metformin prescription, avoid simple carbs that spike blood sugar. Greek yogurt with berries works well. Based on your 7,432 daily steps and goal to lose 5 kg, keep pre-workout calories under 250. Since you prefer morning workouts, eat 30–45 min before you start."',
  7.0,2.38,5.7,2.5,size=10.5,color=MUTED)
R(sl,0.55,6.25,12.3,0.62,fill=_dim(BLUE,8),line=BLUE,radius=True)
T(sl,'Difference: profile + AI memories + fitness snapshot = genuinely useful, personalized advice',
  0.7,6.35,12.0,0.45,size=12,color=LIGHT,align=PP_ALIGN.CENTER)
snum(sl,26)

# ════════════════════════════════════════════════════════════════
# SLIDE 27 — SECTION 4 DIVIDER
# ════════════════════════════════════════════════════════════════
section_slide(prs,4,'Flow Charts',
    'Authentication  ·  Chat processing  ·  RAG pipeline  ·  Memory extraction  ·  OAuth  ·  Error handling',
    YELLOW,27)

# ════════════════════════════════════════════════════════════════
# SLIDE 28 — AUTH FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Auth Flow','User Registration & Login Flow',YELLOW)
T(sl,'Registration Flow',0.55,1.48,6.1,0.32,size=11.5,bold=True,color=BLUE)
reg=[('User enters email + password + name',BLUE),('Validate: email unique, password ≥6 chars',YELLOW),
     ('bcryptjs hash password (10 salt rounds)',PURPLE),('INSERT user row with UUID → SQLite',BLUE),
     ('Sign JWT (7-day expiry) → Return token',GREEN),('Store token in localStorage → Route to /chat',CYAN)]
for i,(txt,acc) in enumerate(reg):
    flow_node(sl,txt,0.55,1.85+i*0.82,5.9,0.52,acc)
    if i<5: flow_arrow_v(sl,3.25,2.37+i*0.82)
T(sl,'Every Protected API Request',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=PURPLE)
prot=[('Client sends Bearer token in Authorization header',BLUE),
      ('requireAuth: jwt.verify(token, JWT_SECRET)',YELLOW),
      ('✅ Valid → attach user to req, continue','→  ❌ Invalid → 401 Unauthorized',GREEN),
      ('Admin routes: also check role === "admin"',PURPLE)]
for i,(txt,acc) in enumerate([('Client sends Bearer token in Authorization header',BLUE),
      ('requireAuth: jwt.verify(token, JWT_SECRET)',YELLOW),
      ('Admin routes: also check role === "admin"',PURPLE)]):
    flow_node(sl,txt,6.85,1.85+i*0.9,6.0,0.52,acc)
    if i<2: flow_arrow_v(sl,9.65,2.37+i*0.9)
R(sl,6.85,4.7,2.85,0.52,fill=_dim(GREEN,8),line=GREEN,radius=True)
T(sl,'✅ Valid → continue',6.9,4.76,2.75,0.4,size=9.5,color=WHITE,align=PP_ALIGN.CENTER)
R(sl,9.85,4.7,3.0,0.52,fill=_dim(RED,8),line=RED,radius=True)
T(sl,'❌ Invalid → 401',9.9,4.76,2.9,0.4,size=9.5,color=WHITE,align=PP_ALIGN.CENTER)
snum(sl,28)

# ════════════════════════════════════════════════════════════════
# SLIDE 29 — CHAT MESSAGE FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Chat Flow','Chat Message Processing Flow — 12 Steps',CYAN)
steps29=[
    ('User sends POST /api/chat',BLUE),('Authenticate JWT token',YELLOW),
    ('Fetch user profile + memories',PURPLE),('Fetch fitness snapshot (if linked)',GREEN),
    ('BM25 search KB → Top-K chunks',CYAN),('Load last 10 messages (history)',BLUE),
    ('Load admin settings (model, temp)',YELLOW),('Assemble systemInstruction',PURPLE),
    ('Call Gemini API',GREEN),('Receive AI response text',CYAN),
    ('Save both messages to SQLite',BLUE),('Return response + KB refs to client',GREEN),
]
for i,(txt,acc) in enumerate(steps29):
    c=i%4; rr=i//4
    flow_node(sl,txt,0.45+c*3.22,1.52+rr*2.0,3.0,0.52,acc)
    if c<3: flow_arrow_h(sl,3.48+c*3.22,1.58+rr*2.0)
R(sl,0.55,6.2,12.3,0.58,fill=_dim(BLUE,9),line=_dim(BLUE,3),radius=True)
T(sl,'Steps 2–8 complete in < 20 ms (SQLite reads). The Gemini API call (step 9) is the only external I/O with network latency.',
  0.7,6.3,12.0,0.42,size=10.5,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,29)

# ════════════════════════════════════════════════════════════════
# SLIDE 30 — RAG PIPELINE FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'RAG Pipeline','RAG Pipeline — Detailed Flow',GREEN)
T(sl,'Ingestion Phase (Document Upload)',0.55,1.48,5.9,0.32,size=11.5,bold=True,color=GREEN)
ing=[('Admin uploads PDF/TXT/MD file',GREEN),('Multer validates type & size ≤ 20 MB',YELLOW),
     ('Text extraction (pdf-parse / buffer)',CYAN),('Chunker: 400w segments, 60w overlap',BLUE),
     ('BM25 tokenize each chunk',PURPLE),('Store JSON tokens in kb_chunks table',GREEN)]
for i,(txt,acc) in enumerate(ing):
    flow_node(sl,txt,0.55,1.88+i*0.82,5.9,0.52,acc)
    if i<5: flow_arrow_v(sl,3.3,2.4+i*0.82)
T(sl,'Retrieval Phase (Chat Query)',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=CYAN)
ret=[('Tokenize user query (same BM25)',CYAN),('Score all KB chunks with BM25 formula',BLUE),
     ('Sort by relevance score descending',YELLOW),('Return Top-5 chunks + source doc names',GREEN),
     ('Inject into Gemini systemInstruction',PURPLE),('AI response cites source documents',CYAN)]
for i,(txt,acc) in enumerate(ret):
    flow_node(sl,txt,6.85,1.88+i*0.82,6.0,0.52,acc)
    if i<5: flow_arrow_v(sl,9.65,2.4+i*0.82)
snum(sl,30)

# ════════════════════════════════════════════════════════════════
# SLIDE 31 — MEMORY EXTRACTION FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Memory Flow','AI Memory Extraction Flow',PURPLE)
flow_steps31=[
    ('User triggers POST /api/user/memories/extract',BLUE),
    ('Authenticate JWT, verify user identity',YELLOW),
    ('Fetch last 150 messages from all conversations',PURPLE),
    ('Build extraction prompt: "Extract 12 new user facts"',CYAN),
    ('Call Gemini API in JSON mode (structured output)',GREEN),
    ('Parse JSON (strip markdown fences if present)',BLUE),
    ('Dedup: 40-char prefix match vs. existing memories',YELLOW),
    ('Append new facts to users.memories JSON column',PURPLE),
    ('Return updated memory list to client',GREEN),
]
for i,(txt,acc) in enumerate(flow_steps31):
    c=i%3; rr=i//3
    flow_node(sl,txt,0.45+c*4.3,1.55+rr*1.52,4.0,0.72,acc)
    if c<2: flow_arrow_h(sl,4.48+c*4.3,1.75+rr*1.52)
info_box(sl,0.55,6.15,12.3,0.62,'Fallback Strategy',
    'If Gemini returns JSON wrapped in markdown code fences, they are stripped before JSON.parse(). On parse failure, falls back to Gemini 1.5 Flash in forced JSON mode for guaranteed structured output.',YELLOW)
snum(sl,31)

# ════════════════════════════════════════════════════════════════
# SLIDE 32 — GOOGLE FIT OAUTH FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'OAuth Flow','Google Fit OAuth2 Flow',GREEN)
oauth=[
    ('User: GET /api/fitness/auth-url',BLUE),('Server builds OAuth2 URL + state param',CYAN),
    ('User redirected to Google consent screen',GREEN),('User grants read-only permission',YELLOW),
    ('Google redirects to /api/fitness/callback?code=...',BLUE),('Exchange code → access_token + refresh_token',PURPLE),
    ('Tokens stored in user.profile (SQLite)',GREEN),('POST /api/fitness/refresh → fetch 7-day data',CYAN),
    ('Steps + HR + Weight cached in user profile',YELLOW),('Fitness snapshot injected into systemInstruction',GREEN),
]
for i,(txt,acc) in enumerate(oauth):
    c=i%2; rr=i//2
    flow_node(sl,txt,0.55+c*6.45,1.52+rr*1.0,6.1,0.65,acc)
    if c==0: flow_arrow_h(sl,6.68,1.67+rr*1.0)
info_box(sl,0.55,6.62,12.3,0.65,'Security Note',
    'Only read-only scopes requested. OAuth tokens stored server-side only. Revoke anytime via DELETE /api/fitness/disconnect.',GREEN)
snum(sl,32)

# ════════════════════════════════════════════════════════════════
# SLIDE 33 — DOCUMENT UPLOAD FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Document Upload','Document Upload & Processing Flow',BLUE)
doc_flow=[
    ('Admin: POST /api/documents (multipart)',BLUE),('Multer: validate file type & size ≤ 20 MB',YELLOW),
    ('PDF → pdf-parse   |   TXT/MD → buffer.toString()',CYAN),('chunker.js: 400-word / 60-word-overlap segments',PURPLE),
    ('embed.js: BM25 tokenize each chunk → JSON array',GREEN),('INSERT doc metadata → kb_documents table',BLUE),
    ('INSERT all chunks → kb_chunks table (batch)',CYAN),('Return { docId, chunkCount, name } to admin UI',GREEN),
]
for i,(txt,acc) in enumerate(doc_flow):
    flow_node(sl,txt,0.55,1.52+i*0.68,6.1,0.48,acc)
    if i<7: flow_arrow_v(sl,3.3,2.0+i*0.68)
code_box(sl,['CREATE TABLE kb_documents (',
    '  id          TEXT PRIMARY KEY,',
    '  name        TEXT NOT NULL,',
    '  chunk_count INTEGER NOT NULL,',
    '  added_at    INTEGER NOT NULL',
    ');','',
    'CREATE TABLE kb_chunks (',
    '  rowid    INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  doc_id   TEXT NOT NULL',
    '           REFERENCES kb_documents(id)',
    '           ON DELETE CASCADE,',
    '  doc_name TEXT NOT NULL,',
    '  text     TEXT NOT NULL,',
    '  embedding TEXT NOT NULL',
    '  -- JSON: ["token1","token2",...]',
    ');'],6.85,1.52,6.0,5.5)
snum(sl,33)

# ════════════════════════════════════════════════════════════════
# SLIDE 34 — ERROR HANDLING
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x12,0x06,0x0a))
slide_header(sl,'Error Handling','Error Handling & Fallback Flows',RED)
errs=[
    ('🔄','JSON Parse Fallback','Gemini returns JSON wrapped in markdown fences → strip before parse. On continued failure, switch to Gemini 1.5 Flash in forced JSON mode.',RED),
    ('📭','Empty KB Results','KB-only mode + BM25 finds no relevant chunks → graceful "I don\'t have information on that in my knowledge base" message.',YELLOW),
    ('🌐','Gemma Web Search','Gemma models do not support Google Search tool. webSearchWeight > 0 with Gemma → web search silently skipped. Admin warned in settings UI.',BLUE),
    ('🔊','TTS / STT Degradation','ElevenLabs API fails → UI shows error, text response still displayed. Browser lacks Web Speech → microphone button hidden gracefully.',PURPLE),
]
for i,(icon,title,desc,acc) in enumerate(errs):
    c=i%2; rr=i//2
    card(sl,0.55+c*6.45,1.5+rr*2.6,6.1,2.45,icon,title,desc,acc)
R(sl,0.55,6.62,12.3,0.65,fill=_dim(RED,9),line=RED,radius=True)
T(sl,'All API endpoints return {"error":"message"} with correct HTTP codes (400/401/403/500). No stack traces exposed.',
  0.7,6.72,12.0,0.48,size=11,color=LIGHT,align=PP_ALIGN.CENTER)
snum(sl,34)

# ════════════════════════════════════════════════════════════════
# SLIDE 35 — COMPLETE SYSTEM FLOW
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Full System','Complete System Interaction Overview',YELLOW)
layers_sys=[
    ('👤','User Layer','React 18 SPA\nChatPage (Markdown)\nProfilePage\nAdminLayout\nWeb Speech API\nDark/Light Theme',BLUE),
    ('⚙️','API Layer','Express.js REST\nJWT Auth Middleware\n25+ Route Handlers\nSQLite WAL\nBM25 RAG Engine\nMulti-Instance Spawn',PURPLE),
    ('🤖','AI & External','Google Gemini API\n(6 model variants)\nElevenLabs TTS\n(11 voices)\nGoogle Fit API\n(OAuth2 read-only)',GREEN),
]
for i,(icon,title,desc,acc) in enumerate(layers_sys):
    R(sl,0.55+i*4.27,1.5,4.0,3.6,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,icon+' '+title,0.7+i*4.27,1.62,3.7,0.38,size=13,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,desc,0.7+i*4.27,2.08,3.7,2.8,size=11,color=MUTED,align=PP_ALIGN.CENTER)
    if i<2: T(sl,'⟷',4.47+i*4.27,3.1,0.42,0.4,size=18,color=DIM,align=PP_ALIGN.CENTER)
sub=[('💾 Storage','SQLite 3\nWAL Mode\n~12 MB typical',YELLOW),
     ('🔐 Auth','JWT Tokens\nbcryptjs\n7-day expiry',CYAN),
     ('☁️ Infra','Render.com\nNetlify CDN\n1 GB Disk',RED),
     ('📈 Scale','Multi-instance\nIsolated DBs\nPer-port spawn',PURPLE)]
for i,(title,desc,acc) in enumerate(sub):
    R(sl,0.55+i*3.22,5.28,3.0,1.5,fill=_dim(acc,9),line=_dim(acc,3),radius=True)
    T(sl,title,0.6+i*3.22,5.36,2.9,0.32,size=10.5,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,desc, 0.6+i*3.22,5.72,2.9,0.88,size=9.5,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,35)

# ════════════════════════════════════════════════════════════════
# SLIDE 36 — SECTION 5 DIVIDER
# ════════════════════════════════════════════════════════════════
section_slide(prs,5,'System Design',
    'Database schema  ·  REST API  ·  JWT lifecycle  ·  SQLite WAL  ·  Deployment architecture',
    CYAN,36)

# ════════════════════════════════════════════════════════════════
# SLIDE 37 — DB SCHEMA PART 1
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'DB Schema','Database Schema — Core Tables',CYAN)
code_box(sl,['CREATE TABLE users (',
    '  id            TEXT PRIMARY KEY,   -- UUID',
    '  email         TEXT UNIQUE NOT NULL,',
    '  name          TEXT NOT NULL,',
    "  role          TEXT DEFAULT 'user',",
    '  password_hash TEXT NOT NULL,',
    '  login_count   INTEGER DEFAULT 0,',
    '  last_login    INTEGER,',
    "  note          TEXT DEFAULT '',",
    "  profile       TEXT DEFAULT '{}',   -- JSON",
    "  memories      TEXT DEFAULT '[]',   -- JSON",
    '  created_at    INTEGER NOT NULL',
    ');'],0.55,1.48,6.3,4.5)
code_box(sl,['CREATE TABLE conversations (',
    '  id         TEXT PRIMARY KEY,',
    '  user_id    TEXT NOT NULL',
    '             REFERENCES users(id)',
    '             ON DELETE CASCADE,',
    "  title      TEXT DEFAULT 'New Chat',",
    '  created_at INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL',
    ');','',
    'CREATE TABLE messages (',
    '  id              TEXT PRIMARY KEY,',
    '  conversation_id TEXT NOT NULL',
    '    REFERENCES conversations(id)',
    '    ON DELETE CASCADE,',
    '  role      TEXT NOT NULL,   -- user|assistant',
    '  text      TEXT NOT NULL,',
    '  timestamp INTEGER NOT NULL,',
    '  refs      TEXT   -- JSON KB source refs',
    ');'],7.0,1.48,6.0,4.5)
T(sl,'All timestamps: Unix milliseconds (INTEGER).  UUIDs: crypto.randomUUID().  CASCADE deletes maintain referential integrity.',
  0.55,6.1,12.3,0.62,size=10,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,37)

# ════════════════════════════════════════════════════════════════
# SLIDE 38 — DB SCHEMA PART 2
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'DB Schema','Database Schema — Knowledge Base & Settings',GREEN)
code_box(sl,['CREATE TABLE kb_documents (',
    '  id          TEXT PRIMARY KEY,',
    '  name        TEXT NOT NULL,',
    '  chunk_count INTEGER NOT NULL,',
    '  added_at    INTEGER NOT NULL',
    ');','',
    'CREATE TABLE kb_chunks (',
    '  rowid     INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  doc_id    TEXT NOT NULL',
    '            REFERENCES kb_documents(id)',
    '            ON DELETE CASCADE,',
    '  doc_name  TEXT NOT NULL,',
    '  text      TEXT NOT NULL,',
    '  embedding TEXT NOT NULL',
    '  -- JSON array of BM25 tokens',
    '  -- ["diabetes","management","diet"]',
    ');'],0.55,1.48,6.3,4.5)
code_box(sl,['CREATE TABLE settings (',
    '  key   TEXT PRIMARY KEY,',
    '  value TEXT NOT NULL   -- JSON',
    ');','',
    '-- Example settings value:',
    '{',
    '  "model":               "gemini-3-flash-preview",',
    '  "systemPrompt":        "You are CIRA...",',
    '  "style":               "balanced",',
    '  "ragTopK":             5,',
    '  "ragWeight":           80,',
    '  "ownKnowledgeWeight":  60,',
    '  "webSearchWeight":     40,',
    '  "defaultTheme":        "dark",',
    '  "ttsEnabled":          true,',
    '  "defaultVoiceId":      "21m00Tc..."',
    '}'],7.0,1.48,6.0,4.5)
info_box(sl,0.55,6.1,12.3,0.65,'Live Settings',
    'Admin changes take effect on the very next chat request — no server restart or redeploy required.',GREEN)
snum(sl,38)

# ════════════════════════════════════════════════════════════════
# SLIDE 39 — REST API ARCHITECTURE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'REST API','REST API Architecture — 25+ Endpoints',BLUE)
table(sl,['Endpoint','Method','Auth Level'],
    [['/api/auth/signup','POST','Public'],
     ['/api/auth/login','POST','Public'],
     ['/api/auth/me','GET','User JWT'],
     ['/api/conversations','GET / POST','User JWT'],
     ['/api/conversations/:id','PATCH / DELETE','User JWT'],
     ['/api/conversations/:id/messages','GET','User JWT'],
     ['/api/chat','POST','User JWT'],
     ['/api/title','POST','User JWT']],
    0.55,1.48,5.9,4.25,BLUE)
table(sl,['Endpoint','Method','Auth Level'],
    [['/api/user/profile','GET / PUT','User JWT'],
     ['/api/user/memories','GET / DELETE','User JWT'],
     ['/api/user/memories/extract','POST','User JWT'],
     ['/api/fitness/auth-url','GET','User JWT'],
     ['/api/fitness/refresh','POST','User JWT'],
     ['/api/tts','POST','User JWT'],
     ['/api/admin/*','Various','Admin JWT'],
     ['/api/documents','GET/POST/DELETE','Admin JWT']],
    6.85,1.48,6.0,4.25,PURPLE)
info_box(sl,0.55,5.85,12.3,0.85,'API Design Principles',
    'Resource-oriented URLs  ·  HTTP verbs for actions  ·  Consistent {error:"msg"} response shape  ·  Stateless (JWT)  ·  JSON + MP3 content types',BLUE)
snum(sl,39)

# ════════════════════════════════════════════════════════════════
# SLIDE 40 — JWT DESIGN
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'JWT Design','JWT Authentication Design',YELLOW)
code_box(sl,['// JWT Header (base64url)',
    '{ "alg": "HS256", "typ": "JWT" }','',
    '// JWT Payload (base64url)',
    '{',
    '  "uid":   "user-uuid-here",',
    '  "email": "user@example.com",',
    '  "name":  "John Doe",',
    '  "role":  "user",',
    '  "iat":   1716890400,',
    '  "exp":   1717495200   // +7 days',
    '}','',
    '// Signature',
    'HMAC-SHA256(',
    '  base64(header) + "." + base64(payload),',
    '  JWT_SECRET',
    ')'],0.55,1.48,6.1,5.5)
arch_box(sl,6.85,1.48,6.0,'🔐','Stateless Authentication','No session store needed. Server only needs JWT_SECRET to verify. Scales horizontally without shared state.',YELLOW)
arch_box(sl,6.85,2.38,6.0,'👑','Role-Based Access Control','role claim in payload gates admin routes. requireAdmin checks role==="admin" after requireAuth verification.',PURPLE)
arch_box(sl,6.85,3.28,6.0,'💾','Client-Side Storage','Token stored in localStorage as "chatbot_token". AuthContext reads on app load. 7-day expiry for session continuity.',BLUE)
arch_box(sl,6.85,4.18,6.0,'⏱️','Token Lifecycle','Issued on login/signup → stored in browser → sent on every request as Bearer token → expires in 7 days → user must re-login.',CYAN)
snum(sl,40)

# ════════════════════════════════════════════════════════════════
# SLIDE 41 — SQLITE WAL
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'SQLite WAL','SQLite WAL Mode — Why and How',CYAN)
bullets(sl,[
    ('Readers do not block writers','WAL mode allows simultaneous reads and writes without locking'),
    ('Concurrent HTTP requests','Multiple users chatting simultaneously share the DB file safely'),
    ('Faster write throughput','Chat message inserts complete with minimal I/O overhead'),
    ('Crash recovery','Uncommitted WAL writes rolled back automatically on restart'),
    ('Zero operational overhead','No external DB server — embedded in the process, runs anywhere'),
],0.55,1.48,5.9,3.7,CYAN)
code_box(sl,['// db.js initialization','',
    "const db = new Database(dbPath);",
    "db.pragma('journal_mode = WAL');",
    "db.pragma('foreign_keys = ON');",
    '',
    '// WAL files created:',
    '//   chatbot.db',
    '//   chatbot.db-wal   (write-ahead log)',
    '//   chatbot.db-shm   (shared memory index)'],
    0.55,5.28,5.9,2.0)
table(sl,['','SQLite WAL','PostgreSQL'],
    [['Setup','Zero config','Server needed'],
     ['Concurrent R/W','✓ (WAL mode)','✓ (MVCC)'],
     ['File size','~12 MB','Larger overhead'],
     ['Monthly cost','$0','$$$'],
     ['Multi-host scale','Single node','Multi-host'],
     ['Fit for CIRA?','✅ Perfect','Overkill']],
    6.85,1.48,6.0,4.55,CYAN)
snum(sl,41)

# ════════════════════════════════════════════════════════════════
# SLIDE 42 — FRONTEND ARCHITECTURE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Frontend Design','Frontend Application Architecture',BLUE)
T(sl,'Page Structure',0.55,1.48,5.9,0.32,size=11.5,bold=True,color=BLUE)
arch_box(sl,0.55,1.85,5.9,'🔑','/ — LoginPage.jsx','JWT-authenticated entry. Redirects to /chat if logged in. Sign-up and login forms with validation.',BLUE)
arch_box(sl,0.55,2.75,5.9,'💬','/chat — ChatPage.jsx','Main interface: sidebar with conversations, message thread, input bar with STT button. Markdown rendering via react-markdown.',PURPLE)
arch_box(sl,0.55,3.65,5.9,'👤','/profile — ProfilePage.jsx','Health profile form, AI memory manager, Google Fit connect button, 7-day fitness snapshot display.',GREEN)
arch_box(sl,0.55,4.55,5.9,'🛡️','/admin/* — AdminLayout.jsx','Dashboard, Users, Chat History, KB Manager, Settings — tabbed admin interface with admin-only access guard.',YELLOW)
T(sl,'State Management — Context API',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=PURPLE)
code_box(sl,['// AuthContext.jsx — single global context',
    'const AuthContext = createContext();','',
    'export function AuthProvider({ children }) {',
    '  const [user, setUser] = useState(null);',
    '  const [token, setToken] = useState(',
    "    localStorage.getItem('chatbot_token')",
    '  );',
    '',
    '  // Auto-verify JWT on mount',
    '  useEffect(() => {',
    '    if (token) verifyToken(token',
    '      ).then(setUser);',
    '  }, []);',
    '',
    '  return (',
    '    <AuthContext.Provider',
    '      value={{ user, token, login, logout }}',
    '    >',
    '      {children}',
    '    </AuthContext.Provider>',
    '  );',
    '}'],6.85,1.88,6.0,5.1)
snum(sl,42)

# ════════════════════════════════════════════════════════════════
# SLIDE 43 — BACKEND ARCHITECTURE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Backend Design','Backend Architecture',PURPLE)
T(sl,'Module Layout',0.55,1.48,5.9,0.32,size=11.5,bold=True,color=PURPLE)
table(sl,['File','Responsibility'],
    [['server.js','All Express routes & API logic (966 lines)'],
     ['db.js','SQLite connection, schema creation, WAL setup'],
     ['auth.js','requireAuth + requireAdmin middleware'],
     ['rag/embed.js','BM25 tokenizer (stopwords, TF-IDF scoring)'],
     ['rag/chunker.js','Text chunking (400w / 60w overlap)'],
     ['rag/store.js','BM25 search: score chunks, return Top-K'],
     ['start-instances.js','Multi-instance process spawner']],
    0.55,1.85,5.9,3.3,PURPLE)
T(sl,'Request Middleware Chain',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=BLUE)
chain=[('CORS (allow FRONTEND_URL only)',BLUE),('express.json() body parser',CYAN),
       ('requireAuth (JWT verify)',YELLOW),('requireAdmin (role check — admin routes)',PURPLE),
       ('Route Handler → SQLite / Gemini / ElevenLabs',GREEN),('res.json() response to client',BLUE)]
for i,(txt,acc) in enumerate(chain):
    flow_node(sl,txt,6.85,1.88+i*0.82,6.0,0.52,acc)
    if i<5: flow_arrow_v(sl,9.65,2.4+i*0.82)
snum(sl,43)

# ════════════════════════════════════════════════════════════════
# SLIDE 44 — DEPLOYMENT SYSTEM DESIGN
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Deployment','Deployment System Design',CYAN)
code_box(sl,['# render.yaml','services:','  - type: web',
    '    name: cira-backend',
    '    runtime: node',
    '    buildCommand: "cd backend && npm i"',
    '    startCommand: "node server.js"',
    '    disk:',
    '      name: data',
    '      mountPath: /app/data',
    '      sizeGB: 1',
    '    healthCheckPath: /api/health'],
    0.55,1.48,6.1,3.25)
code_box(sl,['# netlify.toml','[build]',
    '  base    = "frontend"',
    '  command = "npm run build"',
    '  publish = "build"','',
    '[[redirects]]',
    '  from   = "/*"',
    '  to     = "/index.html"',
    '  status = 200   # SPA routing'],
    0.55,4.82,6.1,2.5)
info_box(sl,6.85,1.48,6.0,1.05,'☁️  Netlify CDN (Frontend)','Serves React SPA globally from edge nodes. Instant cache invalidation on push. Zero cold-start for users.',BLUE)
info_box(sl,6.85,2.62,6.0,1.05,'⚙️  Render.com (Backend)','Node.js server + 1 GB persistent disk for SQLite. Auto-deploy on GitHub push. Zero-downtime deploys.',PURPLE)
info_box(sl,6.85,3.76,6.0,1.05,'🤖  External APIs','Google Gemini · ElevenLabs TTS · Google Fit — all HTTPS with API key auth. No vendor lock-in for AI model.',GREEN)
info_box(sl,6.85,4.9,6.0,1.05,'📈  Scaling Path','SQLite for small-medium scale. Clear migration path to PostgreSQL + multiple Render instances for enterprise.',YELLOW)
snum(sl,44)

# ════════════════════════════════════════════════════════════════
# SLIDE 45 — SECTION 6 DIVIDER
# ════════════════════════════════════════════════════════════════
section_slide(prs,6,'Architecture & Advantages',
    'Design patterns  ·  Cost efficiency  ·  Security  ·  Scalability  ·  Why CIRA wins',
    RED,45)

# ════════════════════════════════════════════════════════════════
# SLIDE 46 — HIGH-LEVEL ARCHITECTURE DIAGRAM
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Architecture','High-Level Architecture Diagram',RED)
tiers=[
    ('Client Tier',BLUE,'📱 React 18 SPA\n🔐 AuthContext (JWT)\n💬 ChatPage\n👤 ProfilePage\n🛡 AdminLayout\n🎤 Web Speech API\n🌗 Dark/Light Theme'),
    ('Server Tier',PURPLE,'⚙️ Express REST API\n🔒 JWT Middleware\n📋 25+ Routes\n📊 SQLite WAL\n🔍 BM25 RAG Engine\n✂️ Text Chunker\n🏗 Multi-Instance Spawn'),
    ('External APIs',GREEN,'🤖 Google Gemini\n   (6 model variants)\n🔊 ElevenLabs TTS\n   (11 voices, 4 models)\n🏃 Google Fit API\n   (OAuth2, read-only)\n📄 pdf-parse library'),
]
for i,(title,acc,items) in enumerate(tiers):
    R(sl,0.45+i*4.3,1.52,4.0,4.8,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,title,0.5+i*4.3,1.62,3.9,0.35,size=12,bold=True,color=acc,align=PP_ALIGN.CENTER)
    hline(sl,0.6+i*4.3,2.05,3.7,_dim(acc,3))
    T(sl,items,0.6+i*4.3,2.15,3.8,3.8,size=10.5,color=MUTED,align=PP_ALIGN.CENTER)
    if i<2: T(sl,'⟷',4.33+i*4.3,3.75,0.52,0.5,size=20,color=DIM,align=PP_ALIGN.CENTER)
T(sl,'Client  ←→  HTTPS REST API  ←→  SQLite  |  Client  ←→  Server  ←→  Gemini / ElevenLabs / Google Fit',
  0.55,6.45,12.3,0.42,size=10,color=DIM,align=PP_ALIGN.CENTER)
snum(sl,46)

# ════════════════════════════════════════════════════════════════
# SLIDE 47 — DESIGN PATTERNS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Design Patterns','Architectural Design Patterns',RED)
patterns=[
    ('🏛','Client-Server (3-Tier)','React frontend (presentation) ↔ Express API (business logic) ↔ SQLite (data). Clean separation enables independent deployment and scaling of each tier.',BLUE),
    ('🔗','REST (Stateless API)','All interactions via HTTP verbs on resource URIs. Stateless requests enable horizontal scaling. JWT eliminates server-side session state entirely.',PURPLE),
    ('🧩','RAG Pattern','Domain knowledge retrieved at query time and injected into LLM context. Eliminates hallucination risk for factual domain questions.',CYAN),
    ('🔐','Middleware Chain (AOP)','Cross-cutting concerns (auth, CORS, body parsing) separated into Express middleware. Business logic stays clean. Aspect-oriented separation.',GREEN),
    ('🏭','Multi-Tenant (Process Isolation)','Separate OS processes per instance, each with isolated SQLite file. True data isolation without containers or VMs.',YELLOW),
    ('🎯','Strategy Pattern (Knowledge)','RAG, own knowledge, and web search are independently togglable strategies with configurable weight percentages.',RED),
]
for i,(icon,title,desc,acc) in enumerate(patterns):
    c=i%2; rr=i//2
    R(sl,0.55+c*6.45,1.48+rr*1.8,6.1,1.65,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,icon+' '+title,0.7+c*6.45,1.58+rr*1.8,5.7,0.35,size=12,bold=True,color=acc)
    T(sl,desc,0.7+c*6.45,1.97+rr*1.8,5.7,1.0,size=10,color=MUTED)
snum(sl,47)

# ════════════════════════════════════════════════════════════════
# SLIDE 48 — ADVANTAGE: NO VECTOR EMBEDDINGS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x06,0x14,0x0e))
slide_header(sl,'Advantage #1','Zero Vector Infrastructure',GREEN)
for i,(num,lbl,col) in enumerate([('$0','Embedding API Cost',GREEN),('<5ms','BM25 Search Latency',CYAN),('12 MB','Typical DB Size',YELLOW)]):
    stat_box(sl,0.55+i*4.27,1.48,4.0,1.55,num,lbl,col)
R(sl,0.55,3.18,5.9,3.5,fill=_dim(RED,9),line=RED,radius=True)
T(sl,'❌  Traditional RAG Stack Cost',0.7,3.28,5.7,0.32,size=11.5,bold=True,color=RED)
bullets(sl,[
    'OpenAI Embedding API: ~$0.13 / million tokens',
    'Pinecone / Weaviate: $70–250 / month',
    'Requires separate async embedding pipeline',
    'Slow cold-start and external API dependency',
],0.7,3.65,5.5,2.7,RED,size=11)
R(sl,6.85,3.18,6.0,3.5,fill=_dim(GREEN,9),line=GREEN,radius=True)
T(sl,'✅  CIRA BM25 Advantage',7.0,3.28,5.7,0.32,size=11.5,bold=True,color=GREEN)
bullets(sl,[
    'Pure JavaScript — zero external API calls at all',
    'SQLite storage: free, embedded, fully portable',
    'Instant synchronous indexing (< 5 ms)',
    'Fully explainable results (keyword matching)',
],7.0,3.65,5.7,2.7,GREEN,size=11)
snum(sl,48)

# ════════════════════════════════════════════════════════════════
# SLIDE 49 — ADVANTAGE: MODULAR KNOWLEDGE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #2','Modular, Weighted Knowledge Sources',CYAN)
T(sl,'Admins independently tune 3 knowledge source weights from 0–100%, composing custom knowledge strategies per deployment:',
  0.55,1.48,12.3,0.45,size=12,color=MUTED)
srcs=[
    ('📚','KB Documents (RAG)',
     'Upload domain docs (PDF/TXT/MD). Ground answers strictly in your content. Set to 100% for compliance-sensitive deployments.',BLUE),
    ('🧠',"Gemini's Own Knowledge",
     "Leverage Gemini's training data for general questions outside the KB. Set to 0% for strict KB-only mode.",PURPLE),
    ('🌐','Live Web Search',
     'Real-time Google Search via Gemini tool use. Always-current answers for trending topics and breaking news.',CYAN),
]
for i,(icon,title,desc,acc) in enumerate(srcs):
    R(sl,0.55+i*4.27,2.08,4.0,3.2,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,icon,0.55+i*4.27,2.18,4.0,0.55,size=22,align=PP_ALIGN.CENTER)
    T(sl,title,0.65+i*4.27,2.78,3.8,0.38,size=12,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,desc,0.65+i*4.27,3.22,3.8,1.75,size=10.5,color=MUTED,align=PP_ALIGN.CENTER)
R(sl,0.55,5.42,12.3,0.8,fill=_dim(BLUE,9),line=DIM,radius=True)
T(sl,'Presets:  Strict Mode (KB=100, Own=0, Web=0)   ·   Balanced (KB=80, Own=60, Web=40)   ·   General (KB=0, Own=100, Web=100)',
  0.7,5.58,12.0,0.52,size=11,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,49)

# ════════════════════════════════════════════════════════════════
# SLIDE 50 — ADVANTAGE: SMART PERSONALIZATION
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #3','Smart Personalization Without Manual Prompting',GREEN)
T(sl,"CIRA's personalization stack works entirely automatically — users never need to re-explain themselves:",
  0.55,1.48,5.9,0.5,size=12,color=MUTED)
steps50=[
    ('1','User fills profile once','Health data stored permanently and auto-injected into every conversation context.',GREEN),
    ('2','AI extracts facts automatically','Memories extracted from chat history via Gemini. System learns preferences without forms.',CYAN),
    ('3','Fitness data syncs on demand','One OAuth2 connection to Google Fit. Steps, HR, weight always available in context.',BLUE),
    ('4','All assembled per-request','Profile + memories + fitness + KB + history = rich systemInstruction built in < 20 ms.',YELLOW),
]
for i,(n,title,desc,acc) in enumerate(steps50):
    R(sl,0.55,2.05+i*1.22,0.55,0.55,fill=_dim(acc,4),line=acc,radius=True)
    T(sl,n,0.55,2.05+i*1.22,0.55,0.55,size=14,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,title,1.22,2.07+i*1.22,4.7,0.32,size=11.5,bold=True,color=WHITE)
    T(sl,desc,1.22,2.42+i*1.22,4.7,0.75,size=10,color=MUTED)
table(sl,['Feature','CIRA','Generic'],
    [['User profile','✅ Stored & injected','❌'],
     ['Learned memories','✅ Auto-extracted','❌'],
     ['Fitness data','✅ Live via OAuth2','❌'],
     ['Conversation history','✅ Persistent','Session only'],
     ['Tone / style control','✅ Admin config','❌']],
    6.85,1.48,6.0,4.0,GREEN)
snum(sl,50)

# ════════════════════════════════════════════════════════════════
# SLIDE 51 — ADVANTAGE: COST EFFICIENCY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #4','Cost Efficiency — Run for Under $20/Month',YELLOW)
table(sl,['Component','CIRA Cost','Typical Alternative'],
    [['Hosting (Render)','$7 / month','$20–50'],
     ['CDN (Netlify)','$0 (free tier)','$15–20'],
     ['Vector Database','$0 (SQLite)','$70–250'],
     ['Embedding API','$0 (BM25)','$5–50'],
     ['Gemini API','Pay-per-use','Pay-per-use'],
     ['ElevenLabs TTS','$5 starter tier','$5+'],
     ['Total (fixed infra)','~$12 / month','$110–370']],
    0.55,1.48,5.9,4.0,YELLOW)
T(sl,'Cost-Saving Architecture Decisions',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=CYAN)
bullets(sl,[
    ('BM25 over vectors','Saves $70–250/month in vector DB costs alone'),
    ('SQLite over PostgreSQL','Zero database hosting cost, zero maintenance'),
    ('Context API over Redux','No state management library subscription'),
    ('Web Speech API','Zero STT API cost — native browser capability'),
    ('Gemini Flash over GPT-4','10–50× cheaper per token for equivalent quality'),
    ('Multi-instance on one server','One Render instance serves N chatbots in parallel'),
],6.85,1.88,6.0,4.25,YELLOW)
snum(sl,51)

# ════════════════════════════════════════════════════════════════
# SLIDE 52 — ADVANTAGE: SCALABILITY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #5','Scalability & Reliability',BLUE)
scalability=[
    ('⚡','Stateless REST API','JWT auth eliminates server-side session state. Any number of Node.js processes can serve the same JWT — horizontal scaling requires no shared session store.',BLUE),
    ('🔀','Multi-Instance Process Isolation','Each chatbot instance runs as an isolated OS process with its own SQLite file. Instance A crashing does not affect Instance B. Natural fault isolation.',PURPLE),
    ('📦','SQLite WAL Concurrent I/O','WAL mode handles concurrent HTTP requests without blocking. Multiple users chatting simultaneously share the DB safely — tested to ~50 concurrent users per instance.',CYAN),
    ('🌐','CDN-Served Frontend','React SPA is a static build served from Netlify\'s global edge network. Frontend scales infinitely regardless of backend load. Zero frontend server management.',GREEN),
]
for i,(icon,title,desc,acc) in enumerate(scalability):
    c=i%2; rr=i//2
    R(sl,0.55+c*6.45,1.48+rr*2.75,6.1,2.6,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,icon+' '+title,0.7+c*6.45,1.58+rr*2.75,5.7,0.35,size=12,bold=True,color=acc)
    T(sl,desc,0.7+c*6.45,1.98+rr*2.75,5.7,1.75,size=10.5,color=MUTED)
snum(sl,52)

# ════════════════════════════════════════════════════════════════
# SLIDE 53 — ADVANTAGE: SECURITY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x12,0x06,0x0a))
slide_header(sl,'Advantage #6','Security Architecture',RED)
sec=[
    ('🔑','Password Security','bcryptjs with 10 salt rounds. Never stored in plaintext. Computationally expensive to brute-force.',RED),
    ('🎫','JWT Signed Tokens','HMAC-SHA256 signed. Tamper-evident. 7-day expiry. Role claims verified server-side on every request.',YELLOW),
    ('🚧','CORS Protection','Only FRONTEND_URL allowed as CORS origin. Blocks unauthorized cross-origin API calls from other domains.',BLUE),
    ('🔒','OAuth2 Read-Only','Google Fit requests only read scopes. Tokens stored server-side. Refresh tokens never exposed to frontend.',PURPLE),
    ('🛡️','Role-Based Access','Admin routes double-protected: requireAuth (JWT valid) + requireAdmin (role="admin"). Layered defense.',GREEN),
    ('📝','Safe Markdown','react-markdown sanitizes HTML in AI responses by default. No XSS injection possible through AI-generated content.',CYAN),
]
for i,(icon,title,desc,acc) in enumerate(sec):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,1.5+rr*2.55,4.0,2.38,icon,title,desc,acc)
snum(sl,53)

# ════════════════════════════════════════════════════════════════
# SLIDE 54 — ADVANTAGE: DEVELOPER EXPERIENCE
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #7','Developer Experience & Extensibility',PURPLE)
bullets(sl,[
    ('Zero build config','CRA frontend, plain Node.js backend. No Webpack config, no TypeScript migration needed.'),
    ('No ORM needed','Raw better-sqlite3 with synchronous API — easy to reason about, debug, and extend.'),
    ('Model switching','Change Gemini model in admin settings UI — zero code change required.'),
    ('Behavior without redeploy','System prompt, temperature, KB weights, TTS defaults — all in database settings.'),
    ('Self-contained','Single npm install in /frontend and /backend — no monorepo tooling.'),
    ('Instances in JSON','Add a new chatbot instance by adding one JSON object to instances.json.'),
    ('CSS design tokens','Theme customization via CSS custom properties — no Tailwind config needed.'),
],0.55,1.48,5.9,5.55,PURPLE)
T(sl,'Getting Started in 4 Steps',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=BLUE)
code_box(sl,['# 1. Clone and install','git clone https://github.com/.../cira',
    'cd backend  && npm install',
    'cd ../frontend && npm install','',
    '# 2. Configure environment',
    'cp backend/.env.example backend/.env',
    '# Edit: GEMINI_API_KEY, JWT_SECRET','',
    '# 3. Start all instances',
    'node start-instances.js','',
    '# 4. Start frontend dev server',
    'cd frontend && npm start','',
    '# Ready at http://localhost:3000'],6.85,1.88,6.0,4.95)
snum(sl,54)

# ════════════════════════════════════════════════════════════════
# SLIDE 55 — ADVANTAGE: ADMIN-FIRST
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantage #8','Admin-First: Zero-Code Bot Configuration',YELLOW)
T(sl,'Every aspect of CIRA behavior can be changed by a non-technical admin without touching any code:',
  0.55,1.48,12.3,0.45,size=12,color=MUTED)
configs=[
    ('🤖','Switch AI Model','Dropdown: Gemini Flash → Gemini Pro → Gemma. Takes effect on next request.',BLUE),
    ('📝','Edit System Prompt','Change bot persona, scope, tone, language via text area in admin settings.',PURPLE),
    ('🌡️','Response Style','Toggle: Precise (0.2) / Balanced (0.7) / Creative (1.2) temperature presets.',CYAN),
    ('📚','Update Knowledge Base','Upload new PDFs or delete outdated docs. Available instantly after upload.',GREEN),
    ('🔊','Configure TTS','Set default voice, model, stability, similarity boost for all users.',YELLOW),
    ('⚖️','Knowledge Weights','Sliders for RAG, own knowledge, and web search weights (0–100 each).',RED),
]
for i,(icon,title,desc,acc) in enumerate(configs):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,2.08+rr*2.45,4.0,2.28,icon,title,desc,acc)
snum(sl,55)

# ════════════════════════════════════════════════════════════════
# SLIDE 56 — MULTI-MODEL SUPPORT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'Model Flexibility','Multi-Model Support',CYAN)
T(sl,'CIRA supports all major Gemini generations, enabling cost-performance trade-offs optimized per deployment:',
  0.55,1.48,12.3,0.45,size=12,color=MUTED)
table(sl,['Model','Speed','Quality','Cost','Web Search','Best For'],
    [['gemini-3-flash-preview ⭐','Fastest','Excellent','Low','✅','Default — recommended for all use'],
     ['gemini-2.5-pro','Moderate','Best','High','✅','Complex reasoning, research tasks'],
     ['gemini-2.5-flash','Fast','Very Good','Medium','✅','Balanced daily production use'],
     ['gemini-2.0-flash','Fast','Good','Low','✅','Budget-conscious deployments'],
     ['gemma-4','Variable','Good','Very Low','❌','Offline / air-gapped / privacy-first']],
    0.55,2.0,12.3,3.6,CYAN)
info_box(sl,0.55,5.72,12.3,0.85,'Admin Model Switching',
    'Admin switches model via settings panel dropdown. Gemma automatically disables web search. JSON-mode fallback to Gemini 1.5 Flash is hardcoded for memory extraction robustness.',CYAN)
snum(sl,56)

# ════════════════════════════════════════════════════════════════
# SLIDE 57 — PROGRESSIVE ENHANCEMENT
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Design Principle','Progressive Enhancement — Graceful Degradation',PURPLE)
T(sl,'Every optional feature degrades gracefully — the core chat experience is never broken by unavailable optional services:',
  0.55,1.48,12.3,0.45,size=12,color=MUTED)
table(sl,['Feature','If Unavailable — Fallback Behavior'],
    [['ElevenLabs TTS','TTS button hidden; text response still displayed normally'],
     ['Web Speech (STT)','Mic button hidden; keyboard input works normally'],
     ['Google Fit','Fitness section skipped; profile data still injected into context'],
     ['KB Documents','RAG weight ignored; own knowledge and web search used instead'],
     ['Web Search','Silently disabled on Gemma; KB + own knowledge used'],
     ['User Profile','System prompt only; no personalization context injected']],
    0.55,2.0,12.3,3.1,PURPLE)
R(sl,0.55,5.2,5.9,1.05,fill=_dim(GREEN,9),line=GREEN,radius=True)
T(sl,'✅  Core Experience Guarantee',0.7,5.3,5.7,0.32,size=11,bold=True,color=GREEN)
T(sl,'As long as GEMINI_API_KEY and JWT_SECRET are set, the basic text chat experience always works. All other features are opt-in.',
  0.7,5.65,5.6,0.55,size=10,color=MUTED)
R(sl,6.85,5.2,6.0,1.05,fill=_dim(BLUE,9),line=BLUE,radius=True)
T(sl,'🚀  Minimum Viable Deployment',7.0,5.3,5.7,0.32,size=11,bold=True,color=BLUE)
T(sl,'Set GEMINI_API_KEY and JWT_SECRET → get a fully functional, authenticated, multi-conversation chatbot immediately.',
  7.0,5.65,5.7,0.55,size=10,color=MUTED)
snum(sl,57)

# ════════════════════════════════════════════════════════════════
# SLIDE 58 — COMPARISON WITH ALTERNATIVES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Comparison','CIRA vs. Alternatives',BLUE)
table(sl,['Feature','CIRA','ChatGPT API','LangChain','Botpress'],
    [['Self-hosted','✅ Full control','❌ Cloud only','✅','Partial'],
     ['Vector DB needed','❌ BM25 only','Yes','Yes','Yes'],
     ['User personalization','✅ Deep','Manual only','Custom build','Limited'],
     ['Google Fit integration','✅ Built-in','❌','Custom build','❌'],
     ['Admin dashboard','✅ Full','❌','❌','✅'],
     ['AI memory extraction','✅ Auto (Gemini)','Manual API','Custom build','❌'],
     ['Monthly cost (infra)','~$12','$100+','$50–200','$200+'],
     ['Setup complexity','Low (2 npm installs)','Medium','High','High']],
    0.55,1.48,12.3,5.25,BLUE)
snum(sl,58)

# ════════════════════════════════════════════════════════════════
# SLIDE 59 — PERFORMANCE CHARACTERISTICS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Performance','Performance Characteristics',GREEN)
table(sl,['Operation','Latency','Notes'],
    [['JWT verification','< 1 ms','Pure CPU, cryptographic hash only'],
     ['SQLite reads (profile, history)','5–10 ms','WAL mode, typical 2–3 queries'],
     ['BM25 search (1,000 chunks)','< 5 ms','Pure in-process JS, no I/O'],
     ['System prompt assembly','< 1 ms','String concatenation'],
     ['Gemini API call ⚠','1–5 seconds','External network latency — bottleneck'],
     ['SQLite message insert','< 2 ms','WAL mode, synchronous write'],
     ['ElevenLabs TTS','300–800 ms','Depends on text length, model'],
     ['Total (excl. Gemini)','< 25 ms','All local operations extremely fast']],
    0.55,1.48,12.3,5.1,GREEN)
info_box(sl,0.55,6.68,12.3,0.6,'Optimization Takeaway',
    '99% of end-to-end latency is the Gemini API call. Gemini Flash is 3–5× faster than Pro models. All local operations complete in under 25 ms total.',GREEN)
snum(sl,59)

# ════════════════════════════════════════════════════════════════
# SLIDE 60 — REAL-WORLD DEPLOYMENT EXAMPLES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Case Studies','Real-World Deployment Configurations',PURPLE)
cases60=[
    ('🏥','Wellness Clinic Assistant',
     '• Model: Gemini 3 Flash\n• KB: Clinical guidelines PDFs\n• KB weight: 100% (strict)\n• Web search: disabled\n• Profile: full health fields\n• Fitness: Google Fit enabled\n• TTS: Rachel voice, Turbo v2.5',BLUE),
    ('🏢','HR Policy Bot',
     '• Model: Gemini 2.5 Flash\n• KB: Employee handbook, policies\n• KB weight: 90%\n• Own knowledge: 40%\n• Web search: disabled\n• Profile: name, department only\n• TTS: disabled',PURPLE),
    ('🎓','Student Tutor Bot',
     '• Model: Gemini Flash Preview\n• KB: Course PDFs, textbooks\n• KB weight: 70%\n• Own knowledge: 80%\n• Web search: 60%\n• Temperature: Creative (1.2)\n• TTS: Adam voice enabled',CYAN),
]
for i,(icon,title,desc,acc) in enumerate(cases60):
    R(sl,0.55+i*4.27,1.48,4.0,5.42,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,icon+' '+title,0.7+i*4.27,1.58,3.7,0.38,size=12.5,bold=True,color=acc)
    hline(sl,0.7+i*4.27,2.04,3.6,_dim(acc,4))
    T(sl,desc,0.7+i*4.27,2.18,3.7,4.4,size=11,color=MUTED)
snum(sl,60)

# ════════════════════════════════════════════════════════════════
# SLIDE 61 — TRADE-OFFS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Trade-Offs','Honest Trade-Off Analysis',BLUE)
R(sl,0.55,1.48,5.9,5.55,fill=_dim(GREEN,10),line=_dim(GREEN,4),radius=True)
T(sl,'✅  Where CIRA Excels',0.7,1.58,5.7,0.32,size=12,bold=True,color=GREEN)
bullets(sl,[
    'Low infrastructure cost and operational complexity',
    'Deep personalization out of the box (profile + memory + fitness)',
    'Fast local operations: SQLite and BM25 sub-10 ms',
    'Admin-configurable without any code changes',
    'Multi-instance from one codebase — real isolation',
    'Progressive enhancement / graceful degradation',
    'Fitness-aware AI (unique open-source differentiator)',
],0.7,1.98,5.5,4.7,GREEN,size=11)
R(sl,6.85,1.48,6.0,5.55,fill=_dim(YELLOW,10),line=_dim(YELLOW,4),radius=True)
T(sl,'⚠️  Known Limitations',7.0,1.58,5.7,0.32,size=12,bold=True,color=YELLOW)
bullets(sl,[
    'BM25 lacks semantic understanding (synonym gap)',
    'SQLite not ideal for > 1,000 concurrent users',
    'No streaming responses (full text returned at once)',
    'Dependent on Google Gemini API availability',
    'Single-server instance — no distributed deployment yet',
    'No built-in rate limiting or abuse protection',
    'Memory extraction limited to last 150 messages',
],7.0,1.98,5.7,4.7,YELLOW,size=11)
snum(sl,61)

# ════════════════════════════════════════════════════════════════
# SLIDE 62 — FUTURE ROADMAP
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Roadmap','Future Roadmap',PURPLE)
T(sl,'Near Term  (v2.0)',0.55,1.48,5.9,0.32,size=11.5,bold=True,color=BLUE)
roadmap_near=[
    ('1','Streaming Responses','Server-Sent Events (SSE) for real-time token streaming — eliminates perceived latency for long responses.',BLUE),
    ('2','Hybrid BM25 + Semantic','Add optional vector embeddings as opt-in alongside BM25 for queries requiring semantic understanding.',PURPLE),
    ('3','Rate Limiting','express-rate-limit middleware to prevent API abuse. Configurable per-user request limits in admin panel.',CYAN),
]
for i,(n,title,desc,acc) in enumerate(roadmap_near):
    R(sl,0.55,1.88+i*1.38,0.55,0.55,fill=_dim(acc,4),line=acc,radius=True)
    T(sl,n,0.55,1.88+i*1.38,0.55,0.55,size=14,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,title,1.22,1.9+i*1.38,4.7,0.32,size=11.5,bold=True,color=WHITE)
    T(sl,desc, 1.22,2.25+i*1.38,4.7,0.88,size=10,color=MUTED)
T(sl,'Long Term  (v3.0)',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=PURPLE)
roadmap_long=[
    ('4','PostgreSQL Migration','Abstract DB layer to support both SQLite and PostgreSQL. Enable horizontal scaling for enterprise.',PURPLE),
    ('5','Multi-Modal Support','Image uploads in chat using Gemini\'s vision capabilities — analyze charts, photos, documents inline.',GREEN),
    ('6','Wearable Integrations','Expand beyond Google Fit to Apple Health, Fitbit, and Garmin APIs for broader fitness data coverage.',YELLOW),
]
for i,(n,title,desc,acc) in enumerate(roadmap_long):
    R(sl,6.85,1.88+i*1.38,0.55,0.55,fill=_dim(acc,4),line=acc,radius=True)
    T(sl,n,6.85,1.88+i*1.38,0.55,0.55,size=14,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,title,7.52,1.9+i*1.38,5.1,0.32,size=11.5,bold=True,color=WHITE)
    T(sl,desc, 7.52,2.25+i*1.38,5.1,0.88,size=10,color=MUTED)
snum(sl,62)

# ════════════════════════════════════════════════════════════════
# SLIDE 63 — DATA FLOW SUMMARY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Data Flow','Complete Data Flow — One Chat Message',CYAN)
cols63=[
    ('USER',BLUE,'Types message\n↓\nPOST /api/chat\nBearer: JWT\n↓\nWaits for response\n↓\nRenders Markdown\n↓\nPlays TTS audio'),
    ('API SERVER',PURPLE,'Verifies JWT\n↓\nReads user profile\n↓\nReads memories\n↓\nReads fitness data\n↓\nReads last 10 msgs\n↓\nAssembles prompt\n↓\nSaves both msgs'),
    ('RAG ENGINE',GREEN,'Tokenize query\n↓\nLoad all KB chunks\n↓\nBM25 score each\n↓\nSort by relevance\n↓\nReturn Top-5\n↓\nWith doc names'),
    ('GEMINI API',YELLOW,'Receives context:\n↓\nSystem instruction\n↓\nUser profile\n↓\nKB chunks\n↓\nChat history\n↓\nGenerates response\n↓\nReturns text'),
]
for i,(title,acc,content) in enumerate(cols63):
    R(sl,0.45+i*3.22,1.5,3.0,5.65,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,title,0.5+i*3.22,1.6,2.9,0.32,size=10.5,bold=True,color=acc,align=PP_ALIGN.CENTER)
    hline(sl,0.6+i*3.22,1.98,2.7,_dim(acc,4))
    T(sl,content,0.55+i*3.22,2.1,2.95,4.8,size=9.5,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,63)

# ════════════════════════════════════════════════════════════════
# SLIDE 64 — SECURITY CHECKLIST
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x12,0x06,0x0a))
slide_header(sl,'Security Checklist','Production Security Checklist',RED)
checks_pass=[
    'Passwords hashed with bcryptjs (10 salt rounds)',
    'JWT signed with HMAC-SHA256, 7-day expiry',
    'CORS restricted to FRONTEND_URL only',
    'Admin routes double-protected (auth + role)',
    'OAuth2 read-only scopes for Google Fit',
    'OAuth tokens stored server-side only',
    'File upload type validation (PDF/TXT/MD only)',
    'File size limit enforced (20 MB max)',
    'Markdown rendered safely — XSS prevented',
]
checks_warn=[
    'Rate limiting not yet implemented (v2.0 roadmap)',
    'HTTPS enforcement delegated to Render/Netlify',
    'No input length limits on chat messages (add for prod)',
    'No CSRF protection (SPA + JWT = mitigated)',
]
T(sl,'✅  Implemented Security Controls',0.55,1.48,5.9,0.32,size=11.5,bold=True,color=GREEN)
for i,c in enumerate(checks_pass):
    R(sl,0.55,1.88+i*0.52,0.35,0.35,fill=_dim(GREEN,4),line=GREEN,radius=True)
    T(sl,'✓',0.55,1.88+i*0.52,0.35,0.35,size=10,bold=True,color=GREEN,align=PP_ALIGN.CENTER)
    T(sl,c,1.0,1.92+i*0.52,5.3,0.44,size=10.5,color=MUTED)
T(sl,'⚠️  Known Gaps / Recommendations',6.85,1.48,6.0,0.32,size=11.5,bold=True,color=YELLOW)
for i,c in enumerate(checks_warn):
    R(sl,6.85,1.88+i*0.62,0.35,0.35,fill=_dim(YELLOW,4),line=YELLOW,radius=True)
    T(sl,'!',6.85,1.88+i*0.62,0.35,0.35,size=10,bold=True,color=YELLOW,align=PP_ALIGN.CENTER)
    T(sl,c,7.3,1.92+i*0.62,5.3,0.54,size=10.5,color=MUTED)
snum(sl,64)

# ════════════════════════════════════════════════════════════════
# SLIDE 65 — ADVANTAGES SUMMARY
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Advantages Summary','Why Choose CIRA — 8 Competitive Advantages',BLUE)
advs=[
    ('💰','Cost Efficient','~$12/month vs. $110–370 for equivalent stacks',BLUE),
    ('🧠','Deep Personalization','Profile + AI memories + live Google Fit data',PURPLE),
    ('🔍','Zero-Cost RAG','BM25: no vector DB or embedding API required',CYAN),
    ('⚙️','Admin-First','Full bot config without any code changes',GREEN),
    ('🏗️','Multi-Instance','N isolated bots from one codebase',YELLOW),
    ('🤖','Model Agnostic','6 Gemini variants, switch without code',RED),
    ('🛡️','Secure by Design','JWT + bcrypt + RBAC + CORS + OAuth2',BLUE),
    ('📱','Rich UX','TTS · STT · Markdown · themes · responsive',PURPLE),
]
for i,(icon,title,desc,acc) in enumerate(advs):
    c=i%4; rr=i//4
    R(sl,0.45+c*3.22,1.52+rr*2.6,3.0,2.4,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,icon,0.45+c*3.22,1.62+rr*2.6,3.0,0.5,size=20,align=PP_ALIGN.CENTER)
    T(sl,title,0.55+c*3.22,2.18+rr*2.6,2.8,0.32,size=11,bold=True,color=acc,align=PP_ALIGN.CENTER)
    T(sl,desc, 0.55+c*3.22,2.55+rr*2.6,2.8,1.2,size=9.5,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,65)

# ════════════════════════════════════════════════════════════════
# SLIDE 66 — API DESIGN PRINCIPLES
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, BG2)
slide_header(sl,'API Principles','REST API Design Principles',GREEN)
principles=[
    ('📐','Resource-Oriented URLs','URLs identify resources: /api/conversations/:id, /api/user/memories/:id. Actions are expressed via HTTP verbs (GET/POST/PUT/PATCH/DELETE), not verbs in URLs.',GREEN),
    ('🔄','Consistent Response Shape','Success: data payload JSON. Error: {"error":"message"} with appropriate HTTP code (400/401/403/500). Frontend handles both shapes uniformly.',BLUE),
    ('🔗','Stateless Requests','Every request carries full auth context (JWT Bearer token). No server session required. Enables load balancing without sticky sessions.',PURPLE),
    ('🏷️','Content Negotiation','JSON for all API responses. MP3 audio for /api/tts. Content-Type headers correctly set on all responses for client-side handling.',CYAN),
]
for i,(icon,title,desc,acc) in enumerate(principles):
    c=i%2; rr=i//2
    R(sl,0.55+c*6.45,1.52+rr*2.65,6.1,2.48,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,icon+' '+title,0.7+c*6.45,1.62+rr*2.65,5.7,0.35,size=12.5,bold=True,color=acc)
    T(sl,desc,0.7+c*6.45,2.04+rr*2.65,5.7,1.65,size=11,color=MUTED)
snum(sl,66)

# ════════════════════════════════════════════════════════════════
# SLIDE 67 — TECHNICAL INNOVATIONS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Innovations','Technical Innovation Highlights',CYAN)
innovations=[
    ('🧬','AI-Powered Memory','Using Gemini to analyze conversation history and extract persistent user facts is a unique approach to implicit personalization — no user survey or manual tagging required.'),
    ('⚖️','Weighted Knowledge Blending','Simultaneously weighting RAG, model knowledge, and web search is not a standard chatbot pattern. It enables fine-grained control over information sourcing per deployment context.'),
    ('🏃','Live Fitness Context','Injecting real-time wearable data (steps, HR, weight) into AI system prompts bridges the gap between fitness tracking and actionable AI advice — a first for open-source chatbots.'),
]
for i,(icon,title,desc) in enumerate(innovations):
    R(sl,0.55+i*4.27,1.55,4.0,5.35,fill=CARD,line=DIM,radius=True)
    T(sl,icon,0.55+i*4.27,1.75,4.0,0.65,size=28,align=PP_ALIGN.CENTER)
    T(sl,title,0.7+i*4.27,2.5,3.7,0.38,size=13,bold=True,color=[CYAN,PURPLE,GREEN][i],align=PP_ALIGN.CENTER)
    hline(sl,0.7+i*4.27,2.98,3.6,DIM)
    T(sl,desc,0.7+i*4.27,3.1,3.7,2.6,size=11,color=MUTED,align=PP_ALIGN.CENTER)
snum(sl,67)

# ════════════════════════════════════════════════════════════════
# SLIDE 68 — KEY TAKEAWAYS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Key Takeaways','Key Takeaways',BLUE)
takeaways=[
    ('🎯','Personalization is the core differentiator',
     'Profile + AI memories + Google Fit creates a uniquely context-aware assistant experience.',BLUE),
    ('💡','BM25 eliminates the biggest cost driver',
     'No vector DB or embedding API means 90%+ reduction in RAG infrastructure costs.',GREEN),
    ('⚡','Admin-first design enables non-technical management',
     'Every critical behavior configurable via UI — no redeploy needed for any settings change.',PURPLE),
    ('🏗️','Architecture scales pragmatically',
     'SQLite WAL for small-medium scale, clear migration path to PostgreSQL for enterprise.',YELLOW),
    ('🌱','Production-ready today',
     'Deploy to Render + Netlify in under 30 minutes with just 2 required API keys.',CYAN),
]
for i,(icon,title,desc,acc) in enumerate(takeaways):
    R(sl,0.55,1.52+i*1.08,12.3,0.95,fill=_dim(acc,9),line=acc,radius=True)
    T(sl,icon,0.68,1.6+i*1.08,0.55,0.55,size=16,align=PP_ALIGN.CENTER)
    T(sl,title,1.35,1.62+i*1.08,5.5,0.35,size=12,bold=True,color=WHITE)
    T(sl,desc,  1.35,2.0+i*1.08,10.9,0.38,size=10.5,color=MUTED)
snum(sl,68)

# ════════════════════════════════════════════════════════════════
# SLIDE 69 — DEMO HIGHLIGHTS
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs)
slide_header(sl,'Live Demo','What to Look For in the Demo',GREEN)
demo_items=[
    ('💬','Multi-Conversation','Create two separate conversations. Notice each has an auto-generated title and independent message history.',GREEN),
    ('📚','RAG in Action','Ask about content from an uploaded document. Notice source citation references appear alongside the AI response.',CYAN),
    ('🔊','TTS + STT','Click the TTS button to hear the response in ElevenLabs voice. Use the microphone to speak a question.',BLUE),
    ('👤','Profile Impact','Fill the health profile. Ask a fitness question — notice how the answer references your specific profile data.',PURPLE),
    ('💾','Memory Extraction','After several conversations, trigger memory extraction. Watch Gemini auto-identify learned facts about you.',YELLOW),
    ('⚙️','Admin Settings','Switch the AI model, change the system prompt, upload a document — all without restarting the server.',RED),
]
for i,(icon,title,desc,acc) in enumerate(demo_items):
    c=i%3; rr=i//3
    card(sl,0.55+c*4.27,1.52+rr*2.65,4.0,2.48,icon,title,desc,acc)
snum(sl,69)

# ════════════════════════════════════════════════════════════════
# SLIDE 70 — THANK YOU / Q&A
# ════════════════════════════════════════════════════════════════
sl = new_slide(prs, RGBColor(0x07,0x0b,0x20))
# Decorative accent lines
R(sl,0,0,13.333,1.2,fill=RGBColor(0x0a,0x14,0x38))
R(sl,0,6.3,13.333,1.2,fill=RGBColor(0x0a,0x14,0x38))
badge(sl,'Thank You',5.7,0.25,BLUE)
T(sl,'Questions?',1.0,1.42,11.3,1.5,size=68,bold=True,color=WHITE,align=PP_ALIGN.CENTER)
T(sl,'CIRA — Intelligent Conversational AI',1.0,3.0,11.3,0.65,size=26,bold=True,color=BLUE,align=PP_ALIGN.CENTER)
hline(sl,2.5,3.82,8.3,DIM)
# 3-column footer boxes
for i,(icon,lbl,val,acc) in enumerate([
    ('🔗','GitHub Repository','bashab18/chatbot',BLUE),
    ('⚡','Powered By','Google Gemini API',PURPLE),
    ('🚀','Deploy On','Render + Netlify',CYAN)]):
    R(sl,2.5+i*2.95,4.08,2.7,1.45,fill=_dim(acc,8),line=acc,radius=True)
    T(sl,icon,2.5+i*2.95,4.15,2.7,0.45,size=18,align=PP_ALIGN.CENTER)
    T(sl,lbl,2.5+i*2.95,4.6,2.7,0.3,size=9,color=MUTED,align=PP_ALIGN.CENTER)
    T(sl,val,2.5+i*2.95,4.9,2.7,0.45,size=12,bold=True,color=acc,align=PP_ALIGN.CENTER)
# Tags row
tags70=[('React 18',BLUE),('Node.js',PURPLE),('SQLite WAL',GREEN),('BM25 RAG',CYAN),('JWT Auth',YELLOW),('Google Fit',RED),('ElevenLabs TTS',BLUE),('Multi-Instance',PURPLE)]
x70=0.45
for tag,col in tags70:
    badge(sl,tag,x70,5.82,col); x70+=len(tag)*0.115+0.75
snum(sl,70)

# ── Save ─────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), 'CIRA_Chatbot_Presentation.pptx')
prs.save(out)
print(f'Saved → {out}')
print(f'Total slides: {len(prs.slides)}')
