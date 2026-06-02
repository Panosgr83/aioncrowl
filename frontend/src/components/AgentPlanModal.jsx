import { useState } from 'react'

const CATEGORIES = {
  Core: ['ceo', 'pm'],
  Tech: ['dev', 'analytics', 'security'],
  Business: ['sales', 'leadfinder', 'offers', 'finance'],
  Marketing: ['marketing', 'seo', 'content', 'imggen'],
  Support: ['support', 'memory', 'docsagent', 'consultant'],
}

const ALL_AGENTS = [
  { id: 'ceo', name: 'AION CEO', icon: '🤖', role: 'Central orchestrator' },
  { id: 'pm', name: 'PM Agent', icon: '📋', role: 'Project management' },
  { id: 'dev', name: 'Developer', icon: '💻', role: 'Software development' },
  { id: 'leadfinder', name: 'Lead Finder', icon: '🎯', role: 'Business development' },
  { id: 'memory', name: 'Memory Keeper', icon: '🧠', role: 'Knowledge management' },
  { id: 'sales', name: 'Sales Agent', icon: '💰', role: 'Lead scoring & CRM' },
  { id: 'marketing', name: 'Marketing Agent', icon: '📢', role: 'Campaigns & strategy' },
  { id: 'support', name: 'Customer Support', icon: '🎧', role: 'Support & tickets' },
  { id: 'analytics', name: 'Data Analytics', icon: '📊', role: 'Data analysis' },
  { id: 'security', name: 'Security Agent', icon: '🔒', role: 'Security monitoring' },
  { id: 'finance', name: 'Finance Agent', icon: '💳', role: 'Financial management' },
  { id: 'imggen', name: 'Design Agent', icon: '🎨', role: 'Web design & templates' },
  { id: 'seo', name: 'SEO Specialist', icon: '🔍', role: 'SEO & keywords' },
  { id: 'offers', name: 'Offers Specialist', icon: '🏷️', role: 'Pricing & proposals' },
  { id: 'content', name: 'Content Agent', icon: '✍️', role: 'Copywriting & content' },
  { id: 'consultant', name: 'Business Consultant', icon: '🧭', role: 'Strategic consulting' },
  { id: 'docsagent', name: 'Documentation Specialist', icon: '📝', role: 'Technical writing' },
]

function matchAgents(text) {
  const t = text.toLowerCase()
  const matched = new Set()
  matched.add('ceo')
  const rules = [
    { keywords: ['κώδικα', 'development', 'bug', 'feature', 'api', 'backend', 'frontend', 'software', 'develop', 'code', 'deploy', 'database'], agent: 'dev' },
    { keywords: ['πωλήσ', 'sales', 'crm', 'lead scoring', 'enrichment', 'pipeline'], agent: 'sales' },
    { keywords: ['lead', 'πελάτ', 'market research', 'b2b', 'ανταγωνιστ', 'εξαγωγ', 'client', 'εταιρεί'], agent: 'leadfinder' },
    { keywords: ['μνήμ', 'αρχεί', 'memory', 'προηγούμεν', 'συζήτησ', 'ιστορικό', 'summary', 'θυμάσαι'], agent: 'memory' },
    { keywords: ['market', 'campaign', 'social media', 'διαφημ', 'marketing', 'brand', 'position'], agent: 'marketing' },
    { keywords: ['content', 'copywriting', 'copy', 'social post', 'blog', 'newsletter', 'email sequence', 'περιεχόμεν', 'άρθρ', 'κείμεν'], agent: 'content' },
    { keywords: ['υποστήριξ', 'support', 'ticket', 'βοήθεια', 'πρόβλημα', 'error', 'bug report'], agent: 'support' },
    { keywords: ['analytics', 'metrics', 'data', 'statistics', 'kpi', 'reporting', 'αναλυτ', 'δεδομέν', 'μετρήσ'], agent: 'analytics' },
    { keywords: ['ασφάλει', 'security', 'audit', 'threat', 'compliance', 'προστασί'], agent: 'security' },
    { keywords: ['οικονομ', 'finance', 'invoice', 'budget', 'τιμολόγ', 'προϋπολογ', 'κόστ'], agent: 'finance' },
    { keywords: ['design', 'template', 'ui', 'ux', 'visual', 'layout', 'wireframe', 'σχεδίασ', 'πρότυπο'], agent: 'imggen' },
    { keywords: ['seo', 'keyword', 'search engine', 'google', 'κατάταξ', 'λέξεισ κλειδί'], agent: 'seo' },
    { keywords: ['offer', 'pricing', 'πακέτο', 'proposal', 'quote', 'προσφορ', 'τιμολογ', 'πακέτ'], agent: 'offers' },
    { keywords: ['project', 'deadline', 'milestone', 'task tracking', 'progress', 'status report', 'deliverable', 'χρονοδιάγραμ', 'παραδοτέ'], agent: 'pm' },
    { keywords: ['στρατηγ', 'consult', 'mentor', 'business plan', 'συμβουλ', 'επιχειρηματ', 'growth'], agent: 'consultant' },
    { keywords: ['documentation', 'εγχειρίδ', 'technical writing', 'manual', 'guide', 'τεκμηρίωσ', 'οδηγ'], agent: 'docsagent' },
  ]
  for (const { keywords, agent } of rules) {
    if (keywords.some(k => t.includes(k))) {
      matched.add(agent)
    }
  }
  return [...matched]
}

export default function AgentPlanModal({ text, onConfirm, onCancel }) {
  const allIds = ALL_AGENTS.map(a => a.id)
  const suggested = matchAgents(text)
  const [selected, setSelected] = useState(suggested)

  const toggle = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleConfirm = () => {
    onConfirm(selected.filter(id => id !== 'ceo'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-app-surface border border-app-elevated rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-app-elevated/60 shrink-0">
          <h2 className="text-sm sm:text-base font-semibold text-text-primary">Agent Selection</h2>
          <p className="text-[10px] sm:text-xs text-text-dim mt-0.5 leading-relaxed break-words">Επέλεξε ποιοι agents θα συμμετέχουν στη συζήτηση για:</p>
          <p className="text-[11px] sm:text-xs text-text-secondary mt-1 italic leading-relaxed break-words line-clamp-2">"{text.slice(0,120)}{text.length>120?'...':''}"</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-2">
          {Object.entries(CATEGORIES).map(([cat, ids]) => {
            const agents = ids.map(id => ALL_AGENTS.find(a => a.id === id)).filter(Boolean)
            const anySelected = agents.some(a => selected.includes(a.id))
            return (
              <div key={cat}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] sm:text-[10px] text-text-dim/60 uppercase tracking-wider font-medium">{cat}</span>
                  {!anySelected && <span className="text-[8px] text-text-dim/40">(κανένας)</span>}
                </div>
                {agents.map(a => {
                  const isSuggested = suggested.includes(a.id)
                  const isOn = selected.includes(a.id)
                  return (
                    <label key={a.id} className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg cursor-pointer transition-colors group ${isOn ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-app-elevated/40'}`}>
                      <input type="checkbox" checked={isOn} onChange={() => toggle(a.id)}
                        className="accent-accent w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 cursor-pointer" />
                      <span className="text-sm sm:text-base shrink-0">{a.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[11px] sm:text-xs font-medium truncate ${isOn ? 'text-text-primary' : 'text-text-secondary'}`}>{a.name}</span>
                          {isSuggested && <span className="text-[8px] text-accent/60 shrink-0">προτ.</span>}
                        </div>
                        <div className="text-[9px] sm:text-[10px] text-text-dim/60 truncate">{a.role}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-app-elevated/60 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-text-dim">{selected.filter(i => i !== 'ceo').length} agents selected</span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-text-dim hover:text-text-primary transition-colors">Cancel</button>
            <button onClick={handleConfirm} disabled={selected.filter(i => i !== 'ceo').length === 0}
              className="px-4 py-1.5 text-[11px] font-medium bg-accent hover:bg-accent-dim disabled:bg-app-elevated text-white rounded-full transition-all disabled:text-text-dim">
              Execute →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
