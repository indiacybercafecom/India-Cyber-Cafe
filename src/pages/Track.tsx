import { Application } from '../types';
import { IconRenderer } from '../components/Icons';

interface TrackProps {
  applications: Application[];
  onViewDetails: (app: Application) => void;
}

export function Track({ applications, onViewDetails }: TrackProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processing': return 'bg-orange-500';
      case 'clarification': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'rejected': return 'bg-red-500';
      default: return 'bg-slate-500';
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-4xl font-bold text-navy">My Applications</h2>
        <p className="text-slate-500">Track the status of your submitted applications</p>
      </div>

      <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-linear-to-r from-navy to-navy-light text-white">
                <th className="p-6 font-bold">ID</th>
                <th className="p-6 font-bold">Service</th>
                <th className="p-6 font-bold">Status</th>
                <th className="p-6 font-bold">Date</th>
                <th className="p-6 font-bold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.length > 0 ? (
                applications.map(app => (
                  <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-6 font-medium text-slate-600">{app.id}</td>
                    <td className="p-6">
                      <div className="font-bold text-navy">{app.serviceName}</div>
                      {app.subserviceName && <div className="text-xs text-slate-400">{app.subserviceName}</div>}
                    </td>
                    <td className="p-6">
                      <span className={`badge ${getStatusBadge(app.status)}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="p-6 text-slate-500 text-sm">
                      {new Date(app.date).toLocaleDateString()}
                    </td>
                    <td className="p-6">
                      <button 
                        onClick={() => onViewDetails(app)}
                        className="btn-primary py-2 px-4 text-sm"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-slate-400 font-medium">
                    No applications found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="sm:hidden divide-y divide-slate-100">
          {applications.length > 0 ? (
            applications.map(app => (
              <div key={app.id} className="p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{app.id}</div>
                    <div className="font-bold text-navy text-lg">{app.serviceName}</div>
                    {app.subserviceName && <div className="text-xs text-slate-500">{app.subserviceName}</div>}
                  </div>
                  <span className={`badge ${getStatusBadge(app.status)}`}>
                    {app.status}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <div className="text-xs text-slate-400">
                    {new Date(app.date).toLocaleDateString()}
                  </div>
                  <button 
                    onClick={() => onViewDetails(app)}
                    className="btn-primary py-2 px-6 text-xs"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-slate-400 font-medium">
              No applications found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
