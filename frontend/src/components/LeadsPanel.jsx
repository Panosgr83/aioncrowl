import { useState, useEffect } from 'react'
import API from '../config'

export default function LeadsPanel({ onClose }) {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/leads`).then(r=>r.json()).then(d => {
      if (d.leads) setLeads(d.leads)
      else if (Array.isArray(d)) setLeads(d)
      else if (d.data) setLeads(d.data)
    }).catch(()=>{}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Leads CRM</span>
        <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
      </div>
      {loading ? (
        <div className="text-center py-8 text-gray-600 text-xs">Loading...</div>
      ) : leads.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-xs">No leads found.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {leads.slice(0, 50).map((lead, i) => (
            <div key={lead.id||i} className="bg-gray-800/40 rounded p-2 border border-gray-800">
              <div className="flex items-center justify-between">
                <span className="text-gray-200 font-medium truncate">{lead.name||lead.company||'Unknown'}</span>
                {lead.status && <span className={`text-[9px] px-1 py-0.5 rounded ${lead.status === 'active' ? 'bg-green-900/40 text-green-300' : lead.status === 'new' ? 'bg-blue-900/40 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>{lead.status}</span>}
              </div>
              {lead.email && <div className="text-gray-500 text-[9px] mt-0.5">{lead.email}</div>}
              {lead.phone && <div className="text-gray-500 text-[9px]">{lead.phone}</div>}
              {lead.notes && <div className="text-gray-600 text-[9px] mt-0.5 line-clamp-2">{lead.notes}</div>}
            </div>
          ))}
          {leads.length > 50 && <div className="text-center text-gray-600 text-[9px]">+{leads.length-50} more</div>}
        </div>
      )}
    </div>
  )
}