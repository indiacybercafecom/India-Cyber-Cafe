import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Application, UserProfile } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { utils, writeFile } from 'xlsx';

interface OperatorProps {
  applications: Application[];
  user: UserProfile;
  onViewApp: (app: Application) => void;
}

export function Operator({ applications, user, onViewApp }: OperatorProps) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'assigned' | 'all'>('assigned');

  const filteredApps = tab === 'assigned' 
    ? applications.filter(a => a.assignedTo === user.email)
    : applications;

  const exportToExcel = () => {
    const data = filteredApps.map(app => ({
      ID: app.id,
      User: app.name,
      Email: app.email,
      Service: app.serviceName,
      Status: app.status,
      Date: new Date(app.date).toLocaleString()
    }));
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Applications");
    writeFile(wb, `Operator_Apps_${Date.now()}.xlsx`);
    showToast('Export successful!');
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-navy">Operator Panel</h2>
        <button onClick={exportToExcel} className="bg-green-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-green-700 transition-all">
          <IconRenderer name="excel" className="w-5 h-5" />
          Export
        </button>
      </div>

      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        <button
          onClick={() => setTab('assigned')}
          className={`px-6 py-3 rounded-xl font-bold transition-all ${tab === 'assigned' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
        >
          Assigned to Me
        </button>
        <button
          onClick={() => setTab('all')}
          className={`px-6 py-3 rounded-xl font-bold transition-all ${tab === 'all' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
        >
          All Applications
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-navy text-white">
              <th className="p-6 font-bold">ID</th>
              <th className="p-6 font-bold">User</th>
              <th className="p-6 font-bold">Service</th>
              <th className="p-6 font-bold">Status</th>
              <th className="p-6 font-bold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredApps.map(app => (
              <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-6 font-medium text-slate-600">{app.id}</td>
                <td className="p-6">
                  <div className="font-bold text-navy">{app.name}</div>
                  <div className="text-xs text-slate-400">{app.email}</div>
                </td>
                <td className="p-6 font-bold text-navy">{app.serviceName}</td>
                <td className="p-6">
                  <span className={`badge ${
                    app.status === 'completed' ? 'bg-green-500' : 
                    app.status === 'processing' ? 'bg-orange-500' : 
                    app.status === 'rejected' ? 'bg-red-500' : 'bg-blue-500'
                  }`}>
                    {app.status}
                  </span>
                </td>
                <td className="p-6">
                  <button onClick={() => navigate(`/track/${app.id}`)} className="btn-primary py-2 px-4 text-sm">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
