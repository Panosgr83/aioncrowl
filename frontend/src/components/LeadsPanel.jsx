import { useState, useEffect, useMemo } from 'react'
import API from '../config'

export default function LeadsPanel({ onClose }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    fetch(`${API}/api/leads`).then(r=>r.json()).then(d => {
      if (d.leads) setLeads(d.leads)
      else if (Array.isArray(d)) setLeads(d)
      else if (d.data) setLeads(d.data)
    }).catch(()=>{}).finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let result = leads
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        (l.name||'').toLowerCase().includes(q) ||
        (l.company||'').toLowerCase().includes(q) ||
        (l.industry||'').toLowerCase().includes(q) ||
        (l.location||'').toLowerCase().includes(q) ||
        (l.serviceNeeded||'').toLowerCase().includes(q)
      )
    }
    if (filterStatus !== 'all') {
      result = result.filter(l => l.status === filterStatus)
    }
    return result
  }, [leads, search, filterStatus])

  const statusCounts = useMemo(() => {
    const counts = {}
    leads.forEach(l => { const s = l.status||'unknown'; counts[s] = (counts[s]||0) + 1 })
    return counts
  }, [leads])

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Leads CRM</span>
        <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-1.5 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search leads..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-accent placeholder:text-gray-600"/>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-[9px] text-gray-400 focus:outline-none">
          <option value="all">All ({leads.length})</option>
          {Object.entries(statusCounts).map(([s, c]) => (
            <option key={s} value={s}>{s} ({c})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-600 text-xs">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-xs">No leads match your criteria.</div>
      ) : (
        <>
          <div className="text-gray-600 text-[9px]">Showing {filtered.length} of {leads.length} leads</div>
          <div className="flex flex-col gap-1">
            {filtered.slice(0, 100).map((lead, i) => (
              <div key={lead.id||i||lead.name} className="bg-gray-800/40 rounded p-2 border border-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-gray-200 font-medium truncate">{lead.name||lead.company||'Unknown'}</span>
                  {lead.status && <span className={`text-[9px] px-1 py-0.5 rounded-full ${lead.status === 'qualified' ? 'bg-green-900/40 text-green-300' : lead.status === 'incoming' ? 'bg-blue-900/40 text-blue-300' : lead.status === 'contacted' ? 'bg-amber-900/40 text-amber-300' : 'bg-gray-700 text-gray-400'}`}>{lead.status}</span>}
                </div>
                {lead.industry && <div className="text-gray-500 text-[9px] mt-0.5">🏢 {lead.industry}</div>}
                {lead.location && <div className="text-gray-500 text-[9px]">📍 {lead.location}</div>}
                {lead.serviceNeeded && <div className="text-gray-500 text-[9px]">🛠 {lead.serviceNeeded}</div>}
                {lead.onlinePresence && <div className="text-gray-600 text-[9px]">🌐 {lead.onlinePresence}</div>}
                {lead.source && <div className="text-gray-600 text-[9px]">📡 {lead.source}</div>}
                {lead.date && <div className="text-gray-600 text-[9px]">📅 {lead.date}</div>}
              </div>
            ))}
            {filtered.length > 100 && <div className="text-center text-gray-600 text-[9px]">+{filtered.length-100} more</div>}
          </div>
        </>
      )}
    </div>
  )
}