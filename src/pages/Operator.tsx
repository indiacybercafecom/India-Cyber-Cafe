import { useMemo, useState } from 'react';
import { Application, UserProfile } from '../types';
import { IconRenderer } from '../components/Icons';
import { showToast } from '../components/Toast';
import { utils, writeFile } from 'xlsx';
import { isAssignedToOperator, normalizeApplicationNotes } from '../utils/permissions';

interface OperatorProps {
  applications: Application[];
  user: UserProfile;
  loading?: boolean;
  error?: Error | null;
  onViewApp: (app: Application) => void;
}

type StatusFilter = 'all' | 'processing' | 'clarification' | 'completed' | 'rejected';

export function Operator({ applications, user, loading = false, error = null, onViewApp }: OperatorProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const assignedApps = useMemo(
    () => applications.filter((app) => isAssignedToOperator(app, user)),
    [applications, user]
  );

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignedApps.filter((app) => {
      const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        (app.id || '').toLowerCase().includes(q) ||
        (app.name || '').toLowerCase().includes(q) ||
        (app.email || '').toLowerCase().includes(q) ||
        (app.serviceName || '').toLowerCase().includes(q) ||
        (app.subserviceName || '').toLowerCase().includes(q)
      );
    });
  }, [assignedApps, statusFilter, search]);

  const stats = useMemo(() => ({
    total: assignedApps.length,
    processing: assignedApps.filter((a) => a.status === 'processing').length,
    clarification: assignedApps.filter((a) => a.status === 'clarification').length,
    completed: assignedApps.filter((a) => a.status === 'completed').length,
  }), [assignedApps]);

  const exportToExcel = () => {
    if (filteredApps.length === 0) {
      showToast('No assigned applications to export.', 'info');
      return;
    }
    const data = filteredApps.map((app) => ({
      ID: app.id,
      User: app.name,
      Email: app.email,
      Service: app.subserviceName ? `${app.serviceName} (${app.subserviceName})` : app.serviceName,
      Status: app.status,
      NotesCount: normalizeApplicationNotes(app.notes).length,
      Date: new Date(app.date).toLocaleString('en-IN'),
    }));
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'AssignedApplications');
    writeFile(wb, `Operator_Assigned_Apps_${Date.now()}.xlsx`);
    showToast('Export successful!');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'processing':
        return 'bg-orange-500';
      case 'rejected':
        return 'bg-red-500';
      case 'clarification':
        return 'bg-blue-500';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-navy">Operator Panel</h2>
          <p className="text-sm text-slate-500 mt-1">
            Showing only service applications assigned to <span className="font-semibold text-navy">{user.email}</span>
          </p>
        </div>
        <button
          onClick={exportToExcel}
          className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-sm w-full sm:w-auto"
        >
          <IconRenderer name="excel" className="w-5 h-5" />
          Export Assigned
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Assigned to Me</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-navy mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-bold text-orange-500 uppercase tracking-wider">Processing</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-navy mt-1">{stats.processing}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-bold text-blue-500 uppercase tracking-wider">Clarification</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-navy mt-1">{stats.clarification}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
          <p className="text-xs font-bold text-green-600 uppercase tracking-wider">Completed</p>
          <p className="text-2xl sm:text-3xl font-extrabold text-navy mt-1">{stats.completed}</p>
        </div>
      </div>

      {/* Search & Status Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2 p-1.5 bg-slate-100 rounded-2xl w-fit">
          {([
            { id: 'all', label: 'All Assigned' },
            { id: 'processing', label: 'Processing' },
            { id: 'clarification', label: 'Clarification' },
            { id: 'completed', label: 'Completed' },
            { id: 'rejected', label: 'Rejected' },
          ] as { id: StatusFilter; label: string }[]).map((item) => (
            <button
              key={item.id}
              onClick={() => setStatusFilter(item.id)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                statusFilter === item.id
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-slate-500 hover:text-navy'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:max-w-sm">
          <IconRenderer name="magnifying-glass" className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, applicant, or service..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-medium">
          Unable to load assigned applications: {error.message}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-3xl shadow-xl p-10 text-center text-slate-500 font-medium">
          Loading assigned applications...
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="bg-white rounded-3xl shadow-xl p-10 text-center space-y-2 border border-slate-100">
          <p className="text-lg font-bold text-navy">No assigned applications found</p>
          <p className="text-sm text-slate-500">
            {assignedApps.length === 0
              ? 'Applications assigned to you by an Admin will appear here.'
              : 'Try adjusting your search query or status filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="p-5 font-bold">ID</th>
                  <th className="p-5 font-bold">Applicant</th>
                  <th className="p-5 font-bold">Service</th>
                  <th className="p-5 font-bold">Status</th>
                  <th className="p-5 font-bold">Updated</th>
                  <th className="p-5 font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredApps.map((app) => (
                  <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-5 font-medium text-slate-600 text-sm">{app.id}</td>
                    <td className="p-5">
                      <div className="font-bold text-navy">{app.name}</div>
                      <div className="text-xs text-slate-400">{app.email}</div>
                    </td>
                    <td className="p-5">
                      <div className="font-bold text-navy">{app.serviceName}</div>
                      {app.subserviceName && (
                        <div className="text-xs text-slate-500">{app.subserviceName}</div>
                      )}
                    </td>
                    <td className="p-5">
                      <span className={`badge ${getStatusColor(app.status)}`}>{app.status}</span>
                    </td>
                    <td className="p-5 text-xs text-slate-500">
                      {new Date(app.updatedAt || app.date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="p-5">
                      <button
                        onClick={() => onViewApp(app)}
                        className="btn-primary py-2 px-4 text-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden divide-y divide-slate-100">
            {filteredApps.map((app) => (
              <div key={app.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-400">{app.id}</p>
                    <h3 className="font-bold text-navy truncate">{app.serviceName}</h3>
                    {app.subserviceName && (
                      <p className="text-xs text-slate-500 truncate">{app.subserviceName}</p>
                    )}
                  </div>
                  <span className={`badge shrink-0 ${getStatusColor(app.status)}`}>{app.status}</span>
                </div>
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-navy">{app.name}</span> · {app.email}
                </div>
                <button
                  onClick={() => onViewApp(app)}
                  className="btn-primary w-full py-2.5 text-sm"
                >
                  Open Assigned Application
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
