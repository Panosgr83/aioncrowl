# AIONCLAW — Builder Context
~/AION/aionclaw/BUILDER_CONTEXT.md

> ⚡ **Σημαντικό:** Αυτό το αρχείο διαβάζεται αυτόματα από το opencode μέσω του `instructions` στο `opencode.jsonc`. ΔΕΝ χρειάζεται να το καλέσεις χειροκίνητα.

## Σύνταγμα — 5 Κανόνες

### ΚΑΝΟΝΑΣ #1 — Context First
Πριν κάνεις ΟΤΙΔΗΠΟΤΕ, διάβασε:
~/AION/aionclaw/BUILDER_CONTEXT.md

Αν δεν υπάρχει → ρώτα τον χρήστη πριν προχωρήσεις.

### ΚΑΝΟΝΑΣ #2 — Plan Mode / Build Mode

**Default: PLAN MODE (read-only)**
Εκτός αν ο χρήστης πει ρητά:
- "υλοποίησε", "εκτέλεσε", "κάνε το", "Build Mode", "προχώρα"

Σε Plan Mode:
- Αναλύεις, προτείνεις, εξηγείς
- ZERO edits σε αρχεία
- Παράγεις έτοιμα snippets για review

**Build Mode (μετά από ρητή έγκριση)**
- Ένα αρχείο τη φορά
- Τεστάρεις build μετά από κάθε αλλαγή
- Ένα commit ανά logical unit

### ΚΑΝΟΝΑΣ #3 — Conflict Check
Πριν γράψεις ή τροποποιήσεις οποιοδήποτε αρχείο:
1. Διάβασε το τρέχον αρχείο
2. Εντόπισε αν το νέο feature συγκρούεται με υπάρχον κώδικα
3. Αν ναι → ΣΤΑΜΑΤΑ και ρώτα τον χρήστη
4. Αν όχι → προχώρα

Ποτέ δεν εκτελείς όταν υπάρχει αμφιβολία.

### ΚΑΝΟΝΑΣ #4 — Commit Structure
- Ένα commit ανά logical unit (όχι όλα μαζί)
- Format: `[type]: [description]`
  - type: `add`, `fix`, `refactor`, `update`, `remove`
- Πάντα τεστάρεις build πριν commit

### ΚΑΝΟΝΑΣ #5 — Αρχιτεκτονικές Αποφάσεις
Μην αναιρείς χωρίς ρητή εντολή — βλ. πίνακα "Αρχιτεκτονικές Αποφάσεις" παρακάτω.

### Γλώσσα
- Απαντάς **πάντα στα Ελληνικά** (με αγγλικούς τεχνικούς όρους όπου χρειάζεται)
- Το reasoning σου είναι επίσης στα Ελληνικά

### Λειτουργία: Explain-First
Όταν ο χρήστης ζητά την υλοποίηση νέου feature:
1. Εξήγησε πρώτα **τι είναι** (περιγραφή)
2. Εξήγησε **πώς θα λειτουργεί** (UX/συμπεριφορά)
3. Περίμενε επιβεβαίωση πριν γράψεις κώδικα

Αυτή η λειτουργία ισχύει για ΟΛΑ τα features, UI steps, refactors, και νέους agents.

### Workflow ανά Session

```
1. Διάβασε αυτό το αρχείο (BUILDER_CONTEXT.md) — γίνεται αυτόματα από opencode
2. Κατανόησε το request
3. PLAN MODE → ανάλυση + snippets (αν χρειάζεται)
4. Περίμενε έγκριση
5. BUILD MODE → εκτέλεση ανά αρχείο
6. Test build
7. Commit
8. Αν υπάρχουν νέα commits → ενημέρωσε το git log σε αυτό το αρχείο
```

## Project Info
- **Όνομα:** AIONCLAW
- **Ιδιοκτήτης:** Panagiotis Choliasmenos (AION Web Solutions)
- **Τύπος:** Multi-agent AI system για web design/marketing agency
- **Status:** active
- **Repo:** https://github.com/Panosgr83/aioncrowl.git
- **Τελευταία ενημέρωση:** 2026-05-30

## Stack
- **Frontend:** React/Vite (port 5174)
- **Backend:** FastAPI (port 9790)
- **Database:** SQLite (sessions), numpy vectors (KB)
- **Hosting:** local (macOS)
- **Communication:** WebSocket

## Αρχεία & Δομή (κρίσιμα)

### Backend (~/AION/aionclaw/backend/)
| Αρχείο | Ρόλος |
|--------|-------|
| main.py | FastAPI app, WebSocket endpoint, AgentContext |
| agents.py | 17 agent definitions + CEO auto-routing |
| tools/__init__.py | Tool implementations + 4 tool enums |
| kb.py | numpy RAG vector store (sentence-transformers) |
| memory_summary.py | Project-aware memory/summary injection |
| collaboration.py | AgentBus, step_estimates |
| performance.py | Engine scoring, TIME_ESTIMATES |
| scheduler.py | APScheduler |

### Frontend (~/AION/aionclaw/frontend/src/)
| Αρχείο | Ρόλος |
|--------|-------|
| App.jsx | Main component, WebSocket, CATEGORIES, session persistence |
| index.css | CSS variables, Tailwind v4 @theme (UI Step 1 ✅) |

### Storage
| Path | Περιεχόμενο |
|------|-------------|
| ~/AION/MEMORY/{project}/memory.json | Project-scoped facts & summaries |
| ~/AION/MEMORY/memory.json | Global facts (fallback) |
| ~/AION/aionclaw/sessions/{project}/ | Session files |
| ~/AION/aionclaw/knowledge/{project}/ | KB vectors + metadata |
| ~/AION/aionclaw/knowledge/_global/ | company_profile.md |
| ~/AION/projects.json | PM Agent project tracking |

## Agents (17 συνολικά)

| ID | Ρόλος | Task Type | Ειδικά tools / σημειώσεις |
|----|-------|-----------|---------------------------|
| ceo | Coordinator | reasoning | delegate_to_agent, parallel_delegate, approve_request. Prompt: softer reasoning (εξηγεί μόνο αν ρωτηθεί) |
| pm | Project Manager | reasoning | read_leads, read_file/write_file, list_dir. Auto-creates projects.json. **ΟΛΟΚΛΗΡΩΘΗΚΕ** (a53d5c2) |
| dev | Developer | coding | run_command |
| analytics | Data Analytics | coding | run_command |
| security | Security | coding | run_command (NO write_file) |
| memory | Memory Keeper | reasoning | Αυτόματη απάντηση χωρίς approval για facts |
| consultant | Business Consultant | reasoning | read_leads (προστέθηκε) |
| leadfinder | Lead Finder | simple | save_lead, read_leads |
| sales | Sales | simple | read_leads |
| marketing | Marketing | simple | Μόνο strategy – παραγωγή content δίνει στον Content Agent |
| content | Content Agent | simple | Copywriting/social (ΝΕΟΣ, peer agent, a28978e) |
| support | Support | simple | read_leads |
| finance | Finance | simple | read_leads |
| imggen | Design Agent | simple | run_command |
| seo | SEO | simple | — |
| offers | Offers Specialist | simple | read_leads (προστέθηκε) |
| docsagent | Documentation | simple | — |

## Αρχιτεκτονικές Αποφάσεις (μην αναιρείς)

| Απόφαση | Λόγος | Ημ/νία |
|---------|-------|--------|
| numpy αντί ChromaDB | ChromaDB deadlock στο macOS (loky/semaphore) | 2026-05 |
| Project-scoped memory | memory_summary.py + tools/__init__.py ευθυγραμμισμένα | 2026-05 |
| Singleton _get_client() | PersistentClient deadlock με multiple instances | 2026-05 |
| Global dependency auth | Αντί per-endpoint Depends() | 2026-05 |
| Content Agent ως peer | Αν ήταν sub-agent του Marketing, ο Marketing παρέμενε bottleneck | 2026-05 |
| imggen rename postponed | 6+ αρχεία, cosmetic only – υψηλό κόστος | 2026-05 |
| read_leads σε Offers & Consultant | Για αυτόματο context χωρίς manual input | 2026-05 |
| Reasoning instructions × 16 agents | Διαφορετικά blocks: coding (ανάλυση), reasoning (βήμα-βήμα), simple (άμεσα) | 2026-05 |
| CEO delegation reasoning softer | Εξηγεί μόνο αν ρωτηθεί ρητά | 2026-05 |
| Memory Keeper auto-response | query_kb → recall → send_to_agent (zero approval) | 2026-05 |

## Git Log (τελευταίες εγγραφές)
```
7b1ae58 add: auto engine fallback + memory recall cache 30s
578a80e add: Agent Console + real-time comm log + full timestamps
c1ac29f ui: steps 4-8 polish — tool bar, system tiers, wave typing, drawer tabs, input bar
dda4181 add: runtime tool permission filtering + opencode.jsonc
a53d5c2 add PM Agent + projects.json with auto-create and deadline parsing
a28978e add reasoning instructions to all 16 agents
e04abc3 add Content Agent + read_leads to offers & consultant
```

## Εκκρεμή (pending tasks)

| # | Τι | Αρχεία | Status |
|---|----|--------|--------|
| 1 | ~~PM Agent~~ | (ολοκληρώθηκε) | **completed** (a53d5c2) |
| 2 | UI Redesign Steps 2‑8 | App.jsx, index.css | **completed** |
| 3 | Runtime tool permission enforcement | main.py / agents.py (TOOL_DEFINITIONS filtering) | **completed** |
| 4 | OpenCode project configuration (opencode.jsonc) | root του repo | **completed** |
| 5 | Agent Console + real-time comm log | App.jsx, collaboration.py | **completed** |
| 6 | Auto engine fallback + memory cache | engine/__init__.py, tools/__init__.py | **completed** |
| 7 | main.py split (router files) | main.py → routers/ | postponed |
| 8 | pytest suite | tests/ | postponed |
| 9 | Structured output (guardrails) | agents.py | postponed |

### Λεπτομέρειες για τα νέα εκκρεμή

**#3 – Runtime permission enforcement**  
✅ Υλοποιήθηκε. `get_tool_definitions_for_agent(agent_id)` στο `tools/__init__.py` φιλτράρει τα TOOL_DEFINITIONS για κάθε agent βάσει του whitelist του. Τα 3 call sites (`main.py` streaming + non‑streaming, `collaboration.py`) χρησιμοποιούν όλα το φιλτραρισμένο list. Το LLM βλέπει ΜΟΝΟ τα tools που δικαιούται. Δύο επίπεδα ασφάλειας: LLM‑level filtering + runtime `ALLOWED_AGENTS`.

**#4 – OpenCode project config (opencode.jsonc)**  
✅ Υλοποιήθηκε. `opencode.jsonc` στο repo root με `"instructions": ["BUILDER_CONTEXT.md"]`. Το opencode διαβάζει αυτόματα το BUILDER_CONTEXT.md σε κάθε session. Οι 5 κανόνες + workflow προστέθηκαν στο πάνω μέρος του BUILDER_CONTEXT.md (Σύνταγμα).

## UI Redesign (8‑step πλάνο)

| Step | Status |
|------|--------|
| 1. index.css CSS variables | ✅ |
| 2. Message bubbles | ✅ |
| 3. Agent sidebar grouping | ✅ |
| 4. groupToolCalls + collapsible bar | ✅ |
| 5. System messages 3‑tier | ✅ |
| 6. Input bar pill design | ✅ |
| 7. Typing/progress indicators | ✅ |
| 8. Context drawer tabs | ✅ |

## Known Issues
- `imggen` naming confusion (σχεδίαση vs εικόνα) – postponed (6+ αρχεία)
- Memory summary cross-project leakage – **FIXED** (project-aware)

## Patterns που ακολουθούμε (γρήγορη αναφορά)
- **Νέος agent:** agents.py → 4 enums → collaboration.py → performance.py → App.jsx CATEGORIES → company_profile.md
- **Νέο tool:** tools/__init__.py → TOOL_DEFINITIONS → enums
- **Memory path:** πάντα μέσω `_get_memory_path(project)` (ποτέ hardcoded)
- **KB path:** πάντα μέσω `_get_current_project()` (kb.py)
- **Prompt injection:** `get_context_for_agent(agent_id, project)` – project-aware
- **Agent fallback:** query_kb → send_to_agent('memory', ...) → χρήστης
